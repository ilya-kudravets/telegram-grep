# static-client Specification

## Purpose
Lets a user run the whole Telegram client from a static page in their own browser — supplying their own application credentials, unlocking a session that is encrypted at rest, and searching or deleting their cached history with no server involved.

## Requirements

### Requirement: Application credentials, the user's own or a baked fallback

The static client MUST accept `api_id` and `api_hash` from the person using it and MUST keep them on that device only. A build MAY carry a fallback pair supplied at build time; when it does, the user-supplied pair MUST take precedence and the user MUST still be able to enter their own. A default build MUST carry no pair at all.

#### Scenario: First launch of a build with no baked pair
- **WHEN** the static client is opened with no stored credentials and no pair was baked in
- **THEN** it asks for `api_id` and `api_hash`, links to where they are obtained, and refuses to connect until both are supplied

#### Scenario: First launch of a build with a baked pair
- **WHEN** the static client is opened with no stored credentials and a pair was baked in
- **THEN** it does not ask for credentials, uses the baked pair, and still offers a way to supply the user's own

#### Scenario: Credentials are reused on later launches
- **WHEN** the client is opened again on the same browser after credentials were saved
- **THEN** it does not ask again and uses the stored pair

#### Scenario: A baked pair is not a secret
- **WHEN** a pair is baked into the published bundle
- **THEN** it is stored packed rather than as a literal `api_hash`, and the documentation states that a bundled pair is publicly readable and must be an app id registered for the deployment

#### Scenario: Default build ships no credentials
- **WHEN** a build made without the baked-pair inputs is searched for an `api_hash`
- **THEN** none is present, in any encoding

### Requirement: Session and cache encrypted at rest under a mandatory passphrase

Both the stored Telegram session and the stored message cache MUST be unreadable without a passphrase chosen by the user. The passphrase MUST NOT be optional, MUST NOT be persisted anywhere, and the key derived from it MUST exist only for the lifetime of the page.

#### Scenario: Setting a passphrase before anything is stored
- **WHEN** the client is opened with credentials but no stored session
- **THEN** it requires a passphrase before the Telegram login, so that no session or cached message is ever written unencrypted

#### Scenario: Cached messages are ciphertext
- **WHEN** history has been synced and the browser's storage is inspected
- **THEN** the cache record contains no readable message text, sender or chat title

#### Scenario: Unlocking on a later load
- **WHEN** the client is opened with an encrypted session present
- **THEN** it shows an unlock prompt and reaches the client UI only after the passphrase decrypts the session

#### Scenario: Wrong passphrase
- **WHEN** an incorrect passphrase is entered
- **THEN** the client reports failure, does not reach the client UI, and leaves the stored ciphertext untouched

#### Scenario: Discarding data that cannot be unlocked
- **WHEN** the user cannot supply the passphrase and chooses to start over
- **THEN** the client can erase every stored record without the passphrase, and returns to the login flow

### Requirement: Cached history works offline in the browser

The static client MUST hold its message cache in the browser, MUST restore it on load, and MUST serve regex search from it without contacting Telegram.

#### Scenario: Search before any connection
- **WHEN** a cache from a previous session is present and the user searches after unlocking but without a working connection
- **THEN** matching messages are returned from browser storage, newest first, with chat titles

#### Scenario: Cache survives a reload
- **WHEN** history is synced and the page is reloaded
- **THEN** the message count and per-chat sync state are the same as before the reload, and a further sync fetches only what is new

#### Scenario: Deleting removes messages from Telegram and from the cache
- **WHEN** the user deletes selected messages
- **THEN** they are revoked for everyone and disappear from subsequent searches, with per-chat failures reported rather than aborting the rest

### Requirement: Self-hosted path is unaffected

Introducing the static client MUST NOT change the behavior of the server-backed web app or the CLI.

#### Scenario: Server-backed app after the change
- **WHEN** the self-hosted server is started and its page is opened
- **THEN** it authenticates with its token, serves search and delete over its API, and pushes status as before

### Requirement: Published as a static site

The client MUST be publishable as static files and MUST work when served from a subdirectory rather than a domain root.

#### Scenario: Served from a project-page subpath
- **WHEN** the built bundle is served under a path prefix such as `/telegram-grep/`
- **THEN** its scripts, styles and assets load, with no request to an absolute path outside that prefix

#### Scenario: No server-side dependency
- **WHEN** the bundle is served by any plain static file host
- **THEN** the client works, requiring no API endpoint, no cookie and no server-set header

### Requirement: Leaving the browser clean

The client MUST offer a way to end the Telegram session remotely and a way to erase everything it stored locally. The local erase MUST work with no network and no passphrase.

#### Scenario: Logging out
- **WHEN** the user logs out
- **THEN** the session is revoked on Telegram's side, and the local session, cache and credentials are removed only after that succeeds

#### Scenario: Log out fails
- **WHEN** revoking the session on Telegram's side fails
- **THEN** the stored data is left intact and the failure is reported, so the user can retry rather than end up logged in remotely with no local session

#### Scenario: Erasing everything locally
- **WHEN** the user chooses to erase all data
- **THEN** the client confirms, then removes the cache, the session and the saved credentials from the browser, and returns to its first-launch state
