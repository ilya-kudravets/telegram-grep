
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

- `packages/core/` (`@tg/core`) — the **portable domain**: message-cache port (`cache.ts`), regex
  search, history sync, delete-everywhere, and shared i18n. No platform code (no Bun, no `fs`).
  Subpath exports mirror files: import `@tg/core/sync`, `@tg/core/cache`, `@tg/core/i18n`, …
- `packages/bun/` (`@tg/bun`) — the **Bun platform layer** shared by both apps: the `bun:sqlite`
  `Cache` adapter + `patterns.txt` loader (`adapters/`, surfaced via the `db`/`search` barrels),
  the `@mtcute/bun` client + interactive `login` (`client.ts`), and `.env` bootstrap (`env.ts`).
  Single `@tg/bun` barrel; it also re-exports `@tg/core`'s sync/delete so apps have one import.
- `apps/cli/` (`@tg/cli`) — the TUI + headless JSON CLI (`index.ts`, `cli.ts`, `tui.ts`).
  Deps: `@tg/bun` + `@tg/core` + `@opentui/core`.
- `apps/web/` (`@tg/web`) — the `Bun.serve` server (`server.ts`, `api.ts`, `webauth.ts`) + the
  browser bundle (`web/`). Deps: `@tg/bun` + `@tg/core` + `react`/`react-dom`.
- `apps/mobile/` (`@tg/mobile`) — the React Native / Expo client. Consumes `@tg/core` (sync/
  search/delete/realtime) through an **expo-sqlite** `Cache` adapter (`src/cache.ts`, sibling of
  the bun one) and the RN mtcute adapter (`src/mtcute-rn/`, see the `mtcute-react-native` skill);
  UI in `App.tsx`. mtcute auth persists as an exported session string in a `kv` table in the same
  DB (no mtcute storage driver). Uses `EXPO_PUBLIC_API_ID/HASH` from `apps/mobile/.env` (Expo reads
  the app dir, not the repo root). Metro is monorepo-aware via `metro.config.js`. **Excluded from
  the root `tsconfig`/biome/stryker** (own RN toolchain): typecheck with `cd apps/mobile && tsc`.

Root scripts drive the whole repo: `bun start` → `apps/cli`, `bun run web` → `apps/web`,
`bun run mobile` → `apps/mobile` (Expo — the script `cd`s into the app and uses `bunx expo` so the
app-local binary resolves), `bun run build` compiles the `apps/cli` binary (which reads its version
from the **root** `package.json`). Tests live beside their package (`packages/*/tests`,
`apps/*/tests`); `bun test` and Stryker discover them repo-wide regardless of location.

A root `Makefile` wraps these for convenience (`make check` = typecheck + lint + test +
**`mobile-typecheck`**, since `apps/mobile` sits outside the root `tsc`). Mobile-specific targets:
`make mobile-ios` / `mobile-android` (native build + launch), `make mobile-prebuild` (regenerate
`ios/`+`android/` after native dep changes), and `make mobile-clean` (wipe the generated native
dirs + stale RN build caches — run this after moving/renaming the app, then `make mobile-prebuild`).

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

### Mutation testing

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

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
