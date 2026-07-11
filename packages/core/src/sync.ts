import type { TelegramClient } from '@mtcute/core/client.js'
import { Dispatcher } from '@mtcute/dispatcher'
import type { Cache, CachedMessage } from './cache'

// The subset of mtcute's Message we actually read — keeps tests free of mtcute internals
export interface MsgLike {
  id: number
  text: string
  date: Date
  isOutgoing: boolean
  sender: { displayName: string }
  chat: { id: number; displayName: string }
}

// The subset of TelegramClient sync needs
export interface SyncClient {
  iterDialogs(params?: object): AsyncIterable<{
    peer: { id: number; displayName: string }
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
      cache.markBackfilled(chatId)
      return true
    }
    onBatch?.(cacheBatch(cache, page))
    const ids = page.map((m) => m.id)
    const pageMax = Math.max(...ids)
    const pageMin = Math.min(...ids)
    // first backfill page carries the newest messages — set the incremental high-water once
    // Stryker disable next-line ConditionalExpression: bumping every page is idempotent — pages only descend and bumpLastMsgId keeps the max, so re-bumping is a no-op
    if (cache.lastMsgId(chatId) === 0) cache.bumpLastMsgId(chatId, pageMax)
    if (frontier && pageMin >= frontier) {
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
): Promise<SyncProgress> {
  // NB: keep the Peer instance as-is — id/displayName are prototype getters that a
  // `{...dialog.peer}` spread would silently drop (→ getHistory(undefined)).
  const dialogs: { peer: { id: number; displayName: string }; topId: number }[] = []
  for await (const dialog of tg.iterDialogs()) {
    dialogs.push({ peer: dialog.peer, topId: dialog.lastMessage?.id ?? 0 })
  }

  const progress: SyncProgress = {
    chatTitle: '',
    chatsDone: 0,
    chatsTotal: dialogs.length,
    messages: 0,
    errors: [],
  }
  for (const { peer, topId } of dialogs) {
    cache.upsertChat(peer.id, peer.displayName)
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
  return progress
}

// Minimal slice of the dispatcher attachRealtime wires into — lets tests drive the
// handlers without an mtcute client (Dispatcher.for is otherwise opaque)
export interface RealtimeDispatcher {
  onNewMessage(fn: (msg: MsgLike) => unknown): void
  onEditMessage(fn: (msg: MsgLike) => unknown): void
  onDeleteMessage(fn: (upd: { messageIds: number[]; channelId: number | null }) => unknown): void
}

export function attachRealtime(
  tg: TelegramClient,
  cache: Cache,
  onChange?: () => void,
  makeDispatcher: (tg: TelegramClient) => RealtimeDispatcher = (t) =>
    Dispatcher.for(t) as unknown as RealtimeDispatcher,
) {
  const dp = makeDispatcher(tg)
  dp.onNewMessage(async (msg) => {
    cache.upsertChat(msg.chat.id, msg.chat.displayName)
    const c = toCached(msg)
    if (c) cache.insertMessages([c])
    // ponytail: this bump can race an unfinished first sync of the same chat —
    // a crash in that window loses the chat's older tail; wipe data/ and resync if it matters
    cache.bumpLastMsgId(msg.chat.id, msg.id)
    onChange?.()
  })
  dp.onEditMessage(async (msg) => {
    const c = toCached(msg)
    if (c) cache.insertMessages([c])
    onChange?.()
  })
  dp.onDeleteMessage(async (upd) => {
    cache.deleteByUpdate(upd.messageIds, upd.channelId)
    onChange?.()
  })
}
