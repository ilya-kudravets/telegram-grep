
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

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

- Keep the score at 100%: any new `src/*.ts` logic needs tests that kill its mutants.
- Some `src/` functions take an injected seam for testability (e.g. `syncAll`'s `sleepMs`,
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
