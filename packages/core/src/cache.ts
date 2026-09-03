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

/**
 * Which bucket a peer falls into, for the "where to search" filter. The split follows
 * what this tool is *for* — finding your own regrettable messages, and the secrets other
 * people sent you — not Telegram's internal type zoo (see `peerKind` for the mapping):
 *
 *  - `saved` — Saved Messages, your own self-chat. Separate from `private` because it is
 *    where people deliberately stash passwords and seed phrases: the single
 *    highest-value place to search, and it should never hide inside a broader bucket.
 *  - `private` — correspondence with actual people.
 *  - `bot` — bots *and* Telegram's own service account (id 777000). This is where login
 *    codes, 2FA prompts and bank alerts land, so it is worth both searching alone and
 *    excluding alone.
 *  - `group` — rooms your messages live in and can be deleted from. Channel comments end
 *    up here too: a comment is a message in the channel's linked discussion supergroup.
 *  - `channel` — feeds. Ordinary members cannot post to a broadcast channel or a
 *    gigagroup at all, so nothing there is yours.
 *
 * `''` means a chat stored before kinds existed, or one this build has never seen in a
 * dialog list. It is deliberately *never* filtered out — hiding messages because of a
 * missing label would look like data loss.
 */
export type PeerKind = 'saved' | 'private' | 'bot' | 'group' | 'channel'

export interface SearchRow extends CachedMessage {
  chat_title: string
  chat_kind: PeerKind | ''
}

export interface Cache {
  upsertChat(id: number, title: string | null | undefined, kind?: PeerKind | ''): void
  lastMsgId(chatId: number): number
  bumpLastMsgId(chatId: number, msgId: number): void
  /** backfill frontier: resume downloading old history from where we left off */
  backfillState(chatId: number): { oldestId: number; backfilled: boolean }
  setOldestId(chatId: number, id: number): void
  markBackfilled(chatId: number): void
  /**
   * Forgets every chat's sync bookkeeping (high-water mark and backfill frontier), so
   * the next sync walks all history again. Cached messages stay put here: re-inserting
   * them is an upsert, so an *interrupted* resync leaves the user with everything they
   * already had. The re-walk itself is what removes messages Telegram no longer has —
   * see `messageIds`.
   */
  resetSyncState(): void
  insertMessages(msgs: CachedMessage[]): void
  /**
   * Every cached message id in one chat. Only a full re-walk uses this: it needs to know
   * what the cache held *before* the walk to work out what Telegram has since dropped,
   * because nothing else in a sync ever deletes and history cleared upstream would
   * otherwise stay cached forever.
   */
  messageIds(chatId: number): number[]
  deleteMessages(chatId: number, ids: number[]): void
  /** Drops a cleared prefix of a chat's history: every id up to and including `maxId`. */
  deleteHistoryBefore(chatId: number, maxId: number): void
  deleteByUpdate(ids: number[], channelId: number | null): void
  iterAll(): IterableIterator<SearchRow>
  count(): number
  close(): void
}

// marked channel ids are below this
export const MIN_CHANNEL_MARKED = -1_000_000_000_000

// Portable, driver-agnostic SQL (standard SQLite). Shared by every adapter.
export const SCHEMA_SQL = `
  -- Must precede the first create table: auto_vacuum can only be turned on for a database
  -- with no tables yet, or by a full VACUUM later — and VACUUM needs free space equal to
  -- the whole file, which a phone-sized archive won't have. Costs ~0.1% of file size.
  -- Existing databases silently keep whatever they were created with.
  -- ponytail: enabling it only makes reclaiming possible; freed pages return to the OS when
  -- something runs 'pragma incremental_vacuum'. Add that call wherever space is actually wanted.
  pragma auto_vacuum = incremental;
  pragma journal_mode = WAL;
  pragma synchronous = normal;
  create table if not exists chats (
    id integer primary key,
    title text not null default '',
    last_msg_id integer not null default 0,   -- newest synced id (incremental high-water)
    oldest_id integer not null default 0,     -- backfill frontier: lowest id fetched so far (0 = not started)
    backfilled integer not null default 0,    -- 1 once history is fully downloaded
    kind text not null default ''             -- PeerKind, '' when never seen in a dialog list
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
  "kind text not null default ''",
]

export const SQL = {
  // `nullif(excluded.kind, '')` keeps a known kind when a caller omits one — otherwise a
  // single unlabelled upsert would erase what the dialog list had already established
  upsertChat: `insert into chats (id, title, kind) values (?, ?, ?)
     on conflict(id) do update set title = excluded.title,
       kind = coalesce(nullif(excluded.kind, ''), chats.kind)`,
  lastMsgId: `select last_msg_id from chats where id = ?`,
  bumpLastMsgId: `insert into chats (id, last_msg_id) values (?1, ?2)
     on conflict(id) do update set last_msg_id = max(last_msg_id, ?2)`,
  backfillState: `select oldest_id, backfilled from chats where id = ?`,
  setOldestId: `insert into chats (id, oldest_id) values (?1, ?2)
     on conflict(id) do update set oldest_id = ?2`,
  markBackfilled: `insert into chats (id, backfilled) values (?1, 1)
     on conflict(id) do update set backfilled = 1`,
  resetSyncState: `update chats set last_msg_id = 0, oldest_id = 0, backfilled = 0`,
  messageIds: `select id from messages where chat_id = ?`,
  deleteHistoryBefore: `delete from messages where chat_id = ? and id <= ?`,
  insertMessage: `insert into messages (chat_id, id, date, sender, text, out) values (?, ?, ?, ?, ?, ?)
     on conflict(chat_id, id) do update set text = excluded.text, date = excluded.date`,
  search: `select m.chat_id, m.id, m.date, m.sender, m.text, m.out,
       coalesce(c.title, '') as chat_title, coalesce(c.kind, '') as chat_kind
     from messages m left join chats c on c.id = m.chat_id
     order by m.date desc`,
  count: `select count(*) as n from messages`,
}
