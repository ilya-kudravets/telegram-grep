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

### Requirement: Flood waits are damped, never pre-empted

Bulk read calls MUST NOT be delayed until Telegram has actually answered with a flood wait. Pre-emptive pacing was tried and measured against a rate-limited server: it was 1.5-2x slower than no pacing at all, consumed the whole gain from walking chats concurrently, and on a tight limit throttled well below what the account allowed. A `messages.getHistory` flood wait is short — roughly the time until the limit frees — so paying an occasional one is cheaper than slowing every request to avoid it.

What MUST be damped is the repetition. Once a flood has occurred, the gap between those calls MUST widen, and every clean response MUST shrink it again until it reaches zero, so a brief squeeze leaves no residue on the rest of the run. The widening MUST be bounded, so a sustained squeeze cannot stall a sync outright.

Damping MUST apply to the connection rather than to one walk, since a sync, a search and a delete share the account's budget, and MUST sit where the raw flood responses are visible — outside the retrying layer a flood looks only like a slow call.

#### Scenario: An account with room to spare
- **WHEN** history is downloaded and Telegram never objects
- **THEN** no delay whatsoever is added, and the download runs as fast as the connection allows

#### Scenario: The first flood wait
- **WHEN** a bulk read call answers with a flood wait
- **THEN** the calls after it are spaced out, and further floods widen that spacing up to a ceiling

#### Scenario: The squeeze passes
- **WHEN** responses come back clean again for a while
- **THEN** the spacing shrinks back to nothing rather than persisting for the rest of the run

#### Scenario: Calls that are not part of a bulk walk
- **WHEN** a deletion or an authentication call is made
- **THEN** it is never damped, because it is not what exhausts the budget

#### Scenario: A failure that is not a rate limit
- **WHEN** a call fails for any other reason, or the socket dies
- **THEN** nothing starts damping, since neither says anything about the account's budget

### Requirement: Chats are walked concurrently

A history page is a round trip, so walking chats strictly one at a time leaves the connection idle for most of a sync. Several chats MUST be in flight at once, bounded to a small number: measured against a server with room to spare this is the whole speed-up, close to linear in the number of workers, and against a rate-limited one it costs nothing, because the limit rather than the client is what governs the total.

Each chat's own pages MUST stay sequential, because the backfill frontier is what makes an interrupted walk resumable. Every chat MUST be walked exactly once, and a failure in one MUST NOT abort the others.

#### Scenario: Many chats to walk
- **WHEN** a sync has more chats than the concurrency bound
- **THEN** that many are in flight at a time, each one picked up exactly once, and all of them are finished before the run reports done

#### Scenario: One chat fails while others are in flight
- **WHEN** a chat errors mid-run
- **THEN** it is recorded and the chats running alongside it finish normally

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

The user MUST be able to discard the per-chat sync bookkeeping so that all history is walked again. A resync MUST NOT be startable while one is already running.

Discarding the bookkeeping MUST NOT itself remove cached messages, so an interrupted resync leaves the user everything they already had. The walk it triggers is what reconciles: a walk that runs from a chat's newest message to the bottom MUST drop the cached messages it never saw, because that is the only point at which the cache can learn what Telegram no longer holds.

#### Scenario: History the first pass never delivered
- **WHEN** a chat was marked complete but is missing messages, and the user forces a resync
- **THEN** its history is walked again from the newest message, and the missing messages land

#### Scenario: History cleared on Telegram's side
- **WHEN** the user cleared a chat's history in Telegram and then forces a resync
- **THEN** the messages Telegram no longer returns are gone from the cache too, and stop appearing in search results

#### Scenario: A resync that does not finish
- **WHEN** a re-walk fails or is interrupted part-way down a chat
- **THEN** nothing is removed, since a partial pass cannot distinguish a cleared message from one it has not reached yet, and the next resync tries again

#### Scenario: An ordinary sync
- **WHEN** a chat's history is already complete and only newer messages are fetched
- **THEN** nothing is removed, because such a run never sees the whole chat

#### Scenario: A message arriving during a re-walk
- **WHEN** a new message is stored while a chat is being re-walked
- **THEN** it survives the reconciliation, which considers only what was cached before the walk began

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

While connected, new, edited and deleted messages MUST be applied to the cache as they arrive, and each MUST signal that the cache changed so an active search can re-run. A cleared channel or supergroup history MUST be applied the same way, which requires reading the raw update, as no typed handler exposes it.

#### Scenario: A message arrives while searching
- **WHEN** a new message matching the active pattern arrives
- **THEN** it is stored, its chat's title is refreshed, and the interface re-runs the search

#### Scenario: A message is deleted elsewhere
- **WHEN** a deletion update arrives
- **THEN** those messages are removed from the cache and stop appearing in results

#### Scenario: A channel or supergroup history is cleared
- **WHEN** an update reports that a channel's history was hidden up to some message
- **THEN** every cached message of that channel up to and including it is removed

#### Scenario: A private chat's history is cleared
- **WHEN** the user clears a private chat or basic group in Telegram
- **THEN** the cache is reconciled by the next full resync, since the protocol carries no live update for it
