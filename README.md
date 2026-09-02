# telegram-grep

[![CI](https://github.com/ilya-kudravets/telegram-grep/actions/workflows/ci.yml/badge.svg)](https://github.com/ilya-kudravets/telegram-grep/actions/workflows/ci.yml)
[![Lint](https://github.com/ilya-kudravets/telegram-grep/actions/workflows/lint.yml/badge.svg)](https://github.com/ilya-kudravets/telegram-grep/actions/workflows/lint.yml)
[![CodeQL](https://github.com/ilya-kudravets/telegram-grep/actions/workflows/codeql.yml/badge.svg)](https://github.com/ilya-kudravets/telegram-grep/actions/workflows/codeql.yml)

Telegram TUI client: local cache of all chats, regex search, delete messages across all devices.

## Getting started

1. `bun install`
2. `bun start` — if `.env` is missing (and `API_ID`/`API_HASH` aren't set as real env vars) it creates one from a template and exits; get `API_ID`/`API_HASH` at https://my.telegram.org → API development tools and fill it in
3. `bun start` again — on first run it asks for phone/code/2FA, then downloads history (incrementally: a restart only fetches what's new)

## Usage

- Type a regex in the search field — results update as you type. A plain string matches case-insensitively; `/pat/flags` is used as-is.
- `tab` — switch focus between input and list, `space` — toggle selection, `d` — delete the selected (or current) messages with a `y/n` confirm, `esc` — reset, `^P` — cycle patterns from `patterns.txt` (the file is re-read on the fly), `^C` — quit.
- Deletion uses `revoke`: for everyone, on all devices. Others' messages are deleted where you have rights; permission errors are shown in the status bar.

Cache and session live in `data/` (not committed).

## CLI mode (for AI agents)

Any subcommand runs headless and prints one line of JSON — no TUI. `tg-client tui`
(or no args) still launches the interactive client.

- `bun start search "<regex|/pat/flags>" [--limit N]` — search the cache (offline, no auth) → `{count, results}`; `--limit` defaults to 1000
- `bun start stats` — number of cached messages (offline) → `{messages}`
- `bun start sync` — download/update history (needs auth) → `{chatsDone, messages, errors}` (`messages` is the total cached after the run, not the number downloaded); progress prints to stderr as it runs (one line per update, overwritten in place on a TTY), so stdout stays a single JSON line
- `bun start delete <chatId>:<msgId> ...` — delete for everyone (needs auth) → `{deleted, errors}`
- `bun start help` — usage JSON
- `bun start --version` — `{version}`

Credentials for `sync`/`delete` can also come as flags — `bun start sync --api-id N --api-hash H`
— which override `.env` for that run. argv is visible in `ps`, so prefer `.env` for anything
long-lived.

`search`/`stats` read `data/cache.db` directly and need no Telegram connection.
Build a standalone binary with `bun run build` (→ `dist/tg-client`); merging the
release PR publishes per-platform binaries (see **Releases** below). See
[AGENTS.md](AGENTS.md) for the agent setup guide and the
[`telegram-grep-cli` skill](skills/telegram-grep-cli/SKILL.md) that downloads
that binary and documents the commands.

## Distributing a binary

`make build` produces a binary with no credentials in it: the user supplies `API_ID`/`API_HASH`
via `.env` or the flags above. That is the default and the safest option — each user's own app id
carries their own usage.

`make build-public` bakes a fallback pair in for users who shouldn't have to register one:

```bash
BAKED_API_ID=… BAKED_API_HASH=… make build-public
```

- A runtime `API_ID`/`API_HASH` (or `--api-id`/`--api-hash`) still wins, so the baked pair can be
  rotated without breaking existing installs.
- `--env='BAKED_*'` inlines **only** that prefix — nothing else from the build shell reaches the
  binary. The `process.env.BAKED_CREDS` read in `packages/bun/src/env.ts` is the substitution
  site; reading it indirectly would silently ship a binary with no baked pair.
- The pair is packed (XOR + base64) before it is baked, so the binary carries neither an
  `api_hash`-shaped string nor a variable named after one — a bot grepping released artifacts
  finds nothing. That is **anti-scraping, not encryption**: the client has to use the key, so a
  debugger recovers it in seconds. Register an app id for the release instead of reusing your own,
  and rotate it if it gets flagged — if someone misuses it, Telegram restricts that app id, not
  your account.

## Testing

- `bun test` — unit tests.
- `bun run test:mutation` — StrykerJS mutation testing (config in `stryker.conf.json`), kept at 100%. Uses the command runner over `bun test` plus the TypeScript checker; reports go to `reports/mutation/` (gitignored).
- `make smoke` — serves `apps/web/smoke/` on `127.0.0.1:8100`. It checks the two things `bun test` cannot: that the portable core runs in a browser, and that the IndexedDB store round-trips a cache snapshot across a page load. Load it once to seed, then again to restore (`?reset=1` clears the store); every check prints a `PASS`/`FAIL` line, so any browser or driver can read the result. Not in CI — that would mean a browser download on every run.

## CI & security

GitHub Actions (`.github/workflows/`, deps cached across runs):
- **ci.yml** — `bun run typecheck` + `bun test` on every push/PR; a separate `bun audit --prod` job fails the build on vulnerable production dependencies.
- **lint.yml** — Biome lint + format check (`biome ci`, config in `biome.json`).
- **codeql.yml** — CodeQL SAST (`security-extended`) on push/PR and weekly.
- **dependabot.yml** — weekly PRs bumping dependencies (npm/`bun.lock`) and the actions themselves.
- **release.yml** — see below.

## Releases

Driven by [release-please](https://github.com/googleapis/release-please): commit with
[Conventional Commits](https://www.conventionalcommits.org/), and a push to `main` keeps a
`chore(main): release X.Y.Z` PR open that bumps `package.json` and `CHANGELOG.md`. Merging **that**
PR creates the `vX.Y.Z` tag and the GitHub release, and attaches the four `tg-client-<os>-<arch>`
binaries (built on their matching runners). Nothing is tagged by hand.

Locally: `bun run typecheck`, `bun run lint` (`bun run format` to autofix), `bun test`, `bun audit`.

## Language

The UI follows the system language (ru/en); translations live in `packages/core/src/locales/*.ts`. To override:
- TUI/CLI: `TG_LANG=en bun start` (or `ru`).
- Web: the dropdown next to the search box (persisted in the browser).

## Web interface (and iPhone)

- `bun run web` — the same client with a browser UI. By default it listens on **`127.0.0.1` only**.
- To access from a phone: `LAN=1 bun run web` (listens on `0.0.0.0`). The console prints a URL with a token.
- `/api/*` is token-protected (`Authorization: Bearer`, stored in `data/web-token`). Open the printed `…/?token=…` URL once — the token is saved in the browser, after which you can install it as a PWA (Safari → "Add to Home Screen") with the plain address. Origin is also checked, so third-party sites can't call the API (CSRF).
- The TUI (`bun start`) and web (`bun run web`) share one Telegram session — run only one at a time.
- Auth persists to `data/session` after first login — no need to log in again on restart.
- For a one-off headless login (no `data/session` yet, no TTY), pass a session string exported from mtcute as a real env var: `SESSION_STRING=... bun start`. An invalid/stale value is ignored (with a warning) rather than needed on every run, so there's no reason to keep it in `.env` once you're logged in.
