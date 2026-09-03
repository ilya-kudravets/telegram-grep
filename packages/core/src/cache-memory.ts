// Portable in-memory adapter for the `Cache` port — the storage half of the browser
// client, and the reason the port's contract lives in a shared conformance suite.
//
// Why not IndexedDB (or sqlite-wasm) directly: the port is synchronous (`iterAll()`
// returns an iterator, `count()` a number) and IndexedDB's API is not, while
// sqlite-wasm's persistent VFS needs a worker plus headers GitHub Pages cannot send.
// Search doesn't need SQL either — `searchCache` scans `iterAll()` with a JS regex
// (see search.ts), so SQL was only ever the storage engine here. So the browser keeps
// the cache in memory and persists snapshots around it; this file stays platform-free.
//
// ponytail: a Telegram archive that fits a phone fits an array. Add paging (or
// sqlite-wasm in a worker behind an async port) if a cache ever outgrows the tab's heap.
import { toggleChannelIdMark } from '@mtcute/core/utils.js'
import { type Cache, type CachedMessage, MIN_CHANNEL_MARKED, type SearchRow } from './cache'

/** One row of the `chats` table, named as the port speaks rather than as SQL does. */
export interface ChatRow {
  title: string
  lastMsgId: number
  oldestId: number
  backfilled: boolean
}

/** Plain, JSON-serialisable state — what a persistence layer stores and restores. */
export interface CacheSnapshot {
  chats: [number, ChatRow][]
  messages: CachedMessage[]
}

export interface MemoryCache extends Cache {
  /** Current contents, safe to structuredClone/JSON.stringify into a store. */
  snapshot(): CacheSnapshot
}

const emptyChat = (): ChatRow => ({ title: '', lastMsgId: 0, oldestId: 0, backfilled: false })

export function createMemoryCache(from?: CacheSnapshot): MemoryCache {
  const chats = new Map<number, ChatRow>(from?.chats)
  // chat id → message id → message: mirrors the primary key, so the per-chat deletes
  // the port exposes stay a single lookup instead of a scan
  const messages = new Map<number, Map<number, CachedMessage>>()
  for (const m of from?.messages ?? []) put(m)

  function put(m: CachedMessage) {
    let byId = messages.get(m.chat_id)
    if (!byId) {
      byId = new Map()
      messages.set(m.chat_id, byId)
    }
    const existing = byId.get(m.id)
    // matches SQL.insertMessage's `do update set text, date`: an edit revises the body,
    // never the sender or the out flag
    byId.set(m.id, existing ? { ...existing, text: m.text, date: m.date } : m)
  }

  function chat(id: number): ChatRow {
    let row = chats.get(id)
    if (!row) {
      row = emptyChat()
      chats.set(id, row)
    }
    return row
  }

  function drop(ids: number[], matches: (chatId: number) => boolean) {
    const wanted = new Set(ids)
    for (const [chatId, byId] of messages) {
      if (!matches(chatId)) continue
      for (const id of wanted) byId.delete(id)
    }
  }

  return {
    upsertChat(id: number, title: string | null | undefined) {
      // peers without a displayName (deleted accounts, odd service peers) store '' —
      // the port promises a string to every reader of chat_title
      chat(id).title = title ?? ''
    },
    lastMsgId(chatId: number): number {
      return chats.get(chatId)?.lastMsgId ?? 0
    },
    bumpLastMsgId(chatId: number, msgId: number) {
      // Stryker disable next-line EqualityOperator: msgId===0 would only create an empty chat row with lastMsgId 0, indistinguishable from no row through the public API
      if (msgId > 0) {
        const row = chat(chatId)
        row.lastMsgId = Math.max(row.lastMsgId, msgId)
      }
    },
    backfillState(chatId: number): { oldestId: number; backfilled: boolean } {
      const row = chats.get(chatId)
      return { oldestId: row?.oldestId ?? 0, backfilled: row?.backfilled ?? false }
    },
    setOldestId(chatId: number, id: number) {
      chat(chatId).oldestId = id
    },
    markBackfilled(chatId: number) {
      chat(chatId).backfilled = true
    },
    resetSyncState() {
      // titles survive: they came from the dialog list, not from history, and keeping
      // them means search results stay labelled while the resync is still running
      for (const row of chats.values()) {
        row.lastMsgId = 0
        row.oldestId = 0
        row.backfilled = false
      }
    },
    insertMessages(msgs: CachedMessage[]) {
      // NB: inserting does NOT advance lastMsgId — history downloads newest-first, so
      // bumping mid-chat would make a crashed sync skip the older tail on restart.
      for (const m of msgs) put(m)
    },
    deleteMessages(chatId: number, ids: number[]) {
      drop(ids, (id) => id === chatId)
    },
    // DeleteMessageUpdate gives channelId for channels, null otherwise. Non-channel
    // message ids are unique account-wide, channel ids are per-channel.
    deleteByUpdate(ids: number[], channelId: number | null) {
      if (channelId !== null) {
        const marked = toggleChannelIdMark(channelId)
        drop(ids, (id) => id === marked)
      } else {
        drop(ids, (id) => id > MIN_CHANNEL_MARKED)
      }
    },
    *iterAll(): IterableIterator<SearchRow> {
      const rows: SearchRow[] = []
      for (const byId of messages.values()) {
        for (const m of byId.values()) {
          rows.push({ ...m, chat_title: chats.get(m.chat_id)?.title ?? '' })
        }
      }
      rows.sort((a, b) => b.date - a.date) // newest first, as SQL.search orders
      yield* rows
    },
    count(): number {
      let n = 0
      for (const byId of messages.values()) n += byId.size
      return n
    },
    close() {
      // nothing to release: the persistence layer owns the snapshot lifecycle
    },
    snapshot(): CacheSnapshot {
      return {
        chats: [...chats].map(([id, row]) => [id, { ...row }]),
        messages: [...messages.values()].flatMap((byId) => [...byId.values()]),
      }
    },
  }
}
