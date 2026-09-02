## Purpose

Lets a user run the whole Telegram client from a static page in their own browser — supplying their own application credentials, unlocking a session that is encrypted at rest, and searching or deleting their cached history with no server involved.

## ADDED Requirements

### Requirement: Bring-your-own application credentials

The static client MUST NOT contain Telegram application credentials. It MUST obtain `api_id` and `api_hash` from the person using it and MUST keep them on that device only.

#### Scenario: First launch has no credentials
- **WHEN** the static client is opened with no stored credentials
- **THEN** it asks for `api_id` and `api_hash`, links to where they are obtained, and refuses to connect until both are supplied

#### Scenario: Credentials are reused on later launches
- **WHEN** the client is opened again on the same browser after credentials were saved
- **THEN** it does not ask again and uses the stored pair

#### Scenario: Credentials never ship in the bundle
- **WHEN** the published static bundle is searched for an `api_hash`
- **THEN** none is present, in any encoding

### Requirement: Session encrypted at rest under a mandatory passphrase

A stored Telegram session MUST be unreadable without a passphrase chosen by the user. The passphrase MUST NOT be optional, MUST NOT be persisted anywhere, and the key derived from it MUST exist only for the lifetime of the page.

#### Scenario: Setting a passphrase after logging in
- **WHEN** the user completes a Telegram login
- **THEN** the client requires a passphrase before storing the session, and what it stores is ciphertext with no plaintext session string alongside it

#### Scenario: Unlocking on a later load
- **WHEN** the client is opened with an encrypted session present
- **THEN** it shows an unlock prompt and reaches the client UI only after the passphrase decrypts the session

#### Scenario: Wrong passphrase
- **WHEN** an incorrect passphrase is entered
- **THEN** the client reports failure, does not reach the client UI, and leaves the stored ciphertext untouched

#### Scenario: Discarding a session that cannot be unlocked
- **WHEN** the user cannot supply the passphrase and chooses to start over
- **THEN** the client can erase the stored session and returns to the login flow

### Requirement: Cached history works offline in the browser

The static client MUST hold its message cache in the browser, MUST restore it on load, and MUST serve regex search from it without contacting Telegram.

#### Scenario: Search before any connection
- **WHEN** a cache from a previous session is present and the user searches while unlocked but not connected
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
