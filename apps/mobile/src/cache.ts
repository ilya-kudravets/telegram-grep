// Platform adapter: implements the `Cache` port on top of expo-sqlite.
// Sibling of packages/bun's bun-sqlite adapter — same SCHEMA_SQL/SQL from
// @tg/core/cache, so the schema and queries stay identical across platforms.
// expo-sqlite's *Sync API matches the synchronous Cache port 1:1.
import {
  type Cache,
  type CachedMessage,
  MIGRATION_COLUMNS,
  MIN_CHANNEL_MARKED,
  SCHEMA_SQL,
  type SearchRow,
  SQL,
} from '@tg/core/cache'
import { toggleChannelIdMark } from '@mtcute/core/utils.js'
import * as SQLite from 'expo-sqlite'

// mtcute auth is persisted as an exported session string in a tiny kv table in the
// same DB (no extra native dep, no mtcute storage driver). Update-loop state (pts/qts)
// is NOT persisted — realtime catch-up restarts each launch; syncMobile re-fetches.
export interface MobileCache extends Cache {
  getSession(): string | null
  setSession(session: string): void
}

const KV_SQL = `create table if not exists kv (k text primary key, v text not null);`

export function openCache(name = 'tg-cache.db'): MobileCache {
  const db = SQLite.openDatabaseSync(name)
  db.execSync(SCHEMA_SQL)
  db.execSync(KV_SQL)

  for (const col of MIGRATION_COLUMNS) {
    try {
      db.execSync(`alter table chats add column ${col}`)
    } catch {
      /* column already exists */
    }
  }

  const insertMsgStmt = db.prepareSync(SQL.insertMessage)

  return {
    upsertChat(id: number, title: string | null | undefined) {
      // bind '' not NULL — some peers have no displayName and chats.title is NOT NULL
      db.runSync(SQL.upsertChat, [id, title ?? ''])
    },
    lastMsgId(chatId: number): number {
      const r = db.getFirstSync<{ last_msg_id: number }>(SQL.lastMsgId, [chatId])
      return r?.last_msg_id ?? 0
    },
    bumpLastMsgId(chatId: number, msgId: number) {
      if (msgId > 0) db.runSync(SQL.bumpLastMsgId, [chatId, msgId])
    },
    backfillState(chatId: number): { oldestId: number; backfilled: boolean } {
      const r = db.getFirstSync<{ oldest_id: number; backfilled: number }>(SQL.backfillState, [chatId])
      return { oldestId: r?.oldest_id ?? 0, backfilled: !!r?.backfilled }
    },
    setOldestId(chatId: number, id: number) {
      db.runSync(SQL.setOldestId, [chatId, id])
    },
    markBackfilled(chatId: number) {
      db.runSync(SQL.markBackfilled, [chatId])
    },
    insertMessages(msgs: CachedMessage[]) {
      if (!msgs.length) return
      db.withTransactionSync(() => {
        for (const m of msgs) {
          insertMsgStmt.executeSync([m.chat_id, m.id, m.date, m.sender, m.text, m.out])
        }
      })
    },
    deleteMessages(chatId: number, ids: number[]) {
      if (!ids.length) return
      const ph = ids.map(() => '?').join(',')
      db.runSync(`delete from messages where chat_id = ? and id in (${ph})`, [chatId, ...ids])
    },
    // DeleteMessageUpdate gives channelId for channels, null otherwise (see bun adapter).
    deleteByUpdate(ids: number[], channelId: number | null) {
      if (!ids.length) return
      const ph = ids.map(() => '?').join(',')
      if (channelId !== null) {
        db.runSync(`delete from messages where chat_id = ? and id in (${ph})`, [
          toggleChannelIdMark(channelId),
          ...ids,
        ])
      } else {
        db.runSync(`delete from messages where chat_id > ? and id in (${ph})`, [MIN_CHANNEL_MARKED, ...ids])
      }
    },
    iterAll(): IterableIterator<SearchRow> {
      // getEachSync streams rows lazily so searchCache can break early on its limit
      return db.getEachSync<SearchRow>(SQL.search) as IterableIterator<SearchRow>
    },
    count(): number {
      return db.getFirstSync<{ n: number }>(SQL.count)?.n ?? 0
    },
    getSession(): string | null {
      return db.getFirstSync<{ v: string }>(`select v from kv where k = 'session'`)?.v ?? null
    },
    setSession(session: string) {
      db.runSync(`insert into kv (k, v) values ('session', ?) on conflict(k) do update set v = excluded.v`, [
        session,
      ])
    },
    close() {
      insertMsgStmt.finalizeSync()
      db.closeSync()
    },
  }
}
