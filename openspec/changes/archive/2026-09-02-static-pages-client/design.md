## Context

`@tg/core` is already platform-free and already has two `Cache` adapters, one of them the in-memory one the browser needs, plus `apps/web/web/store.ts` to persist its snapshot in IndexedDB. What is missing is the client half: an mtcute client that runs in a tab, credentials to feed it, a session that survives a reload without lying around in plaintext, and a way to publish the result as static files.

## Goals / Non-Goals

**Goals**
- One static bundle that needs no server at runtime.
- No credentials in the bundle; the user supplies their own.
- A stored session that is worthless to anyone who reads the browser's storage without the passphrase.
- The self-hosted server path keeps working, byte-for-byte in behavior.

**Non-Goals**
- Protecting the session from an XSS while the page is unlocked. No browser client can, and the docs say so.
- Automating the Telegram login in the smoke — it needs real credentials and a real code.
- Replacing the server path. Both entries ship.

## Decisions

### mtcute in the browser, with the session kept by us

`@mtcute/web` exports `TelegramClient` and re-exports `@mtcute/core`. Its default storage is an IndexedDB driver, which would write the session in the clear. Instead: `storage: new MemoryStorage()` plus `exportSession()` / `importSession()`, and we own persistence. This is exactly the shape the deleted React Native client used (`MemoryStorage` + an exported string in a `kv` row), so it is a proven path, not a new idea.

- After a successful `start()`, export the session, encrypt it, store it.
- On load, decrypt, `importSession()`, then `start()` with rejecting prompts — a silent reconnect. Failure leaves search working offline.

### Passphrase → key, never stored

WebCrypto only: `PBKDF2` (SHA-256, 250k iterations, 16-byte random salt) → a 256-bit `AES-GCM` key, 12-byte random IV per write. Stored record is `{ salt, iv, ciphertext, iterations, version }`; the passphrase and derived key exist only in page memory. Wrong passphrase surfaces as a failed `decrypt`, which is authenticated by GCM — no separate verifier needed, and no way to distinguish "wrong passphrase" from "corrupt record", which is fine because the remedy is the same.

`version` is there so a future parameter bump can re-wrap an old record instead of stranding it.

### Credentials as data, not build input

`api_id`/`api_hash` go in the same IndexedDB database under their own key, written by a first-run form. They are not secret from the person typing them, so they are stored as-is; the passphrase protects the session, which is the thing that grants access to the account. A "forget credentials" action exists for a shared browser.

### One UI, two data layers

`app.tsx` currently calls `apiFetch` directly. It gains a small injected interface — search, delete, a status subscription — with the server entry passing the existing fetch/WebSocket implementation and the static entry passing one backed by `searchCache`/`deleteEverywhere`/`syncAll` over the in-memory cache. The UI keeps its current behavior in the server case; the shared surface is the smallest set the existing component already uses.

Alternative rejected: a forked static UI. It would double every future UI change, and the point of the port-and-adapter layout is that a second driver reuses the domain and the view.

### Static output under a subpath

`bun build ./apps/web/web/static.html --outdir dist/pages` emits hashed assets; `--public-path=./` keeps their URLs relative so the bundle works from `/telegram-grep/` as well as a domain root. The Pages workflow builds, uploads with `actions/upload-pages-artifact`, deploys with `actions/deploy-pages`, and runs only from `main` (plus a manual dispatch) with the `pages`/`id-token` permissions that action requires.

### What the smoke covers

`bun test` cannot reach WebCrypto-over-IndexedDB round-trips or a real page load, and the smoke page already exists for exactly this. It grows: encrypt → reload → decrypt with the right passphrase, rejection with the wrong one, and credentials surviving a reload. The crypto helpers themselves are pure enough to unit-test in `bun test` too, since Bun has WebCrypto — so the browser only has to prove the storage wiring.

## Risks / Trade-offs

- **A passphrase the user forgets is unrecoverable.** That is the point of encryption at rest, so the unlock screen offers "discard the session and log in again" rather than any recovery.
- **250k PBKDF2 iterations** costs a noticeable fraction of a second on an old phone. Chosen deliberately over a lower count; it is once per page load.
- **Whole-snapshot writes** to IndexedDB after each sync. Already flagged in `store.ts`; per-chat records are the upgrade if an archive makes it visible.
- **The bundle is public.** Anyone can host their own copy; nothing in it is secret, which is the design.

## Migration Plan

Additive. The server entry, the CLI and every existing test stay as they are; `make check` and the 100% mutation score gate the change. The static client ships alongside, and Pages deployment is opt-in per repository (the workflow needs Pages enabled to do anything).

## Open Questions

- Whether to also encrypt the message cache at rest. Deferred: the cache holds message text, which is sensitive, but encrypting it costs a decrypt of the whole archive per load and the session is what grants account access. Worth revisiting once the prototype is real.
