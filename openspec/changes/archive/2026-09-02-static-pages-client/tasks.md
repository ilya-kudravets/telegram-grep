## 1. Session encryption

- [x] 1.1 Add `apps/web/web/crypto.ts`: PBKDF2 (SHA-256, 250k, random salt) → AES-GCM key; `encryptSession`/`decryptSession` over a `{version, iterations, salt, iv, ciphertext}` record.
- [x] 1.2 Unit-test the helpers in `bun test` (Bun has WebCrypto): round-trip, wrong passphrase rejected, records are salted per write.

## 2. Browser storage for credentials and session

- [x] 2.1 Extend `apps/web/web/store.ts` with credential and encrypted-session records (same database, own keys) plus their clear operations.
- [x] 2.2 Keep the snapshot API unchanged so the existing smoke checks keep passing.

## 3. Browser Telegram client

- [x] 3.1 Add `apps/web/web/core-client.ts`: `@mtcute/web` `TelegramClient` with `MemoryStorage`, `importSession` for a silent reconnect, `exportSession` after an interactive login.
- [x] 3.2 Wire the core domain to it: `syncAll` with progress, `searchCache`, `deleteEverywhere`, `attachRealtime`, persisting the cache snapshot after each mutation.
- [x] 3.3 Expose the same operation surface the UI needs, so the component does not know which backend it has.

## 4. UI reuse

- [x] 4.1 Give `app.tsx` an injected data layer instead of calling `apiFetch` directly.
- [x] 4.2 Keep the server entry passing the fetch/WebSocket implementation — no behavior change for the self-hosted app.
- [x] 4.3 Add `apps/web/web/static.tsx` + `static.html`: onboarding → unlock → login → the shared UI, with sync and a "discard session" escape.

## 5. Static build and deployment

- [x] 5.1 A build script/target that emits `dist/pages` with relative asset paths (`--public-path=./`), verified served from a subpath.
- [x] 5.2 `.github/workflows/pages.yml`: build, `upload-pages-artifact`, `deploy-pages`, `main` + manual dispatch, least permissions.

## 6. Verification

- [x] 6.1 Extend `apps/web/smoke` with the crypto round-trip, wrong-passphrase rejection, and credential persistence; run it through the Playwright MCP.
- [x] 6.2 Load the real static bundle from a subpath in the browser and confirm onboarding and unlock render with no console errors and no absolute-path requests.
- [x] 6.3 `make check` green, mutation score still 100%, and the self-hosted server path still boots.
- [x] 6.4 Document the static client in `README.md` (including the XSS caveat and the forgotten-passphrase consequence) and record the layout in `CLAUDE.md`.
