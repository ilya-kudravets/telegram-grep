# history-sync Specification

## Purpose
Filling and maintaining the archive: a first run that downloads years of history over a rate-limited API, later runs that fetch only what is new, and live updates in between. Interruption is the normal case, not the exception.

## Requirements

### Requirement: Incremental catch-up without losing the tail

A chat whose history is already complete MUST be caught up by fetching only messages newer than the last recorded one. The newest-id marker MUST advance only after that pass completes in full.

#### Scenario: A few new messages since the last run
- **WHEN** sync runs on a chat with newer messages than the cache holds
- **THEN** only the newer messages are fetched, and the newest-id marker moves to the newest one seen

#### Scenario: The catch-up pass is interrupted
- **WHEN** the process dies partway through a chat's catch-up
- **THEN** the newest-id marker is unchanged, so the next run fetches that range again instead of treating it as downloaded

### Requirement: Resumable backfill

History older than the cache MUST be downloaded page by page, newest to oldest, persisting the frontier after every page so an interruption resumes from there. Reaching an empty page, or a page that makes no downward progress, MUST mark the chat complete.

#### Scenario: Interrupted backfill
- **WHEN** a chat with tens of thousands of messages is interrupted mid-backfill and synced again
- **THEN** it resumes from the last persisted page rather than from the newest message

#### Scenario: The bottom of a chat
- **WHEN** a page comes back empty, or its oldest id is not older than the current frontier
- **THEN** the chat is marked complete and no further pages are requested

### Requirement: Unchanged chats cost nothing

A chat whose history is complete and whose newest message is already cached MUST be skipped with no network calls at all.

#### Scenario: Re-running sync straight away
- **WHEN** sync runs again with no new messages anywhere
- **THEN** no history request is made for any chat

### Requirement: Rate limits are pauses, not failures

A flood-wait response MUST be treated as a wait: reported to the interface, slept out, and the same chat retried, without losing progress. The transport MUST be configured to tolerate the long waits a full history dump provokes rather than failing after the default few seconds.

#### Scenario: Flood wait during a full dump
- **WHEN** the API answers with a flood wait of N seconds
- **THEN** the interface shows the wait, the process sleeps slightly longer than N, and the same chat continues afterwards

#### Scenario: Testing the backoff
- **WHEN** the backoff is exercised in tests
- **THEN** the sleep is injectable, so the test does not spend real seconds waiting

### Requirement: One unreachable chat does not abort the run

A failure for a single chat MUST be recorded and reported, its sync state left intact, and the remaining chats MUST still be synced.

#### Scenario: A private or deleted chat in the dialog list
- **WHEN** one chat answers with an error that is not a flood wait
- **THEN** it is recorded with its title and message, sync continues with the next chat, and the run finishes reporting how many were skipped

### Requirement: Feeds are not downloaded

A peer nobody but an admin can post to MUST NOT have its history downloaded by default: nothing in it belongs to the user, and one such archive outweighs every real conversation they have. Opting back in MUST be possible. Messages already cached from such a peer MUST remain searchable — the default governs what is fetched, never what is discarded.

#### Scenario: A broadcast channel in the dialog list
- **WHEN** sync runs over a dialog list containing a broadcast channel
- **THEN** no history is requested for it, and it is not counted among the chats to sync

#### Scenario: Opting back in
- **WHEN** the operator explicitly asks for feeds to be included
- **THEN** their history is downloaded like any other chat's

#### Scenario: A peer that used to accept member messages
- **WHEN** a peer is admin-only now but was an ordinary group before
- **THEN** its history is still downloaded, because the messages from before the change are the user's

#### Scenario: Already-cached feed messages
- **WHEN** a feed's messages are in the cache from before the default changed
- **THEN** they still appear in searches that include feeds

### Requirement: Every dialog is labelled with its kind

Sync MUST record what kind of peer each dialog is, and MUST do so for every dialog it enumerates — including the ones whose history it declines to download. Classification MUST use only information already carried by the dialog peer, so labelling costs no additional requests.

#### Scenario: A channel whose history is skipped
- **WHEN** sync skips a feed's history
- **THEN** that peer is still labelled, so messages cached from it earlier can be filtered by kind

#### Scenario: Labelling a peer
- **WHEN** a dialog is enumerated
- **THEN** its kind is derived from the peer alone, with no extra request per chat

### Requirement: Forcing a full resync

The user MUST be able to discard the per-chat sync bookkeeping so that all history is walked again. Doing so MUST NOT remove cached messages: re-storing them revises rather than duplicates, so a resync repairs and refreshes the archive and an interrupted one leaves the user everything they already had. A resync MUST NOT be startable while one is already running.

#### Scenario: History the first pass never delivered
- **WHEN** a chat was marked complete but is missing messages, and the user forces a resync
- **THEN** its history is walked again from the newest message, and the missing messages land

#### Scenario: The cache during a resync
- **WHEN** a resync is running
- **THEN** searches still return everything cached before it started, with chat titles and kinds intact

#### Scenario: Asking twice
- **WHEN** a resync is requested while a sync is already walking
- **THEN** the request is refused rather than starting a second walk over the same chats

### Requirement: Progress is observable

Sync MUST publish a progress snapshot — current chat, chats done and total, messages stored, current flood wait, and the accumulated per-chat failures — on every batch and every chat, and the interface MUST be able to throttle without the domain doing it.

#### Scenario: Watching a long sync
- **WHEN** a full history dump is running
- **THEN** the interface can show which chat is being read, how far along the run is, how many messages have landed, and any wait in progress

### Requirement: Live updates keep the cache current

While connected, new, edited and deleted messages MUST be applied to the cache as they arrive, and each MUST signal that the cache changed so an active search can re-run.

#### Scenario: A message arrives while searching
- **WHEN** a new message matching the active pattern arrives
- **THEN** it is stored, its chat's title is refreshed, and the interface re-runs the search

#### Scenario: A message is deleted elsewhere
- **WHEN** a deletion update arrives
- **THEN** those messages are removed from the cache and stop appearing in results
