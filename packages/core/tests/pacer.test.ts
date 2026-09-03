import { describe, expect, test } from 'bun:test'
import { createPacingMiddleware, PACED_METHODS } from '../src/pacer'

/** A fake clock: time only moves when the pacer sleeps, so waits are exactly observable. */
function harness(methods?: ReadonlySet<string>) {
  let clock = 1_000
  const waits: number[] = []
  const pace = createPacingMiddleware({
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms)
      clock += ms
    },
    methods,
  })
  /** One call returning `res`; `cost` is how long the call itself takes. */
  const call = (method: string, res: unknown = { ok: true }, cost = 0) =>
    pace({ request: { _: method } }, async () => {
      clock += cost
      return res
    })
  const flood = (seconds = 5) => ({
    _: 'mt_rpc_error',
    errorCode: 420,
    errorMessage: `FLOOD_WAIT_${seconds}`,
  })
  return { call, flood, waits, now: () => clock }
}

const HISTORY = 'messages.getHistory'

describe('pacing middleware', () => {
  // The load-bearing property, and the correction of an earlier design that paced from
  // the very first request: a client Telegram is happy with must not be slowed at all.
  test('adds no delay whatsoever until Telegram has actually objected', async () => {
    const h = harness()
    for (let i = 0; i < 200; i++) await h.call(HISTORY)
    expect(h.waits).toEqual([])
    expect(h.now()).toBe(1_000) // not one millisecond spent waiting
  })

  test('methods outside the paced set are never damped, flood or no flood', async () => {
    const h = harness()
    const other = 'messages.deleteMessages'
    await h.call(other, h.flood())
    for (let i = 0; i < 5; i++) await h.call(other)
    expect(h.waits).toEqual([])
  })

  test('the paced set is exactly the bulk read calls, by name', () => {
    // pinned as literals: these are wire names, and a typo silently damps nothing
    expect([...PACED_METHODS].sort()).toEqual([
      'messages.getDialogs',
      'messages.getHistory',
      'messages.search',
    ])
  })

  test('a flood starts spacing the calls that follow it', async () => {
    const h = harness()
    await h.call(HISTORY)
    expect(h.waits).toEqual([]) // still nothing before the flood
    await h.call(HISTORY, h.flood())
    await h.call(HISTORY)
    await h.call(HISTORY)
    expect(h.waits.at(-1)!).toBeGreaterThan(0)
  })

  test('every paced method reacts to its own flood', async () => {
    for (const method of PACED_METHODS) {
      const h = harness()
      await h.call(method, h.flood())
      await h.call(method)
      await h.call(method)
      expect(h.waits.at(-1)!).toBeGreaterThan(0)
    }
  })

  test('repeated floods widen the gap, up to a cap', async () => {
    const h = harness()
    const gaps: number[] = []
    for (let i = 0; i < 12; i++) {
      await h.call(HISTORY, h.flood())
      await h.call(HISTORY, h.flood())
      // ?? 0: the opening iterations reserve their slots while the gap is still zero,
      // so nothing sleeps yet
      gaps.push(h.waits.at(-1) ?? 0)
    }
    // each flood multiplies: a back-off that cannot climb past its opening value is none
    expect(gaps.at(-1)!).toBeGreaterThan(gaps[0]!)
    expect(gaps.at(-1)!).toBeGreaterThan(1_000)
    // but bounded — a squeezed account must not end up waiting minutes between pages
    expect(gaps.at(-1)!).toBe(2_000)
  })

  test('the spacing decays away entirely once the floods stop', async () => {
    const h = harness()
    await h.call(HISTORY, h.flood())
    for (let i = 0; i < 60; i++) await h.call(HISTORY)
    const before = h.waits.length
    // fully back to zero: no residue left to tax the rest of the run
    for (let i = 0; i < 20; i++) await h.call(HISTORY)
    expect(h.waits).toHaveLength(before)
  })

  test('the decay shrinks the gap gradually rather than dropping it in one step', async () => {
    const h = harness()
    await h.call(HISTORY, h.flood())
    await h.call(HISTORY)
    await h.call(HISTORY)
    const first = h.waits.at(-1)!
    await h.call(HISTORY)
    const second = h.waits.at(-1)!
    expect(second).toBeLessThan(first)
    expect(second).toBeGreaterThan(0)
  })

  test('a call that took longer than the gap is not delayed further', async () => {
    const h = harness()
    await h.call(HISTORY, h.flood())
    // the round trip already covered the gap; sleeping again would be pure waste
    await h.call(HISTORY, { ok: true }, 10_000)
    const before = h.waits.length
    await h.call(HISTORY)
    expect(h.waits).toHaveLength(before)
  })

  test('FLOOD_PREMIUM_WAIT counts as a flood too', async () => {
    const h = harness()
    await h.call(HISTORY, { _: 'mt_rpc_error', errorMessage: 'FLOOD_PREMIUM_WAIT_10' })
    await h.call(HISTORY)
    await h.call(HISTORY)
    expect(h.waits.at(-1)!).toBeGreaterThan(0)
  })

  test('an unrelated rpc error is not mistaken for a flood', async () => {
    const h = harness()
    await h.call(HISTORY, { _: 'mt_rpc_error', errorMessage: 'PEER_ID_INVALID' })
    for (let i = 0; i < 3; i++) await h.call(HISTORY)
    expect(h.waits).toEqual([])
  })

  test('a non-numeric wait is ignored rather than parsed into nonsense', async () => {
    const h = harness()
    await h.call(HISTORY, { errorMessage: 'FLOOD_WAIT_' })
    for (let i = 0; i < 3; i++) await h.call(HISTORY)
    expect(h.waits).toEqual([])
  })

  test('a wait named somewhere other than the start is not a rate limit', async () => {
    const h = harness()
    // the field carries the bare error code, so this is text that merely mentions one
    await h.call(HISTORY, { errorMessage: 'peer said FLOOD_WAIT_99' })
    for (let i = 0; i < 3; i++) await h.call(HISTORY)
    expect(h.waits).toEqual([])
  })

  test('a response that is not an object at all is handled, not thrown on', async () => {
    const h = harness()
    await h.call(HISTORY, null)
    await h.call(HISTORY, undefined)
    expect(h.waits).toEqual([])
  })

  test('a thrown error propagates untouched, and is not read as a rate limit', async () => {
    let clock = 0
    const waits: number[] = []
    const pace = createPacingMiddleware({
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms)
        clock += ms
      },
    })
    const ctx = { request: { _: HISTORY } }
    await expect(
      pace(ctx, async () => {
        throw new Error('socket closed')
      }),
    ).rejects.toThrow('socket closed')
    // a dead socket is not a flood, so nothing starts spacing because of it
    await pace(ctx, async () => ({ ok: true }))
    expect(waits).toEqual([])
  })

  test('once spacing exists, concurrent callers each claim a slot of their own', async () => {
    const h = harness()
    await h.call(HISTORY, h.flood())
    h.waits.length = 0
    // fired together, so each one sees the same clock before any of them sleeps. If the
    // slot were claimed only after sleeping, the third would find the second's still free
    // and start alongside it — a wait of zero here is the bug this pins.
    await Promise.all([h.call(HISTORY), h.call(HISTORY), h.call(HISTORY)])
    // the first finds the current slot free and goes at once; the other two each wait
    expect(h.waits).toHaveLength(2)
    expect(Math.min(...h.waits)).toBeGreaterThan(0)
    // not asserting increasing waits: the fake clock advances during each sleep, so the
    // later caller measures its own wait from a later `now` and the two come out equal
  })
})
