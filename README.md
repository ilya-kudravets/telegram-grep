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

- **Broadcast channels are not synced.** A channel is a feed, not correspondence: nothing in it
  is yours to delete unless you are its admin, and one channel's archive outweighs every real
  chat you have. Groups, supergroups, gigagroups and private chats are synced as before. Set
  `SYNC_CHANNELS=1` to include channels anyway (already-cached channel messages stay searchable
  either way).
- **Where to search** — a `Where` button next to the search box picks which kinds of peer
  count. Telegram has six chat types plus several user shapes; they collapse into five buckets
  chosen around what this tool is for:

  | bucket | what is in it | why it is its own bucket |
  | --- | --- | --- |
  | saved messages | your self-chat | where people deliberately stash passwords and seed phrases |
  | private chats | correspondence with people | your own writing, deletable |
  | bots & service | bots, and Telegram's own account (id 777000) | where login codes, 2FA prompts and bank alerts arrive |
  | groups | basic groups, supergroups, monoforums | rooms your messages live in. **Channel comments land here** — a comment is a message in the channel's linked discussion supergroup |
  | channels | broadcast channels, gigagroups, communities | feeds: ordinary members cannot post, so nothing there is yours |

  Everything but `channels` is on by default. A chat the cache has no label for yet is **always**
  searched — hiding messages over a missing label would read as data loss — and one sync labels
  every peer in your dialog list, channels included. So old channel messages keep showing up
  until you sync once; a chat you have since left never gets labelled and stays visible.

  The CLI and TUI read the same setting from `SEARCH_KINDS` (`SEARCH_KINDS=private,group`).
  Unset means everything, which is the right default for a tool an agent drives.
- **Templates** — the search box has a `Templates` button with ready-made patterns for the things
  people regret sending: passwords and PINs, one-time codes, API keys, leaked keys recognised by
  shape alone (GitHub, AWS, Stripe, OpenAI, Telegram bot tokens, JWTs, PEM blocks, `user:pass@`
  URLs), seed phrases, card numbers, bank details, crypto addresses (BTC, EVM, TRON, TON, LTC),
  ID documents, emails, phone numbers, postal addresses, coordinates and map links, invite links,
  server IPs and ssh targets. `patterns.txt` entries are listed under them in the same sheet
  (server/TUI only — a browser has no file).
- **Full resync** — the web UI's status bar has a button that forgets what has already been
  synced and walks all history again. An incremental sync only looks *forward*, so a chat it
  once marked backfilled is never revisited: anything Telegram declined to hand over the first
  time (a peer that errored, messages that arrived while nothing was running) stays invisible
  until something clears the high-water mark. Nothing cached is dropped — re-inserting is an
  upsert, so a resync repairs and refreshes, and an interrupted one leaves the cache as it was.
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

## Static browser client (GitHub Pages)

The same client with **no server at all**: `apps/web/web/static.html` bundles the domain, talks to
Telegram straight from the tab (`@mtcute/web`), and keeps the cache in IndexedDB.

- `make pages` builds it into `dist/pages/` with relative asset paths, so it works from a domain
  root *and* from a project-page subpath. `make serve-pages` serves that build under
  `/telegram-grep/` on `127.0.0.1:8101` — the check that no asset request escapes the prefix.
- `.github/workflows/pages.yml` publishes it on every push to `main` (and on manual dispatch),
  once Pages is enabled for the repo with **GitHub Actions** as the source.
- By default **nothing is baked into the bundle**: the first launch asks for your own
  `api_id`/`api_hash` (my.telegram.org → API development tools) and keeps them in that browser.
- A published build **may** carry a fallback pair so visitors don't each have to register an app:
  set the repository variables `BAKED_API_ID` / `BAKED_API_HASH` (Settings → Secrets and variables
  → Actions → **Variables** — those exact names; `API_ID`/`API_HASH` are the *runtime* names and
  are deliberately ignored here, so nothing gets published by accident), or build locally with
  `BAKED_API_ID=… BAKED_API_HASH=… make pages`.
  The pair is packed (XOR+base64) so bots grepping deployments for a 32-hex `api_hash` find
  nothing, and the "use my own api_id" form stays available as an override. Understand the trade:
  **a pair in a browser bundle is public** — DevTools reads it in seconds — and if it gets abused
  Telegram restricts *that app id*, which breaks the page for everyone at once. Register an app for
  the site, never the one you use yourself, and rotate the variables if it gets flagged. (Every
  Telegram client does this, including Telegram Web, whose own pair sits in its JS.)
- **The session and the message cache are both encrypted at rest** under a passphrase you choose
  (WebCrypto: PBKDF2-SHA256, 250k iterations → one AES-GCM key, fresh IV per write). The
  passphrase is asked for before the Telegram login, never stored, and the derived key lives only
  in the page — so a reload always asks again. **There is no recovery:** forget it and the only way
  back is "Erase local data" and a fresh login.
- The login prompts say **where Telegram sent the code**: `app` delivery means it went into
  Telegram on another device you are logged in on, not by SMS — which is what "the code never
  arrived" almost always turns out to be. A rejected code or password says so too, instead of
  silently reopening the same field. It also shows what Telegram offers next and when
  (`nextType`/`timeout`) — the only signal available when Telegram accepts the request and then
  silently declines to deliver, which is exactly what its per-number anti-abuse limit does.
  `API_ID_PUBLISHED_FLOOD`, `PHONE_NUMBER_FLOOD` and `FLOOD_WAIT_n` are translated into what to do
  about them instead of shown raw.
- Two exits, and they mean different things: **Log out** revokes the session on Telegram's side
  first and only then wipes this browser (if the revoke fails, nothing local is touched, so you
  can retry); **Erase local data** needs no network and no key — it deletes the cache, the session
  and the saved credentials, which is also the answer to a forgotten passphrase. Neither deletes a
  single message from Telegram: the name says *local* because that is the whole of what it
  touches, and its confirm prompt says so too. Deleting messages is what the search results'
  **Delete** button is for.
- Caveat, stated plainly: encryption at rest protects your data from someone reading the browser's
  storage, **not** from script running in the page while it is unlocked. No browser client can
  protect against that. Host your own copy if you don't want to trust someone else's.
- mtcute's wasm crypto blob is imported as a bundled asset (`with { type: 'file' }`), because
  its own `new URL('./mtcute.wasm', import.meta.url)` points into the bundle's directory after
  bundling — a 404 that shows up as a WebAssembly "expected magic word" error.
- The self-hosted server path (below) is unchanged — both entries ship, and the search/delete UI
  is literally the same component with a different data layer injected.

## Testing

- `bun test` — unit tests.
- `bun run test:mutation` — StrykerJS mutation testing (config in `stryker.conf.json`), kept at 100%. Uses the command runner over `bun test` plus the TypeScript checker; reports go to `reports/mutation/` (gitignored).
- `make smoke` — serves `apps/web/smoke/` on `127.0.0.1:8100`. It checks what `bun test` cannot: that the portable core runs in a browser, that the sealed cache and session survive a page load through IndexedDB, and that both are really ciphertext (right passphrase opens them, wrong one refused, no message text or session string in either record). Load it once to seed, then again to restore (`?reset=1` clears the store); every check prints a `PASS`/`FAIL` line, so any browser or driver can read the result. Not in CI — that would mean a browser download on every run.

## CI & security

GitHub Actions (`.github/workflows/`, deps cached across runs):
- **ci.yml** — `bun run typecheck` + `bun test` on every push/PR; a separate `bun audit --prod` job fails the build on vulnerable production dependencies.
- **lint.yml** — Biome lint + format check (`biome ci`, config in `biome.json`).
- **codeql.yml** — CodeQL SAST (`security-extended`) on push/PR and weekly.
- **pages.yml** — builds and deploys the static browser client (see above).
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
