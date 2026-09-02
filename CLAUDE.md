
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
- `packages/bun/` (`@tg/bun`) — the **Bun platform layer** shared by both apps. Single `@tg/bun`
  barrel; it also re-exports `@tg/core`'s sync/delete so apps have one import.
- `apps/cli/` (`@tg/cli`) — the TUI + headless JSON CLI.
- `apps/web/` (`@tg/web`) — the `Bun.serve` server + the browser bundle (`web/`).

Root scripts drive the whole repo. `bun run build` compiles the `apps/cli` binary, which reads its
version from the **root** `package.json`. Tests live beside their package; `bun test` and Stryker
discover them repo-wide regardless of location. A root `Makefile` wraps these (`make check` =
typecheck + lint + test).

Credentials resolve in `packages/bun/src/env.ts` (`resolveCreds`): runtime `API_ID`/`API_HASH`
first, then the pair `make build-public` inlines via `bun build --env='BAKED_*'`. That flag only
substitutes **literal** `process.env.BAKED_*` expressions, so those two reads must stay literal —
routing them through a parameter compiles fine and ships a binary with no baked pair. Every creds
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
