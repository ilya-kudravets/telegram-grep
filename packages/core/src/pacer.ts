// Rate pacing for the bulk read calls a sync is made of.
//
// Telegram publishes no per-method rate limit, and the only feedback it gives is
// FLOOD_WAIT_X — a punishment after the fact, not a warning before it. The punishment is
// expensive twice over: mtcute's floodWaiter sleeps the whole window, and because it
// remembers the wait *per method*, every other call to that method sleeps out the
// remainder too. One trip therefore stalls the entire sync, which is why staying just
// under the limit is worth far more than handling the penalty well.
//
// The limit is unknown, differs per account and changes over time, so it has to be
// learned rather than configured. This is AIMD on the gap between calls: every clean
// response shaves a little off it, every flood doubles it. The gap settles a shade under
// whatever the account actually tolerates, and re-settles if Telegram changes its mind.
//
// It runs as an mtcute RPC middleware, not inside syncAll, for two reasons. It has to sit
// *inside* floodWaiter to see the raw errors floodWaiter retries away — from the outside
// a flood is invisible, just a call that took a suspiciously long time. And a rate limit
// is a property of the account's connection, not of one walk over history: a sync running
// while the user searches and deletes has to share one budget, which only the transport
// can hold.
//
// The gap is also what makes concurrency safe: with several chats in flight the pacer,
// not the round-trip time, decides the request rate, so overlapping calls fill the
// latency instead of adding to the load.

import { sleep as defaultSleep } from './sync'

/** The methods a sync spends effectively all of its requests on. */
export const PACED_METHODS: ReadonlySet<string> = new Set([
  'messages.getHistory',
  'messages.getDialogs',
  'messages.search',
])

const MIN_GAP = 50 // a floor, so an unthrottled account cannot be blasted at full speed
const START_GAP = 200 // conservative first guess; decays within a few dozen calls
const MAX_GAP = 3_000 // only reached under sustained flooding
const DECAY = 4 // ms shaved per clean response
const FLOOD_FLOOR = 400 // a flood means at least this much gap, however small the gap was
// Plain AIMD oscillates around the limit *by design*: it probes downward until it trips,
// backs off, and probes down again — so it keeps paying the penalty it exists to avoid,
// once every few dozen calls. So remember where the wall was and never decay back below
// it, with a margin. Two or three floods and the gap settles just under what the account
// tolerates, instead of rediscovering it forever.
const FLOOR_MARGIN = 1.25
// The remembered wall is capped and lives only as long as the client: a limit tightened
// by something outside this process (another client on the same account, a temporary
// restriction) must not slow every later page down for good.
const MAX_FLOOR = 1_000

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
 * Middleware that spaces out `PACED_METHODS` and adapts the spacing to the floods it sees.
 * Install it as the innermost middleware, i.e. **after** `networkMiddlewares.basic(...)`.
 */
export function createPacingMiddleware({
  now = Date.now,
  sleep = defaultSleep,
  methods = PACED_METHODS,
}: PacerDeps = {}) {
  let gap = START_GAP
  let floor = MIN_GAP // raised to the last gap that flooded — see FLOOR_MARGIN
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
      floor = Math.min(MAX_FLOOR, Math.max(floor, gap * FLOOR_MARGIN))
      gap = Math.min(MAX_GAP, Math.max(FLOOD_FLOOR, gap * 2))
    } else {
      gap = Math.max(floor, gap - DECAY)
    }
    return res
  }
}
