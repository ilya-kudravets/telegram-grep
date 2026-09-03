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
  const flood = (seconds: number) => ({
    _: 'mt_rpc_error',
    errorCode: 420,
    errorMessage: `FLOOD_WAIT_${seconds}`,
  })
  return { call, flood, waits, now: () => clock }
}

const HISTORY = 'messages.getHistory'

describe('pacing middleware', () => {
  test('the first call is not delayed — an idle client should start immediately', async () => {
    const h = harness()
    await h.call(HISTORY)
    expect(h.waits).toEqual([])
  })

  test('back-to-back calls are spaced out', async () => {
    const h = harness()
    await h.call(HISTORY)
    await h.call(HISTORY)
    expect(h.waits).toHaveLength(1)
    expect(h.waits[0]!).toBeGreaterThan(0)
  })

  test('a call that took longer than the gap is not delayed further', async () => {
    const h = harness()
    await h.call(HISTORY)
    // the round trip already covered the gap; sleeping again would be pure waste
    await h.call(HISTORY, { ok: true }, 10_000)
    await h.call(HISTORY)
    expect(h.waits).toHaveLength(1) // only the second call waited
  })

  test('methods outside the paced set are passed straight through', async () => {
    const h = harness()
    for (let i = 0; i < 5; i++) await h.call('messages.deleteMessages')
    expect(h.waits).toEqual([])
  })

  test('the paced set is exactly the bulk read calls, by name', () => {
    // pinned as literals: these are wire names, and a typo silently paces nothing
    expect([...PACED_METHODS].sort()).toEqual([
      'messages.getDialogs',
      'messages.getHistory',
      'messages.search',
    ])
  })

  test('every paced method is actually paced', async () => {
    for (const method of PACED_METHODS) {
      const h = harness()
      await h.call(method)
      await h.call(method)
      expect(h.waits).toHaveLength(1)
    }
  })

  test('the gap decays while responses stay clean, so a quiet account speeds up', async () => {
    const h = harness()
    for (let i = 0; i < 4; i++) await h.call(HISTORY)
    const [first, , third] = h.waits
    expect(h.waits).toHaveLength(3)
    expect(third!).toBeLessThan(first!)
  })

  test('the gap stops decaying at a floor rather than reaching zero', async () => {
    const h = harness()
    for (let i = 0; i < 500; i++) await h.call(HISTORY)
    const last = h.waits.at(-1)!
    expect(last).toBeGreaterThan(0)
    // and it has settled: two more calls wait the same amount
    await h.call(HISTORY)
    expect(h.waits.at(-1)!).toBe(last)
  })

  test('a flood widens the gap instead of being merely waited out', async () => {
    const h = harness()
    await h.call(HISTORY)
    await h.call(HISTORY)
    const before = h.waits.at(-1)!
    await h.call(HISTORY, h.flood(30))
    // the widened gap governs the slot *after* the one already reserved, so look one
    // call further on than the flood itself
    await h.call(HISTORY)
    await h.call(HISTORY)
    expect(h.waits.at(-1)!).toBeGreaterThan(before)
  })

  test('repeated floods keep widening the gap, up to a cap', async () => {
    const h = harness()
    const gaps: number[] = []
    for (let i = 0; i < 12; i++) {
      await h.call(HISTORY, h.flood(5))
      await h.call(HISTORY, h.flood(5))
      gaps.push(h.waits.at(-1)!)
    }
    expect(gaps[1]!).toBeGreaterThan(gaps[0]!)
    // each flood must actually multiply the gap, not nudge it: a back-off that cannot
    // climb past its own opening value is no back-off at all
    expect(gaps.at(-1)!).toBeGreaterThan(2_000)
    // but bounded — a stuck account must not end up waiting minutes between pages
    expect(gaps.at(-1)!).toBe(3_000)
  })

  test('a wait named somewhere other than the start is not a rate limit', async () => {
    const h = harness()
    await h.call(HISTORY)
    await h.call(HISTORY)
    const before = h.waits.at(-1)!
    // the field carries the bare error code, so this is text that merely mentions one
    await h.call(HISTORY, { errorMessage: 'peer said FLOOD_WAIT_99' })
    // two calls on: the first still runs on the slot reserved under the old gap, so a
    // gap that was wrongly widened only becomes visible after that
    await h.call(HISTORY)
    await h.call(HISTORY)
    expect(h.waits.at(-1)!).toBeLessThan(before)
  })

  test('after a flood the gap never decays back below where it tripped', async () => {
    const h = harness()
    // settle down to the floor, so the gap that trips is a known one
    for (let i = 0; i < 40; i++) await h.call(HISTORY)
    const tripped = h.waits.at(-1)!
    await h.call(HISTORY, h.flood(5))
    // plenty of clean calls: plain AIMD would probe all the way back down and trip again
    for (let i = 0; i < 400; i++) await h.call(HISTORY)
    expect(h.waits.at(-1)!).toBeGreaterThan(tripped)
  })

  test('the remembered wall is capped, so one bad spell cannot slow every later page', async () => {
    const h = harness()
    // flood relentlessly, driving the gap to its ceiling, then let it recover
    for (let i = 0; i < 40; i++) await h.call(HISTORY, h.flood(5))
    for (let i = 0; i < 2_000; i++) await h.call(HISTORY)
    expect(h.waits.at(-1)!).toBeLessThanOrEqual(1_000)
  })

  test('FLOOD_PREMIUM_WAIT counts as a flood too', async () => {
    const h = harness()
    await h.call(HISTORY)
    await h.call(HISTORY)
    const before = h.waits.at(-1)!
    await h.call(HISTORY, { _: 'mt_rpc_error', errorMessage: 'FLOOD_PREMIUM_WAIT_10' })
    await h.call(HISTORY)
    await h.call(HISTORY)
    expect(h.waits.at(-1)!).toBeGreaterThan(before)
  })

  test('an unrelated rpc error is not mistaken for a flood', async () => {
    const h = harness()
    await h.call(HISTORY)
    await h.call(HISTORY)
    const before = h.waits.at(-1)!
    await h.call(HISTORY, { _: 'mt_rpc_error', errorMessage: 'PEER_ID_INVALID' })
    // two calls on: the first still runs on the slot reserved under the old gap, so a
    // gap that was wrongly widened only becomes visible after that
    await h.call(HISTORY)
    await h.call(HISTORY)
    expect(h.waits.at(-1)!).toBeLessThan(before) // decayed, like any clean response
  })

  test('a non-numeric wait is ignored rather than parsed into nonsense', async () => {
    const h = harness()
    await h.call(HISTORY)
    await h.call(HISTORY)
    const before = h.waits.at(-1)!
    await h.call(HISTORY, { errorMessage: 'FLOOD_WAIT_' })
    // two calls on: the first still runs on the slot reserved under the old gap, so a
    // gap that was wrongly widened only becomes visible after that
    await h.call(HISTORY)
    await h.call(HISTORY)
    expect(h.waits.at(-1)!).toBeLessThan(before)
  })

  test('a thrown error propagates untouched, and pacing carries on after it', async () => {
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
    // a dead socket is not a rate limit, so the gap is neither widened nor decayed — but
    // the slot it reserved still stands, so the next call waits it out rather than
    // stampeding straight after a failure
    await pace(ctx, async () => ({ ok: true }))
    expect(waits).toEqual([200])
  })

  test('concurrent callers queue behind each other instead of all starting at once', async () => {
    const h = harness()
    // fired together, so each one sees the same clock before any of them sleeps
    await Promise.all([h.call(HISTORY), h.call(HISTORY), h.call(HISTORY)])
    // the first goes immediately; the other two each wait for a slot of their own. If the
    // slot were claimed only after sleeping, the third would find the second's slot still
    // free and start alongside it — so a wait of zero here is the bug this pins.
    expect(h.waits).toHaveLength(2)
    expect(Math.min(...h.waits)).toBeGreaterThan(0)
    expect(h.now()).toBeGreaterThanOrEqual(1_000 + 2 * Math.min(...h.waits))
  })
})
