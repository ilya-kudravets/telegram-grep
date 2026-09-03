# regex-search Specification

## Purpose
The reason the archive exists: one regular expression, every chat at once, no network. Search reads the cache and nothing else.

## Requirements

### Requirement: Pattern syntax

A plain string MUST be treated as a case-insensitive regular expression. A string wrapped in slashes MUST be treated as a regular expression with the flags that follow the closing slash. An empty or invalid pattern MUST be reported as such rather than silently matching nothing.

#### Scenario: A plain query
- **WHEN** the user searches for `hello`
- **THEN** messages containing `Hello` and `HELLO` match

#### Scenario: An explicit pattern with flags
- **WHEN** the user searches for `/^ok$/m`
- **THEN** the expression and its flags are used as written

#### Scenario: A broken expression
- **WHEN** the user searches for `[unclosed`
- **THEN** the interface reports an invalid expression and no results are shown

### Requirement: Results are newest-first, titled, and capped

Results MUST be ordered newest first, MUST carry the chat title, the sender and the kind of peer alongside the message, and MUST stop at a limit so an unbounded pattern cannot exhaust memory.

#### Scenario: A pattern matching most of the archive
- **WHEN** a very broad pattern is searched with the default limit
- **THEN** at most that many rows are returned, and they are the newest matches

### Requirement: Search scope by kind of peer

The user MUST be able to choose which kinds of peer a search covers. The kinds MUST be few, and MUST be drawn along the lines that matter to someone looking for their own regrettable messages and for the secrets others sent them — not along the platform's internal type names. Every interface MUST offer the same choice.

The scope MUST be applied **before** the result limit, or an archive dominated by one kind would spend the whole budget on rows the user asked to exclude and come back near-empty.

A chat whose kind has never been established MUST always be searched. Withholding messages because a label is missing would be indistinguishable from losing them.

#### Scenario: Excluding feeds
- **WHEN** the user searches with feeds left out
- **THEN** matches from broadcast peers are absent and matches from their own conversations remain

#### Scenario: A pattern that mostly hits one excluded kind
- **WHEN** a broad pattern matches far more rows in an excluded kind than the limit allows, and some rows in an included one
- **THEN** the included rows are returned rather than being crowded out

#### Scenario: An unlabelled chat
- **WHEN** a chat's kind is not known and the user has excluded some kinds
- **THEN** its messages still appear

#### Scenario: Narrowing to nothing
- **WHEN** the user tries to exclude every kind
- **THEN** the interface refuses, because a search over no kinds reads as broken rather than as a choice

#### Scenario: The same choice outside the browser
- **WHEN** the command line is used
- **THEN** the same scope can be set there, and leaving it unset searches everything

### Requirement: Search is repeatable and offline

The same pattern over an unchanged cache MUST return the same rows, including patterns whose flags make the expression object stateful. Search MUST work with no network connection and no valid session.

#### Scenario: The same global pattern searched twice
- **WHEN** a `/g`-flagged pattern is searched twice in a row
- **THEN** both searches return the same rows

#### Scenario: Searching while offline
- **WHEN** the session no longer authorizes, or there is no connectivity
- **THEN** search still returns matches from the cache
