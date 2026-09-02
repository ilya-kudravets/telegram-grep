## Why

The web UI only exists behind a self-hosted `Bun.serve` process, so reaching it from a phone means running a server and exposing it on the LAN. A fully client-side build removes the server from the picture entirely and can be published as a static site (GitHub Pages), which is what the tool's browser use actually needs. Doing it client-side also moves the Telegram credentials and session onto the user's own device rather than a host we distribute.

## What Changes

- A second entry point for `apps/web` that runs the whole client in the browser: `@mtcute/web` for MTProto, the in-memory `Cache` adapter for storage, `apps/web/web/store.ts` for persistence. No `/api`, no WebSocket, no token.
- First-run onboarding asks the user for their **own** `api_id`/`api_hash` and keeps them in browser storage. Nothing is baked into the bundle.
- The Telegram session is persisted as an mtcute exported session string, encrypted at rest with WebCrypto (PBKDF2 → AES-GCM) under a **mandatory** passphrase. Every load shows an unlock screen; the derived key lives only in memory.
- The existing search/delete UI is reused, not forked: `app.tsx` takes an injected data layer, and the server-backed entry passes the `fetch`-based one while the static entry passes a core-backed one.
- A GitHub Actions workflow builds the static bundle and deploys it with `actions/deploy-pages`, with asset paths that resolve under a project-page subpath.
- The browser smoke page grows checks for the crypto round-trip, wrong-passphrase rejection, and credential storage.

## Capabilities

### New Capabilities

- `static-client`: running the client entirely in the browser — credential onboarding, encrypted session at rest, core domain against the in-memory cache, and static deployment.

### Modified Capabilities

<!-- none: the self-hosted server path keeps its current behavior; injecting a data layer into the UI is an implementation detail, not a requirement change -->

## Impact

- **New**: `apps/web/web/static.{html,tsx}`, `apps/web/web/crypto.ts`, `apps/web/web/creds.ts`, `apps/web/web/core-client.ts`, `.github/workflows/pages.yml`.
- **Modified**: `apps/web/web/app.tsx` (data layer becomes a prop), `apps/web/web/index.html` entry wiring, `apps/web/smoke/*`, `Makefile`, `README.md`, `apps/web/package.json` (adds `@mtcute/web`).
- **Unchanged, must not regress**: `apps/web/src/*` (server, api, webauth, live), the CLI, and every existing test. `make check` and the 100% mutation score stay green.
- **Security posture**: the bundle carries no credentials; the session is unreadable at rest without the passphrase; an XSS while unlocked still reaches the session, which is inherent to any browser client and must be stated in the docs.
