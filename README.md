# telegram-grep

[![CI](https://github.com/ilya-kudravets/telegram-grep/actions/workflows/ci.yml/badge.svg)](https://github.com/ilya-kudravets/telegram-grep/actions/workflows/ci.yml)
[![Lint](https://github.com/ilya-kudravets/telegram-grep/actions/workflows/lint.yml/badge.svg)](https://github.com/ilya-kudravets/telegram-grep/actions/workflows/lint.yml)
[![CodeQL](https://github.com/ilya-kudravets/telegram-grep/actions/workflows/codeql.yml/badge.svg)](https://github.com/ilya-kudravets/telegram-grep/actions/workflows/codeql.yml)

Telegram TUI client: local cache of all chats, regex search, delete messages across all devices.

## Getting started

1. Get `API_ID`/`API_HASH` at https://my.telegram.org → API development tools, put them in `.env`
2. `bun install`
3. `bun start` — on first run it asks for phone/code/2FA, then downloads history (incrementally: a restart only fetches what's new)

## Usage

- Type a regex in the search field — results update as you type. A plain string matches case-insensitively; `/pat/flags` is used as-is.
- `tab` — switch focus between input and list, `space` — toggle selection, `d` — delete the selected (or current) messages with a `y/n` confirm, `esc` — reset, `^P` — cycle patterns from `patterns.txt` (the file is re-read on the fly), `^C` — quit.
- Deletion uses `revoke`: for everyone, on all devices. Others' messages are deleted where you have rights; permission errors are shown in the status bar.

Cache and session live in `data/` (not committed).

## CLI mode (for AI agents)

Any subcommand runs headless and prints one line of JSON — no TUI. `tg-client tui`
(or no args) still launches the interactive client.

- `bun start search "<regex|/pat/flags>" [--limit N]` — search the cache (offline, no auth) → `{count, results}`
- `bun start stats` — number of cached messages (offline) → `{messages}`
- `bun start sync` — download/update history (needs auth) → `{chatsDone, messages, errors}`
- `bun start delete <chatId>:<msgId> ...` — delete for everyone (needs auth) → `{deleted, errors}`
- `bun start help` — usage JSON

`search`/`stats` read `data/cache.db` directly and need no Telegram connection.
Build a standalone binary with `bun run build` (→ `dist/tg-client`); `git tag v*`
publishes per-platform binaries via `.github/workflows/release.yml`. See
[AGENTS.md](AGENTS.md) for the agent setup guide and the
[`telegram-grep-cli` skill](skills/telegram-grep-cli/SKILL.md) that downloads
that binary and documents the commands.

## Testing

- `bun test` — unit tests.
- `bun run test:mutation` — StrykerJS mutation testing (config in `stryker.conf.json`), kept at 100%. Uses the command runner over `bun test` plus the TypeScript checker; reports go to `reports/mutation/` (gitignored).

## CI & security

GitHub Actions (`.github/workflows/`, deps cached across runs):
- **ci.yml** — `bun run typecheck` + `bun test` on every push/PR; a separate `bun audit --prod` job fails the build on vulnerable production dependencies.
- **lint.yml** — Biome lint + format check (`biome ci`, config in `biome.json`).
- **codeql.yml** — CodeQL SAST (`security-extended`) on push/PR and weekly.
- **dependabot.yml** — weekly PRs bumping dependencies (npm/`bun.lock`) and the actions themselves.

Locally: `bun run typecheck`, `bun run lint` (`bun run format` to autofix), `bun test`, `bun audit`.

## Language

The UI follows the system language (ru/en); translations live in `src/locales/*.ts`. To override:
- TUI/CLI: `TG_LANG=en bun start` (or `ru`).
- Web: the dropdown next to the search box (persisted in the browser).

## Web interface (and iPhone)

- `bun run web` — the same client with a browser UI. By default it listens on **`127.0.0.1` only**.
- To access from a phone: `LAN=1 bun run web` (listens on `0.0.0.0`). The console prints a URL with a token.
- `/api/*` is token-protected (`Authorization: Bearer`, stored in `data/web-token`). Open the printed `…/?token=…` URL once — the token is saved in the browser, after which you can install it as a PWA (Safari → "Add to Home Screen") with the plain address. Origin is also checked, so third-party sites can't call the API (CSRF).
- The TUI (`bun start`) and web (`bun run web`) share one Telegram session — run only one at a time.
- `SESSION_STRING` in `.env` (exported from mtcute) — sign in without phone/code.
