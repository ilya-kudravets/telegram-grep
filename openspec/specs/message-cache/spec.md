# message-cache Specification

## Purpose
Holds the local copy of message history every other capability reads: search scans it, sync fills it, deletion prunes it. It is a port with several implementations (SQLite on Bun, in-memory in the browser), so what matters is the contract, not the engine.

## Requirements

### Requirement: One contract, several adapters

Every cache implementation MUST satisfy the same behavioural contract, and that contract MUST be expressed as one shared test suite rather than per-adapter tests.

#### Scenario: A new adapter is added
- **WHEN** a storage backend implements the cache port
- **THEN** it is exercised by the shared conformance suite, and a fact added to the contract is checked against every adapter

#### Scenario: An adapter diverges
- **WHEN** one adapter's behaviour differs from the contract in any way the port exposes
- **THEN** the shared suite fails for that adapter

### Requirement: Message identity and edits

A message MUST be identified by its chat and message id together. Re-storing a message that is already present MUST revise its text and date and MUST NOT duplicate the row, change its sender, or change its direction.

#### Scenario: The same message arrives twice
- **WHEN** a message already in the cache is stored again with different text
- **THEN** the stored row keeps its identity and sender, and its text and date are the newer ones

#### Scenario: An edit arrives over realtime
- **WHEN** an edited message is stored
- **THEN** subsequent searches return the edited text

### Requirement: Text is the only payload

Messages with no text (media without a caption, service messages) MUST NOT be stored at all.

#### Scenario: A photo with no caption is synced
- **WHEN** history containing text-less messages is stored
- **THEN** only the messages carrying text are in the cache, and the count reflects that

### Requirement: Per-chat sync bookkeeping

The cache MUST record, per chat, the newest message id already downloaded, the oldest id reached while backfilling, and whether history is complete. The newest-id marker MUST never move backwards. An unknown chat MUST read as "nothing downloaded" rather than as an error.

#### Scenario: A lower high-water is written
- **WHEN** the newest-id marker is set to a value below the stored one
- **THEN** the stored value is unchanged

#### Scenario: A chat that was never synced is read
- **WHEN** sync state is read for an id the cache has never seen
- **THEN** it reads as newest-id 0, oldest-id 0 and not complete, with no error

#### Scenario: A chat is known only from sync state
- **WHEN** a chat has sync state but no title was ever stored
- **THEN** its title reads as empty rather than missing

### Requirement: Peer kind stored per chat

The cache MUST record what kind of peer each chat is, so search can filter by it. A write that does not supply a kind MUST leave a known one standing, because the realtime and backfill paths both store chats without one. A chat whose kind was never established MUST read as unlabelled rather than as any particular kind.

#### Scenario: A chat is renamed by a path that knows no kind
- **WHEN** a chat with a known kind is stored again without one
- **THEN** its kind is unchanged

#### Scenario: A chat that has never appeared in a dialog list
- **WHEN** a chat is stored with no kind at all
- **THEN** it reads back as unlabelled

### Requirement: Sync bookkeeping can be discarded on its own

The cache MUST be able to forget every chat's sync bookkeeping in one step, and that step MUST leave the messages, the chat titles and the peer kinds untouched. Only what tells sync where it stopped may be reset.

#### Scenario: Clearing the bookkeeping
- **WHEN** the sync state is discarded
- **THEN** every chat reads as nothing-downloaded, while the message count, the titles and the kinds are as they were

### Requirement: An existing cache is upgraded in place

A cache created by an older version MUST keep working after new per-chat fields are added: the existing messages and sync state MUST survive, and the new fields MUST read as their defaults until something fills them.

#### Scenario: Opening a database from an earlier version
- **WHEN** a cache file created before a field existed is opened
- **THEN** its messages and sync markers are intact, the new field reads as its default, and no migration step has to be run by hand

### Requirement: Newest-first scan with chat titles

The cache MUST expose its messages newest first, each carrying its chat's title, and the scan MUST be lazy so a limited search can stop reading early.

#### Scenario: Search over a large cache with a limit
- **WHEN** a search asks for fewer rows than the cache holds
- **THEN** the scan stops once the limit is reached instead of materialising the whole archive

#### Scenario: A message whose chat is unknown
- **WHEN** a stored message has no matching chat row
- **THEN** it is still returned, with an empty chat title and no kind

### Requirement: Deletion by update

The cache MUST remove messages named by a deletion update. When the update identifies a channel, only that channel's messages MUST be removed; when it does not, the ids MUST be removed wherever they are found, because such ids are only unique within a dialog.

#### Scenario: Deletion in a channel
- **WHEN** a deletion update carries a channel id
- **THEN** only messages of that channel are removed, and the channel id is matched in the same marked form the cache stores

#### Scenario: Deletion in a private chat or group
- **WHEN** a deletion update carries no channel id
- **THEN** the named ids are removed from every chat that holds them

#### Scenario: An id list too large for one query
- **WHEN** a deletion names more ids than the storage engine can bind to a single statement
- **THEN** all of them are still removed, and no partial deletion is observable

### Requirement: Reconciling against upstream

The cache MUST be able to report every message id it holds for one chat, so a full re-walk can work out what Telegram no longer has, and MUST be able to drop a cleared prefix of a chat's history in one step.

#### Scenario: Listing what is held
- **WHEN** a chat's cached ids are requested
- **THEN** only that chat's ids are returned, and a chat with nothing cached reports an empty list rather than failing

#### Scenario: A cleared prefix
- **WHEN** history up to a given message is reported gone
- **THEN** that message and every older one in the chat are removed, and other chats are untouched
