// Domain port: the message-cache repository. The application layer (sync/search/
// deleter) depends only on this interface — never on a concrete SQLite driver.
// Platform adapters (bun:sqlite, op-sqlite on RN, …) implement `Cache` against the
// shared SQL below, so the schema and queries stay identical across platforms.

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

export interface Cache {
  upsertChat(id: number, title: string | null | undefined): void
  lastMsgId(chatId: number): number
  bumpLastMsgId(chatId: number, msgId: number): void
  /** backfill frontier: resume downloading old history from where we left off */
  backfillState(chatId: number): { oldestId: number; backfilled: boolean }
  setOldestId(chatId: number, id: number): void
  markBackfilled(chatId: number): void
  insertMessages(msgs: CachedMessage[]): void
  deleteMessages(chatId: number, ids: number[]): void
  deleteByUpdate(ids: number[], channelId: number | null): void
  iterAll(): IterableIterator<SearchRow>
  count(): number
  close(): void
}

// marked channel ids are below this
export const MIN_CHANNEL_MARKED = -1_000_000_000_000

// Portable, driver-agnostic SQL (standard SQLite). Shared by every adapter.
export const SCHEMA_SQL = `
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
`

// columns added to `chats` after the original schema — applied best-effort on open
// to migrate DBs created before backfill tracking existed
export const MIGRATION_COLUMNS = [
  'oldest_id integer not null default 0',
  'backfilled integer not null default 0',
]

export const SQL = {
  upsertChat: `insert into chats (id, title) values (?, ?)
     on conflict(id) do update set title = excluded.title`,
  lastMsgId: `select last_msg_id from chats where id = ?`,
  bumpLastMsgId: `insert into chats (id, last_msg_id) values (?1, ?2)
     on conflict(id) do update set last_msg_id = max(last_msg_id, ?2)`,
  backfillState: `select oldest_id, backfilled from chats where id = ?`,
  setOldestId: `insert into chats (id, oldest_id) values (?1, ?2)
     on conflict(id) do update set oldest_id = ?2`,
  markBackfilled: `insert into chats (id, backfilled) values (?1, 1)
     on conflict(id) do update set backfilled = 1`,
  insertMessage: `insert into messages (chat_id, id, date, sender, text, out) values (?, ?, ?, ?, ?, ?)
     on conflict(chat_id, id) do update set text = excluded.text, date = excluded.date`,
  search: `select m.chat_id, m.id, m.date, m.sender, m.text, m.out, coalesce(c.title, '') as chat_title
     from messages m left join chats c on c.id = m.chat_id
     order by m.date desc`,
  count: `select count(*) as n from messages`,
}
