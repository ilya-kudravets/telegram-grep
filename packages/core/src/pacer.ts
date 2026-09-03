// Damping for the bulk read calls a sync is made of.
//
// **Purely reactive: it adds no delay until Telegram has actually objected.** That is the
// whole design, and it is a correction of an earlier one. The first attempt paced
// proactively — a 200ms opening gap, a floor it never went below, and a ratchet that
// remembered the widest gap that had ever flooded — on the theory that a FLOOD_WAIT costs
// far more than the delays needed to avoid it. Simulated against a token-bucket server it
// was **1.5–2x slower than no pacing at all**: it ate the entire gain from walking chats
// concurrently, and on a tight limit it over-throttled well past what the account
// actually allowed. The premise was wrong. `messages.getHistory` floods are short — the
// wait is roughly the time until the limit frees up — so paying the occasional one is
// cheaper than slowing every request down to dodge it.
//
// What is still worth damping is the *thrash*. Four chats in flight with no damping at
// all produced thousands of flood waits over one archive in simulation: no slower
// overall, since the waits are short, but a request pattern that invites Telegram to
// escalate. So a flood widens the gap, and every clean response decays it back
// multiplicatively — fast enough that a brief squeeze does not tax the rest of the run.
//
// Simulated over ~1300 pages, versus four chats in flight with no damping at all:
//
//   server              wall time        flood waits
//   no pressure         1.4 → 1.4 min      0 →   0
//   bucket 8 req/s      2.7 → 2.7 min    250 →  68
//   bucket 3 req/s      7.1 → 7.4 min   1095 →  87
//   bucket 1 req/s     21.3 → 21.4 min  3833 → 208
//
// i.e. it costs nothing measurable and removes most of the floods. (A sequential walk
// takes 5.4 min on the first two and is limit-bound on the rest.) The four constants
// below were picked by sweeping them against those same servers.
//
// It runs as an mtcute RPC middleware, not inside syncAll, for two reasons. It has to sit
// *inside* floodWaiter to see the raw errors floodWaiter retries away — from the outside
// a flood is invisible, just a call that took a suspiciously long time. And a rate limit
// belongs to the account's connection, not to one walk over history: a sync running while
// the user searches and deletes shares one budget, which only the transport can hold.

import { sleep as defaultSleep } from './sync'

/** The methods a sync spends effectively all of its requests on. */
export const PACED_METHODS: ReadonlySet<string> = new Set([
  'messages.getHistory',
  'messages.getDialogs',
  'messages.search',
])

// All four tuned by simulation; see the sweep described above.
const FLOOD_GAP = 200 // the gap a flood establishes, when there was none
const MAX_GAP = 2_000 // ceiling, so a sustained squeeze cannot stall a sync outright
const DECAY = 0.9 // multiplied into the gap on every clean response
const SNAP = 10 // below this the gap is simply dropped: no delay at all

/** The slice of mtcute's middleware context this reads. */
export interface PacedRequest {
  request: { _: string }
}

export interface PacerDeps {
  now?: () => number
  sleep?: (ms: number) => Promise<unknown>
  methods?: ReadonlySet<string>
}

/**
 * An rpc result is an object, not a thrown error — mtcute surfaces `mt_rpc_error` as a
 * value, which is exactly why this can be read here without disturbing the call.
 *
 * Only *whether* it flooded matters, not for how long: mtcute's floodWaiter already
 * sleeps out the stated wait, and what this has to decide is the gap for the calls after
 * it. Anchored at the start, like floodWaiter's own `startsWith` check — the field holds
 * the bare error code, so a `FLOOD_WAIT_` further in is somebody's text, not a limit.
 * FLOOD_PREMIUM_WAIT_X is the same signal under a different name.
 */
function isFloodWait(res: unknown): boolean {
  const message = (res as { errorMessage?: unknown } | null)?.errorMessage
  return typeof message === 'string' && /^FLOOD(?:_PREMIUM)?_WAIT_\d/.test(message)
}

/**
 * Middleware that damps `PACED_METHODS` after a flood and gets out of the way otherwise.
 * Install it as the innermost middleware, i.e. **after** `networkMiddlewares.basic(...)`.
 */
export function createPacingMiddleware({
  now = Date.now,
  sleep = defaultSleep,
  methods = PACED_METHODS,
}: PacerDeps = {}) {
  let gap = 0 // no delay until a flood says otherwise
  let nextAt = 0

  // generic in the context, so mtcute's fuller one substitutes for this narrow slice
  return async <C extends PacedRequest, T>(ctx: C, next: (ctx: C) => Promise<T>): Promise<T> => {
    if (!methods.has(ctx.request._)) return next(ctx)

    // Claim a slot before yielding, so concurrent callers queue behind each other instead
    // of all measuring the same `now` and starting together.
    const at = Math.max(now(), nextAt)
    nextAt = at + gap
    const wait = at - now()
    if (wait > 0) await sleep(wait)

    const res = await next(ctx)
    // a thrown error never reaches here, and shouldn't: a dead socket is not a rate limit
    if (isFloodWait(res)) {
      gap = Math.min(MAX_GAP, Math.max(FLOOD_GAP, gap * 2))
    } else {
      gap *= DECAY
      // Stryker disable next-line EqualityOperator: <= differs only for a gap of exactly SNAP, which repeated *0.9 from FLOOD_GAP never lands on
      if (gap < SNAP) gap = 0
    }
    return res
  }
}
