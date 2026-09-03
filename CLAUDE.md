
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Monorepo layout

Bun workspaces (`workspaces` in the root `package.json`). Run everything from the repo root —
cwd stays the root, so `.env` and `data/` live there.

- `packages/core/` (`@tg/core`) — the **portable domain**. No platform code (no Bun, no `fs`).
  `isBroadcast` (sync.ts) is the one place that decides a peer is a feed rather than
  correspondence: `syncAll` and `attachRealtime` both skip those unless their last argument says
  otherwise (`syncChannels()` reads `SYNC_CHANNELS=1` on the Bun side; the browser has no env and
  always skips). `peerKind` (sync.ts) is the *other* classifier and answers a different question —
  which of `PeerKind`'s five buckets a peer is labelled with for the "where to search" filter.
  **The two are allowed to disagree, and do**: a gigagroup is labelled `channel` (admin-only, it
  reads as a feed) yet is still downloaded, because it used to be a supergroup and the member
  messages from before its conversion are the user's. The rule is *skip conservatively, label by
  how it reads* — a wrong skip loses data, a wrong label hides it behind a checkbox. Both read only
  fields already on the dialog peer; `linkedChat` (which would identify a channel's discussion
  group) lives on `FullChat` and would cost a round trip per peer, so comments are simply `group`.
  The label is stored per chat (`chats.kind`, added via `MIGRATION_COLUMNS`); `''` means never
  seen in a dialog list and is never filtered out, and `searchCache` applies the filter **before**
  its limit so excluded rows can't eat the budget. `patterns.ts` holds the UI's ready-made search templates — labels are i18n keys,
  not text, so the list stays UI rather than data.
  `pacer.ts` is an mtcute **network middleware**, not domain code: it spaces out the bulk
  read calls and learns the account's unpublished rate limit (AIMD on the gap, plus a
  ratchet that never probes back below a gap that already flooded). Install it **after**
  `networkMiddlewares.basic(...)` so it sits *inside* the flood waiter — from outside, a
  flood is invisible, just a slow call. It is also what makes `syncAll`'s `CHAT_WORKERS`
  chats-in-flight safe: the pacer, not the round-trip time, sets the request rate, so
  concurrency fills latency instead of adding load.
  Two `Cache` adapters implement its port: `bun:sqlite` (`packages/bun`) and the in-memory one
  (`cache-memory.ts`) the browser client persists snapshots of. Both must satisfy
  `tests/cache-conformance.ts` — add contract facts there, not to one adapter's own tests.
- `packages/bun/` (`@tg/bun`) — the **Bun platform layer** shared by both apps. Single `@tg/bun`
  barrel; it also re-exports `@tg/core`'s sync/delete so apps have one import.
- `apps/cli/` (`@tg/cli`) — the TUI + headless JSON CLI.
- `apps/web/` (`@tg/web`) — the `Bun.serve` server + the browser bundle (`web/`). **Two entries,
  one UI**: `web/main.tsx` (self-hosted; `data-server.ts` talks to `/api` + the WebSocket) and
  `web/static.tsx` (server-less GitHub Pages build; `core-client.ts` drives `@tg/core` against
  `@mtcute/web` in the tab). `web/app.tsx` knows neither — it takes an injected `DataLayer`
  (search / delete / status subscription / full resync), so a UI change lands in both. The static entry keeps
  credentials in the clear and **both** the cache snapshot and the session sealed under one
  passphrase-derived key in IndexedDB (`store.ts` + `crypto.ts`: `createVault` for a new
  passphrase, `unlockVault` for an existing record, which doubles as the passphrase proof — so
  the passphrase is asked for *before* the login, and dropping the session drops the cache with
  it); mtcute's own storage is deliberately unused (it writes the session in plaintext),
  hence `MemoryStorage` + `exportSession`/`importSession`. mtcute's wasm crypto blob must be
  handed in explicitly (`WebCryptoProvider({ wasmInput })` from a `with { type: 'file' }`
  import) — its own `import.meta.url` lookup 404s once bundled. `make pages` builds it
  (`--public-path=./`, so a project-page subpath works); `make serve-pages` proves that.

Root scripts drive the whole repo. `bun run build` compiles the `apps/cli` binary, which reads its
version from the **root** `package.json`. Tests live beside their package; `bun test` and Stryker
discover them repo-wide regardless of location. A root `Makefile` wraps these (`make check` =
typecheck + lint + test). Browser-only wiring that `bun test` can't reach is checked by the
`apps/web/smoke` page (`make smoke`, driven through the Playwright MCP — **no Playwright
dependency in the repo**): it prints `PASS`/`FAIL` lines a driver can read.

Credentials resolve in `packages/bun/src/env.ts` (`resolveCreds`): runtime `API_ID`/`API_HASH`
first, then the pair `make build-public` inlines via `bun build --env='BAKED_*'` as one packed
`BAKED_CREDS` blob (`packCreds`/`unpackCreds` live in `@tg/core/creds` because the web bundle
bakes a pair too — XOR+base64, anti-scraping only, never treat a baked id as secret; in a browser
bundle it is outright public). That flag only substitutes **literal** `process.env.X`
expressions, so that read must stay literal — routing it through a parameter compiles fine and
ships an artifact with no baked pair, and a `typeof process` guard around it is just as fatal in
the browser (the read is substituted, the guard is not, so it discards the baked value —
`apps/web/web/baked.ts` uses try/catch instead). Every creds
check goes through `resolveCreds` (`createClient`, `ensureEnvFile`, the CLI's `authedClient`);
adding a fourth reader means using it too. `--api-id`/`--api-hash` are stripped in `runCli` before
dispatch and written into `process.env`.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Mutation testing

`bun run test:mutation` runs StrykerJS (config: `stryker.conf.json`) at 100% score. It uses the
**command runner** (`bun test`) since Stryker has no Bun-native runner, plus the **typescript-checker**
to discard mutants that don't compile. Reports land in `reports/mutation/` (gitignored).

- Keep the score at 100%: any new logic in the mutated files (`packages/core/src/*`,
  `apps/cli/src/{api,adapters/*}`) needs tests that kill its mutants. Mutated paths are listed in
  `stryker.conf.json`; the `typescript-checker` plugin is declared explicitly there (bun's
  isolated workspace `node_modules` breaks Stryker's default plugin auto-discovery).
- Some functions take an injected seam for testability (e.g. `syncAll`'s `sleepMs`,
  `attachRealtime`'s dispatcher factory) — default args keep call sites unchanged.
- Only mark a mutant with `// Stryker disable next-line <Mutator>: <reason>` when it is **provably
  equivalent** (no test can observe the difference). Prefer a real test over a disable.

## The user's messages must never enter your context

`data/cache.db` is the user's private correspondence — every message their account ever
received, which for this tool means passwords, one-time codes and seed phrases. It is not
material to reason over.

**Never read message rows.** Not to check a fix, not to size the archive, not "just one
row to see the shape". That means: no `select` against `messages`, no `sqlite3`/`bun:sqlite`
query on `data/cache.db`, no `tg-client search`/`stats` against the real cache, no reading
`data/session`. Aggregates are not an exception — a count still means opening their archive,
and the user has asked for it not to be touched at all.

Work against fixtures instead: `:memory:` caches and the seeded rows in
`packages/core/tests/*` and `apps/web/smoke/smoke.ts` are what tests and manual checks run
on. `ls -l`/`stat` on the files is fine — that reads no content.

If a question genuinely needs a number from the real cache, ask the user to run the query
and paste what they choose to share.

## CI & releases

`.github/workflows/`: `ci` (typecheck + `bun test` + `bun audit --prod`), `lint` (`biome ci`),
`codeql`, and `release`. All but release cancel superseded runs via a `concurrency` group.

Releases are driven by **release-please** — do **not** hand-tag or create GitHub releases:

- Commit with **Conventional Commits**. Only `feat:` / `fix:` bump the version; `ci:` / `chore:` /
  `build(deps):` / `docs:` land without a release. `feat!:` or a `BREAKING CHANGE:` footer bumps major.
- On push to `main`, release-please maintains a version-bump PR (updates `package.json` + `CHANGELOG.md`).
  Merging **that** PR tags `vX.Y.Z`, cuts the release, and the `build` job compiles the per-platform
  `tg-client` binaries and attaches them. So a release needs a `feat:`/`fix:` since the last tag.
- `.agents/skills/` is gitignored (vendored third-party docs, reconstructable from `skills-lock.json`) —
  don't re-commit it. The project's own skill lives at `skills/telegram-grep-cli/`.

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
