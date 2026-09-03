import type { TelegramClient } from '@mtcute/core/client.js'
import { toggleChannelIdMark } from '@mtcute/core/utils.js'
import { Dispatcher } from '@mtcute/dispatcher'
import type { Cache, CachedMessage, PeerKind } from './cache'

/**
 * The subset of mtcute's `Peer` (= `User | Chat`) that classification reads. Only `Chat`
 * carries `chatType`; only `User` carries `isBot`/`isSelf`, so which fields are present
 * is itself the user-vs-chat signal.
 */
export interface PeerLike {
  id: number
  displayName: string
  chatType?: string
  isBot?: boolean
  isSelf?: boolean
}

// The subset of mtcute's Message we actually read — keeps tests free of mtcute internals
export interface MsgLike {
  id: number
  text: string
  date: Date
  isOutgoing: boolean
  sender: { displayName: string }
  chat: PeerLike
}

/**
 * A broadcast channel: a feed, not correspondence. Nothing there is yours to delete unless
 * you are an admin, and a single channel's archive dwarfs every real chat you have — so
 * downloading them is the bulk of a sync and none of its value. Skipped by default;
 * `gigagroup`/`supergroup`/`group` stay, since your own messages live in those.
 *
 * NB deliberately narrower than `peerKind(...) === 'channel'`. The two answer different
 * questions, and they are allowed to disagree: **skip conservatively, label by how it
 * reads.** A gigagroup is admin-only *now*, so it reads as a feed and is labelled one —
 * but it used to be an ordinary supergroup, and the member messages from before its
 * conversion are still yours to find. Declining to download those would silently lose
 * exactly what this tool exists to surface, whereas mislabelling them only hides them
 * behind a checkbox the user can tick.
 */
export const isBroadcast = (chat: { chatType?: string }) => chat.chatType === 'channel'

/** chatTypes nobody but an admin can post to — they read as feeds in a result list. */
const FEEDS = new Set(['channel', 'gigagroup', 'community'])

/** Telegram's service-notifications account: where login codes arrive. Not a bot. */
export const SERVICE_NOTIFICATIONS_ID = 777000

/**
 * Which bucket a peer belongs to (see `PeerKind` for what the buckets are for).
 *
 * Only a `Chat` has a chatType, so its absence means the peer is a `User`. Of mtcute's
 * six chatTypes, `channel`/`gigagroup`/`community` are admin-only feeds, while
 * `group`/`supergroup`/`monoforum` are rooms an ordinary member writes in — a monoforum
 * included, since it holds *your* direct messages to a channel's admins.
 *
 * Costs nothing extra: every field read here is already on the dialog peer. Telling a
 * channel's discussion group apart from any other supergroup would need `getFullChat`
 * per peer — a round trip each, with flood-wait exposure — and would change nothing:
 * comments are your messages in a supergroup, which is what `group` already means.
 */
export function peerKind(peer: {
  id: number
  chatType?: string
  isBot?: boolean
  isSelf?: boolean
}): PeerKind {
  if (peer.chatType) return FEEDS.has(peer.chatType) ? 'channel' : 'group'
  if (peer.isSelf) return 'saved'
  return peer.isBot || peer.id === SERVICE_NOTIFICATIONS_ID ? 'bot' : 'private'
}

// The subset of TelegramClient sync needs
export interface SyncClient {
  iterDialogs(params?: object): AsyncIterable<{
    peer: PeerLike
    lastMessage: { id: number } | null // newest message id — lets us skip unchanged chats
  }>
  iterHistory(chatId: number, params?: { minId?: number }): AsyncIterable<MsgLike>
  // paginated, newest-first; maxId caps the newest id returned (used to page downward)
  getHistory(chatId: number, params?: { maxId?: number; limit?: number }): Promise<MsgLike[]>
}

// ponytail: only messages with text/captions are cached — the app searches text, media bodies are useless here
export function toCached(msg: MsgLike): CachedMessage | null {
  if (!msg.text) return null
  return {
    chat_id: msg.chat.id,
    id: msg.id,
    date: Math.floor(msg.date.getTime() / 1000),
    sender: msg.sender.displayName,
    text: msg.text,
    out: msg.isOutgoing ? 1 : 0,
  }
}

export interface SyncProgress {
  chatTitle: string
  chatsDone: number
  chatsTotal: number
  messages: number
  floodWait?: number // seconds we are currently sleeping, if any
  errors: { chatId: number; title: string; error: string }[] // per-chat failures, sync continues
}

export function floodWaitSeconds(e: unknown): number | null {
  if (!(e instanceof Error)) return null
  const m = e.message.match(/FLOOD_WAIT_(\d+)/)
  return m ? Number(m[1]) : null
}

const BATCH = 500
const PAGE = 100 // getHistory max chunk
const CHAT_WORKERS = 4 // see syncAll's worker pool
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function cacheBatch(cache: Cache, msgs: MsgLike[]): number {
  const rows = msgs.map(toCached).filter((c): c is CachedMessage => c !== null)
  cache.insertMessages(rows)
  return rows.length
}

// returns false if the chat was skipped entirely (no network calls)
export async function syncChat(
  tg: SyncClient,
  cache: Cache,
  chatId: number,
  topId: number,
  onBatch?: (inserted: number) => void,
): Promise<boolean> {
  const hw = cache.lastMsgId(chatId)
  const { oldestId, backfilled } = cache.backfillState(chatId)

  // fast path: history fully downloaded and nothing new since last run → do nothing.
  // New messages that arrived while offline are delivered by mtcute's update catch-up.
  if (backfilled && topId <= hw) return false

  // A walk that starts at the top and runs to the bottom is the only moment we learn
  // what Telegram *no longer* has: syncing otherwise only ever inserts, so history the
  // user cleared — or messages deleted while this client was offline, where no delete
  // update was ever delivered — would stay cached forever. So snapshot the chat's ids
  // now and, if the walk reaches the bottom, drop whatever it never saw.
  //
  // Only for a walk from the top (`oldestId === 0`): a resumed backfill has already
  // persisted part of its progress, and pruning against a partial pass would delete the
  // messages the earlier run downloaded. Taken *before* the walk, so a realtime message
  // arriving mid-walk is never a candidate. An interrupted walk prunes nothing and the
  // next resync tries again — losing nothing is worth more than pruning promptly.
  const before = oldestId === 0 && !backfilled ? cache.messageIds(chatId) : null
  const seen = new Set<number>()
  const prune = () => {
    if (before)
      cache.deleteMessages(
        chatId,
        before.filter((id) => !seen.has(id)),
      )
  }

  // 1. incremental: catch messages newer than our high-water (skipped on the very first sync).
  //    Small volume; not resumed mid-run — high-water only advances once it fully completes.
  if (hw > 0 && topId > hw) {
    let maxSeen = hw
    let batch: MsgLike[] = []
    for await (const msg of tg.iterHistory(chatId, { minId: hw })) {
      // Stryker disable next-line EqualityOperator: >= only reassigns maxSeen to the same value on a tie; unobservable
      if (msg.id > maxSeen) maxSeen = msg.id
      batch.push(msg)
      if (batch.length >= BATCH) {
        onBatch?.(cacheBatch(cache, batch))
        batch = []
      }
    }
    onBatch?.(cacheBatch(cache, batch))
    cache.bumpLastMsgId(chatId, maxSeen)
  }

  // 2. backfill old history, page by page. The frontier (oldest id fetched) is persisted
  //    after every page, so an interruption resumes here instead of restarting the chat.
  if (backfilled) return true
  let frontier = oldestId // 0 → start from the newest message
  for (;;) {
    const page = await tg.getHistory(chatId, {
      limit: PAGE,
      ...(frontier ? { maxId: frontier } : {}),
    })
    if (page.length === 0) {
      prune() // an empty first page is a chat whose history was cleared outright
      cache.markBackfilled(chatId)
      return true
    }
    onBatch?.(cacheBatch(cache, page))
    // every walked id, including the textless messages toCached drops — a superset of
    // what the cache holds, so the diff can only ever under-prune
    const ids = page.map((m) => m.id)
    for (const id of ids) seen.add(id)
    const pageMax = Math.max(...ids)
    const pageMin = Math.min(...ids)
    // first backfill page carries the newest messages — set the incremental high-water once
    // Stryker disable next-line ConditionalExpression: bumping every page is idempotent — pages only descend and bumpLastMsgId keeps the max, so re-bumping is a no-op
    if (cache.lastMsgId(chatId) === 0) cache.bumpLastMsgId(chatId, pageMax)
    if (frontier && pageMin >= frontier) {
      prune()
      cache.markBackfilled(chatId) // no downward progress → reached the bottom
      return true
    }
    frontier = pageMin
    cache.setOldestId(chatId, frontier) // persist resume point
  }
}

export async function syncAll(
  tg: SyncClient,
  cache: Cache,
  onProgress?: (p: SyncProgress) => void,
  sleepMs: (ms: number) => Promise<unknown> = sleep, // injectable so flood-wait backoff is testable
  includeBroadcasts = false, // see isBroadcast — set by SYNC_CHANNELS=1
): Promise<SyncProgress> {
  // NB: keep the Peer instance as-is — id/displayName are prototype getters that a
  // `{...dialog.peer}` spread would silently drop (→ getHistory(undefined)).
  const dialogs: { peer: PeerLike; topId: number }[] = []
  for await (const dialog of tg.iterDialogs()) {
    // Label first, skip second. A channel we decline to download still has messages in
    // the cache from before it was skipped, and the "where to search" filter can only
    // hide them if something wrote down what kind of peer they came from.
    cache.upsertChat(dialog.peer.id, dialog.peer.displayName, peerKind(dialog.peer))
    if (!includeBroadcasts && isBroadcast(dialog.peer)) continue
    dialogs.push({ peer: dialog.peer, topId: dialog.lastMessage?.id ?? 0 })
  }

  const progress: SyncProgress = {
    chatTitle: '',
    chatsDone: 0,
    chatsTotal: dialogs.length,
    messages: 0,
    errors: [],
  }
  let cursor = 0
  const one = async ({ peer, topId }: { peer: PeerLike; topId: number }) => {
    // NB no upsertChat here: the enumeration loop above already recorded every peer it
    // pushed, title and kind both, and it runs before any message is inserted
    progress.chatTitle = peer.displayName
    try {
      for (;;) {
        try {
          await syncChat(tg, cache, peer.id, topId, (n) => {
            progress.messages += n
            onProgress?.(progress)
          })
          break
        } catch (e) {
          const s = floodWaitSeconds(e)
          if (s === null) throw e // not a flood wait — handled per-chat below
          progress.floodWait = s
          onProgress?.(progress)
          await sleepMs((s + 1) * 1000)
          progress.floodWait = undefined
        }
      }
    } catch (e) {
      // one bad peer (PEER_ID_INVALID, CHANNEL_PRIVATE, left/deleted chat, …) must not
      // abort the whole sync — record it and move on. Its backfill state is preserved.
      progress.errors.push({
        chatId: peer.id,
        title: peer.displayName,
        error: e instanceof Error ? e.message : String(e),
      })
    }
    progress.chatsDone++
    onProgress?.(progress)
  }

  // Chats in flight at once. A history page is a round trip — a few hundred milliseconds
  // of pure waiting — and walking chats strictly one at a time spends most of a sync
  // idle. Overlapping them fills that gap without raising the request rate, because the
  // pacing middleware, not the round-trip time, is what decides the rate (see pacer.ts).
  // Keep it small: the win is latency-hiding, and past a handful of workers there is no
  // latency left to hide, only more ways to trip a flood.
  // spawned unconditionally: a worker with no chat left to take just returns
  const workers = Array.from({ length: CHAT_WORKERS }, async () => {
    for (;;) {
      const next = dialogs[cursor++]
      if (!next) return // the array is only read here, and ++ is atomic between awaits
      await one(next)
    }
  })
  await Promise.all(workers)
  return progress
}

// Minimal slice of the dispatcher attachRealtime wires into — lets tests drive the
// handlers without an mtcute client (Dispatcher.for is otherwise opaque)
export interface RealtimeDispatcher {
  onNewMessage(fn: (msg: MsgLike) => unknown): void
  onEditMessage(fn: (msg: MsgLike) => unknown): void
  onDeleteMessage(fn: (upd: { messageIds: number[]; channelId: number | null }) => unknown): void
  /** Raw TL updates — the only route to the ones mtcute exposes no typed handler for. */
  onRawUpdate(fn: (client: unknown, upd: RawUpdate) => unknown): void
}

/** The raw update fields we read. `_` is mtcute's TL constructor tag. */
export interface RawUpdate {
  _: string
  channelId?: number
  availableMinId?: number
}

/**
 * Telegram's "history was cleared" for a channel or supergroup: everything up to
 * `availableMinId` is gone. There is no typed handler for it, and no equivalent update
 * for a private chat or basic group at all — clearing one of those reaches the cache
 * only via a resync's prune (see `syncChat`).
 */
export const CHANNEL_HISTORY_CLEARED = 'updateChannelAvailableMessages'

export function attachRealtime(
  tg: TelegramClient,
  cache: Cache,
  onChange?: () => void,
  makeDispatcher: (tg: TelegramClient) => RealtimeDispatcher = (t) =>
    Dispatcher.for(t) as unknown as RealtimeDispatcher,
  includeBroadcasts = false,
) {
  const dp = makeDispatcher(tg)
  dp.onNewMessage(async (msg) => {
    if (!includeBroadcasts && isBroadcast(msg.chat)) return // same reasoning as syncAll's filter
    cache.upsertChat(msg.chat.id, msg.chat.displayName, peerKind(msg.chat))
    const c = toCached(msg)
    if (c) cache.insertMessages([c])
    // ponytail: this bump can race an unfinished first sync of the same chat —
    // a crash in that window loses the chat's older tail; wipe data/ and resync if it matters
    cache.bumpLastMsgId(msg.chat.id, msg.id)
    onChange?.()
  })
  dp.onEditMessage(async (msg) => {
    if (!includeBroadcasts && isBroadcast(msg.chat)) return
    const c = toCached(msg)
    if (c) cache.insertMessages([c])
    onChange?.()
  })
  dp.onDeleteMessage(async (upd) => {
    cache.deleteByUpdate(upd.messageIds, upd.channelId)
    onChange?.()
  })
  dp.onRawUpdate(async (_client, upd) => {
    if (upd._ !== CHANNEL_HISTORY_CLEARED) return
    // channelId comes unmarked; the cache keys chats by the marked (negative) form
    cache.deleteHistoryBefore(toggleChannelIdMark(upd.channelId!), upd.availableMinId!)
    onChange?.()
  })
}
