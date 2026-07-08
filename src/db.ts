import { Database } from 'bun:sqlite'
import { toggleChannelIdMark } from '@mtcute/core/utils.js'

export interface CachedMessage {
  chat_id: number
  id: number
  date: number // unix seconds
  sender: string
  text: string
  out: 0 | 1
}

export interface SearchRow extends CachedMessage {
  chat_title: string
}

const MIN_CHANNEL_MARKED = -1_000_000_000_000 // marked channel ids are below this

export function openCache(path: string) {
  const db = new Database(path, { create: true })
  db.exec(`
    pragma journal_mode = WAL;
    pragma synchronous = normal;
    create table if not exists chats (
      id integer primary key,
      title text not null default '',
      last_msg_id integer not null default 0,   -- newest synced id (incremental high-water)
      oldest_id integer not null default 0,     -- backfill frontier: lowest id fetched so far (0 = not started)
      backfilled integer not null default 0     -- 1 once history is fully downloaded
    );
    create table if not exists messages (
      chat_id integer not null,
      id integer not null,
      date integer not null,
      sender text not null default '',
      text text not null,
      out integer not null default 0,
      primary key (chat_id, id)
    ) without rowid;
  `)

  // migrate DBs created before backfill tracking existed
  for (const col of [
    'oldest_id integer not null default 0',
    'backfilled integer not null default 0',
  ]) {
    try {
      db.exec(`alter table chats add column ${col}`)
    } catch {
      /* column already exists */
    }
  }

  const upsertChatStmt = db.prepare(
    `insert into chats (id, title) values (?, ?)
     on conflict(id) do update set title = excluded.title`,
  )
  const lastMsgIdStmt = db.prepare(`select last_msg_id from chats where id = ?`)
  const bumpStmt = db.prepare(
    `insert into chats (id, last_msg_id) values (?1, ?2)
     on conflict(id) do update set last_msg_id = max(last_msg_id, ?2)`,
  )
  const backfillStmt = db.prepare(`select oldest_id, backfilled from chats where id = ?`)
  const setOldestStmt = db.prepare(
    `insert into chats (id, oldest_id) values (?1, ?2)
     on conflict(id) do update set oldest_id = ?2`,
  )
  const markBackfilledStmt = db.prepare(
    `insert into chats (id, backfilled) values (?1, 1)
     on conflict(id) do update set backfilled = 1`,
  )
  const insertMsgStmt = db.prepare(
    `insert into messages (chat_id, id, date, sender, text, out) values (?, ?, ?, ?, ?, ?)
     on conflict(chat_id, id) do update set text = excluded.text, date = excluded.date`,
  )
  const searchStmt = db.prepare(
    `select m.chat_id, m.id, m.date, m.sender, m.text, m.out, coalesce(c.title, '') as chat_title
     from messages m left join chats c on c.id = m.chat_id
     order by m.date desc`,
  )
  const countStmt = db.prepare(`select count(*) as n from messages`)

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

export type Cache = ReturnType<typeof openCache>
