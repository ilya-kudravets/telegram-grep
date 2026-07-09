---
name: telegram-grep-cli
description: >
  Use to search, count, sync, or delete a user's Telegram message history from the
  command line via the prebuilt `tg-client` binary (JSON output, agent-friendly).
  Triggers: search Telegram messages, grep my Telegram, delete Telegram messages
  everywhere, count cached Telegram messages, sync Telegram history, tg-client CLI.
  Not for the Bot API or sending messages — this drives a personal account's cache.
---

# telegram-grep CLI (`tg-client`)

A headless, JSON-emitting CLI over a local cache of a Telegram account's messages.
`search`/`stats` are **offline** (read the local SQLite cache, no network, no auth).
`sync`/`delete` connect to Telegram and need an authenticated session.

## 1. Install the binary from GitHub

Download the prebuilt binary for the current platform from the latest release and
put it on `PATH`. Assets are named `tg-client-<os>-<arch>`.

```bash
REPO=ilya-kudravets/telegram-grep
case "$(uname -sm)" in
  "Darwin arm64") ASSET=tg-client-darwin-arm64 ;;
  "Darwin x86_64") ASSET=tg-client-darwin-x64 ;;
  "Linux x86_64")  ASSET=tg-client-linux-x64 ;;
  "Linux aarch64") ASSET=tg-client-linux-arm64 ;;
  *) echo "unsupported platform: $(uname -sm)"; exit 1 ;;
esac
curl -fsSL "https://github.com/$REPO/releases/latest/download/$ASSET" -o /usr/local/bin/tg-client
chmod +x /usr/local/bin/tg-client
tg-client help
```

If `/usr/local/bin` is not writable, download to `~/.local/bin` (or any dir on `PATH`).

## 2. Auth (only for `sync` / `delete`)

The binary reads its config from the current directory:

- `.env` with `API_ID` / `API_HASH` (from https://my.telegram.org → API development tools).
- A session: either an existing `data/session` (created by a prior interactive login),
  or `SESSION_STRING` in `.env` (exported from mtcute) for non-interactive login.

Without a session, `sync`/`delete` fall back to an interactive phone/code prompt — set
`SESSION_STRING` before running them from an agent so they don't block on stdin.
`search`/`stats` need none of this; they just read `data/cache.db`.

## 3. Commands

Every command prints one line of JSON to stdout and exits non-zero on error.
`sync` also streams human-readable progress to stderr while it runs — ignore
(or log) stderr, only stdout is the JSON result.

| Command | Auth | Output |
|---|---|---|
| `tg-client search "<pattern>" [--limit N]` | no | `{ "count", "results": [ {chat_id,id,date,sender,text,out,chat_title} ] }` |
| `tg-client stats` | no | `{ "messages": <int> }` |
| `tg-client sync` | yes | `{ "chatsDone", "messages", "errors": [...] }` on stdout |
| `tg-client delete <chatId>:<msgId> ...` | yes | `{ "deleted": <int>, "errors": [...] }` |
| `tg-client help` | no | usage JSON |
| `tg-client --version` | no | `{ "version": "<semver>" }` |

**Pattern**: a plain string matches case-insensitively; `/regex/flags` is used verbatim.
`date` is unix seconds; `out` is `1` for messages you sent, `0` for received.

## 4. Typical agent workflow

Search is read-only and safe to run first; `delete` takes the exact `chat_id`/`id`
pairs returned by `search`, so an agent can select-then-delete without any bulk footgun.

```bash
# 1. find matches (offline)
tg-client search "/password|token/i" --limit 50

# 2. delete specific ones for everyone (from the search results above)
tg-client delete -1001234567890:4521 -1001234567890:4522
```

To refresh the cache before searching (downloads only what's new since last run):

```bash
tg-client sync
```

## Notes

- `delete` uses `revoke: true` — removes the message for everyone / on all devices.
  Others' messages are deleted only where you have rights; permission failures are
  reported per-chat in `errors` and don't abort the rest.
- The TUI (`tg-client` with no command) and `sync`/`delete` share one Telegram session —
  don't run two writers at once.
