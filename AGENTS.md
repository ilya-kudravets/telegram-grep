# AGENTS.md

Setup guide for AI agents driving **telegram-grep** via its headless JSON CLI
(`tg-client`). For the full command reference, see
[`skills/telegram-grep-cli/SKILL.md`](skills/telegram-grep-cli/SKILL.md).

## What this is

A local cache of a Telegram account's messages with regex search and
delete-everywhere. The CLI emits one line of JSON on stdout per command, so an
agent can parse results and chain calls — `sync` additionally streams progress
to stderr as it runs, which agents should ignore (or log) but not parse.
`search`/`stats` are **offline** (read `data/cache.db`, no network, no auth);
`sync`/`delete` connect to Telegram.

## Install

**Prebuilt binary** (no toolchain) — downloads the right asset for the platform:

```bash
REPO=ilya-kudravets/telegram-grep
case "$(uname -sm)" in
  "Darwin arm64") ASSET=tg-client-darwin-arm64 ;;
  "Darwin x86_64") ASSET=tg-client-darwin-x64 ;;
  "Linux x86_64")  ASSET=tg-client-linux-x64 ;;
  "Linux aarch64") ASSET=tg-client-linux-arm64 ;;
  *) echo "unsupported: $(uname -sm)"; exit 1 ;;
esac
curl -fsSL "https://github.com/$REPO/releases/latest/download/$ASSET" -o /usr/local/bin/tg-client
chmod +x /usr/local/bin/tg-client
tg-client help
```

**From source** (needs [Bun](https://bun.sh)):

```bash
bun install
bun start help            # run directly
bun run build             # → dist/tg-client (standalone binary)
```

## Auth (only for `sync` / `delete`)

Config is read from the current directory:

- `.env` with `API_ID` / `API_HASH` — from https://my.telegram.org → API development tools.
- A session: an existing `data/session` from a prior interactive login, **or**
  `SESSION_STRING` in `.env` (exported from mtcute) for non-interactive login.

Set `SESSION_STRING` before running `sync`/`delete` from an agent — otherwise they
fall back to an interactive phone/code prompt and block on stdin. `search`/`stats`
need none of this.

## Commands

| Command | Auth | Output |
|---|---|---|
| `tg-client search "<regex\|/pat/flags>" [--limit N]` | no | `{count, results:[{chat_id,id,date,sender,text,out,chat_title}]}` |
| `tg-client stats` | no | `{messages}` |
| `tg-client sync` | yes | `{chatsDone, messages, errors}` (stdout); progress on stderr meanwhile |
| `tg-client delete <chatId>:<msgId> ...` | yes | `{deleted, errors}` |
| `tg-client help` | no | usage JSON |
| `tg-client --version` | no | `{version}` |

`out` is `1` for messages you sent, `0` for received; `date` is unix seconds.
A plain search string matches case-insensitively; `/regex/flags` is used verbatim.

## Typical flow

Search is read-only; feed the exact `chat_id`/`id` pairs it returns into `delete`:

```bash
tg-client sync                                    # refresh cache (auth)
tg-client search "/password|token/i" --limit 50   # find (offline)
tg-client delete -1001234567890:4521              # remove for everyone (auth)
```

`delete` uses `revoke: true` (everyone, all devices); per-chat permission failures
are reported in `errors` and don't abort the rest.
