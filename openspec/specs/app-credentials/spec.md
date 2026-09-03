# app-credentials Specification

## Purpose
Every build needs a Telegram `api_id`/`api_hash` before it can connect. This covers where they come from, which source wins, and what may be baked into a distributed artifact.

## Requirements

### Requirement: One resolver, one precedence

Credentials MUST resolve through a single function used by every consumer, and a value supplied at runtime MUST take precedence over anything baked into the artifact.

#### Scenario: A rotated baked pair
- **WHEN** a distributed build's baked app id has been rotated or restricted, and the user supplies their own at runtime
- **THEN** the runtime pair is used and the build keeps working

#### Scenario: A new place needs credentials
- **WHEN** another code path needs an `api_id`/`api_hash`
- **THEN** it obtains them from the shared resolver rather than reading the environment itself

### Requirement: Per-run credentials on the command line

The CLI MUST accept the pair as flags for a single run, MUST reject a flag given without a value, and MUST remove the flags before dispatching a command so they cannot be mistaken for arguments.

#### Scenario: A one-off headless run
- **WHEN** `--api-id` and `--api-hash` are passed with a subcommand
- **THEN** the command runs with those credentials and the subcommand's own arguments are unaffected

#### Scenario: A flag with no value
- **WHEN** `--api-id` is passed with nothing after it
- **THEN** the run fails with a message saying each flag needs a value

#### Scenario: The trade-off is documented
- **WHEN** the flags are documented
- **THEN** the documentation states that arguments are visible to other processes and that a file or environment variable is preferable for anything long-lived

### Requirement: First-run bootstrap

When nothing supplies credentials, an interactive build MUST leave the user with an obvious next step — a template file naming both values and where to obtain them — and MUST NOT nag when credentials already resolve.

#### Scenario: Starting with no configuration
- **WHEN** the interactive client starts with no credentials anywhere
- **THEN** a template configuration file is created, the user is told to fill it in, and the process exits

#### Scenario: A build that already has credentials
- **WHEN** credentials resolve from the environment or from a baked pair
- **THEN** no template file is written

### Requirement: A baked pair is packed, and never a secret

A build MAY carry a fallback pair. It MUST be stored packed rather than as a literal hash, so automated scraping of published artifacts finds nothing, and the documentation MUST state plainly that packing is obfuscation: extractable from a binary with a debugger and trivially readable in a browser bundle.

#### Scenario: A published artifact is scraped
- **WHEN** a released binary or bundle is searched for a 32-character hexadecimal hash or a variable named after one
- **THEN** neither is present

#### Scenario: Guidance for whoever bakes one in
- **WHEN** the baking process is documented
- **THEN** it says to register an app id for the distribution rather than reusing a personal one, and to rotate it if it gets restricted

#### Scenario: The substitution site stays literal
- **WHEN** the baked value is read in code
- **THEN** it is read as a literal environment expression the bundler can substitute, with no wrapper or guard that would discard the substituted value, since either mistake silently ships an artifact with no baked pair

### Requirement: What the Bun side writes to disk is owner-only

The session file grants full account access with no phone, no code and no second factor, the message cache holds every message ever synced, and the `.env` template invites an api pair into it. None of the three is encrypted on the Bun side, so their file modes are the whole defence and MUST be owner-only.

The directory holding them MUST be created owner-only and MUST also be tightened when it already exists, since an existing directory ignores the mode a create asks for and every earlier install has a world-readable one. Every path that opens the data directory MUST go through the same helper, so a new caller cannot forget.

Full-disk encryption is not a substitute: it covers a powered-off stolen machine, not another local account, a backup daemon running as another user, or a synced folder handing the archive to a cloud provider.

#### Scenario: A fresh install
- **WHEN** the data directory is created
- **THEN** it is owner-only, and the session and cache files inside it are owner-only

#### Scenario: An install that predates this
- **WHEN** the data directory already exists with looser permissions
- **THEN** opening it tightens it rather than leaving what it found

#### Scenario: A cache with no file
- **WHEN** the cache is opened in memory rather than on disk
- **THEN** there is nothing to restrict and the open still succeeds

#### Scenario: The credentials template
- **WHEN** a template `.env` is created
- **THEN** it is owner-only, because it exists to be filled in with an api pair
