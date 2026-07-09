// Platform adapter: implements the `Cache` port on top of bun:sqlite.
// An RN app would add a sibling adapter (op-sqlite/expo-sqlite) reusing the same
// SQL from ../core/cache — the domain never changes.
import { Database } from 'bun:sqlite'
import { toggleChannelIdMark } from '@mtcute/core/utils.js'
import {
  type Cache,
  type CachedMessage,
  MIGRATION_COLUMNS,
  MIN_CHANNEL_MARKED,
  SCHEMA_SQL,
  type SearchRow,
  SQL,
} from '../core/cache'

export function openCache(path: string): Cache {
  const db = new Database(path, { create: true })
  db.exec(SCHEMA_SQL)

  for (const col of MIGRATION_COLUMNS) {
    try {
      db.exec(`alter table chats add column ${col}`)
    } catch {
      /* column already exists */
    }
  }

  const upsertChatStmt = db.prepare(SQL.upsertChat)
  const lastMsgIdStmt = db.prepare(SQL.lastMsgId)
  const bumpStmt = db.prepare(SQL.bumpLastMsgId)
  const backfillStmt = db.prepare(SQL.backfillState)
  const setOldestStmt = db.prepare(SQL.setOldestId)
  const markBackfilledStmt = db.prepare(SQL.markBackfilled)
  const insertMsgStmt = db.prepare(SQL.insertMessage)
  const searchStmt = db.prepare(SQL.search)
  const countStmt = db.prepare(SQL.count)

  // NB: inserting does NOT advance last_msg_id — history downloads newest-first,
  // so bumping mid-chat would make a crashed sync skip the older tail on restart.
  // Callers bump explicitly once a chat is fully synced (or per realtime message).
  const insertMany = db.transaction((msgs: CachedMessage[]) => {
    for (const m of msgs) {
      insertMsgStmt.run(m.chat_id, m.id, m.date, m.sender, m.text, m.out)
    }
  })

  return {
    upsertChat(id: number, title: string | null | undefined) {
      // some peers (deleted accounts, odd service peers) have no displayName → bind '' not NULL,
      // otherwise SQLite raises NOT NULL on chats.title (the column default only applies when omitted)
      upsertChatStmt.run(id, title ?? '')
    },
    lastMsgId(chatId: number): number {
      return (lastMsgIdStmt.get(chatId) as { last_msg_id: number } | null)?.last_msg_id ?? 0
    },
    bumpLastMsgId(chatId: number, msgId: number) {
      // Stryker disable next-line EqualityOperator: msgId===0 would only create an empty chat row with last_msg_id 0, indistinguishable from no row through the public API
      if (msgId > 0) bumpStmt.run(chatId, msgId)
    },
    // backfill frontier: resume downloading old history from where we left off
    backfillState(chatId: number): { oldestId: number; backfilled: boolean } {
      const r = backfillStmt.get(chatId) as { oldest_id: number; backfilled: number } | null
      return { oldestId: r?.oldest_id ?? 0, backfilled: !!r?.backfilled }
    },
    setOldestId(chatId: number, id: number) {
      setOldestStmt.run(chatId, id)
    },
    markBackfilled(chatId: number) {
      markBackfilledStmt.run(chatId)
    },
    insertMessages(msgs: CachedMessage[]) {
      // Stryker disable next-line ConditionalExpression: insertMany([]) is a no-op empty transaction; the guard only avoids that empty transaction, no observable difference
      if (msgs.length) insertMany(msgs)
    },
    deleteMessages(chatId: number, ids: number[]) {
      // Stryker disable next-line ConditionalExpression: guard is a pure optimization — with empty ids the query becomes a harmless `id in ()` that deletes nothing
      if (!ids.length) return
      db.run(`delete from messages where chat_id = ? and id in (${ids.map(() => '?').join(',')})`, [
        chatId,
        ...ids,
      ])
    },
    // DeleteMessageUpdate gives channelId for channels, null otherwise.
    // Non-channel message ids are unique account-wide, channel ids are per-channel.
    deleteByUpdate(ids: number[], channelId: number | null) {
      // Stryker disable next-line ConditionalExpression: guard is a pure optimization — with empty ids the query becomes a harmless `id in ()` that deletes nothing
      if (!ids.length) return
      const ph = ids.map(() => '?').join(',')
      if (channelId !== null) {
        db.run(`delete from messages where chat_id = ? and id in (${ph})`, [
          toggleChannelIdMark(channelId),
          ...ids,
        ])
      } else {
        db.run(`delete from messages where chat_id > ? and id in (${ph})`, [
          MIN_CHANNEL_MARKED,
          ...ids,
        ])
      }
    },
    iterAll(): IterableIterator<SearchRow> {
      return searchStmt.iterate() as IterableIterator<SearchRow>
    },
    count(): number {
      return (countStmt.get() as { n: number }).n
    },
    close() {
      db.close()
    },
  }
}
