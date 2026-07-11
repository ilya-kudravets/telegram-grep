# @tg/mobile — React Native / Expo client

The mobile client. It reuses the portable `@tg/core` domain (regex search, history
sync, delete-everywhere, realtime) on-device through an **expo-sqlite** `Cache`
adapter and a hand-written mtcute RN platform adapter — no TDLib, no C++, no WASM.

The mtcute-on-Hermes viability was proven first as a spike (see history below). This
package promotes it into a full workspace member consuming `@tg/core`.

## Layout

| File | Role |
|---|---|
| `App.tsx` | UI: offline regex search over the cache + Connect (login) + Sync + long-press delete-for-everyone |
| `src/cache.ts` | **`Cache` port on expo-sqlite** (sibling of `packages/bun`'s bun:sqlite adapter, same `@tg/core/cache` SQL); persists the mtcute session string in a `kv` table |
| `src/mtcute-rn/adapter.ts` | `ICorePlatform` + WebSocket `TelegramTransport` + `createClient` (wires the RN crypto/transport + `MemoryStorage`) |
| `src/mtcute-rn/crypto.ts` | `ICryptoProvider` on quick-crypto; **AES-IGE composed from AES-ECB** |
| `src/mtcute-rn/ige.ts` + `ige.test.ts` | pure AES-IGE composition + `bun test` known-answer check (loads without quick-crypto) |
| `src/mtcute-rn/verify.ts` | on-device crypto self-test + transport probe (dev harness) |
| `src/polyfills.ts` | quick-crypto `install()`, Buffer, `performance.now`, `AbortSignal.throwIfAborted` |
| `metro.config.js` | monorepo-aware Metro (watches the repo root, resolves `@tg/core` from source) |

WASM is avoided on purpose (Hermes has none): AES-IGE is hand-rolled from ECB,
`factorizePQ` is pure JS in core, gzip is `pako`.

## Session & sync model

- **Auth persistence** — after login the mtcute session is exported and stored in the
  `kv` table of the same sqlite DB; on launch it's re-imported for a silent reconnect.
  No mtcute storage driver. Ceiling: update-loop state (pts/qts) is **not** persisted,
  so realtime catch-up restarts each launch — `Sync` re-fetches what was missed.
- **Search is offline** — it scans the local cache and works with no connection.
  `Connect`/`Sync`/delete need an authenticated session.

## Run

Everything installs from the repo root (`bun install`). Then, from this folder:

```sh
cp .env.example .env          # EXPO_PUBLIC_API_ID / EXPO_PUBLIC_API_HASH from my.telegram.org
npx expo prebuild             # regenerates ios/ + installs pods (needs CocoaPods)
npx expo run:ios              # or: bun run mobile  (from the repo root — Expo dev server)
```

`bun test apps/mobile/src/mtcute-rn/ige.test.ts` runs the offline AES-IGE check (no RN needed).

## RN gotchas (baked into the code)

1. **`BaseTelegramClient` is NOT a root export** of `@mtcute/core` — it's in `@mtcute/core/client.js`.
2. **`react-native-quick-crypto` has no default export** — use named imports.
3. **quick-crypto rejects `null` IV** for ECB (Node accepts it) — pass `new Uint8Array(0)`.
4. **`pako` default import resolves oddly under Metro** — use named `{ inflate, deflate }`.
5. **Hermes lacks `performance.now()` / `AbortSignal.throwIfAborted()`** — both polyfilled.

## Not covered (deliberately)

- **Background / push** — iOS suspends the WS in background; APNs/FCM device-token push is a separate native piece.
- **Android** — the same JS runs; native deps (quick-crypto/nitro) build on Android too, not yet exercised.
- **Search scale** — full JS scan over the cache (as on desktop); add an FTS index if the cache grows past a few million rows.
- **App identity** — `app.json` still carries the spike's `tg-spike` slug / `com.anonymous.tg-spike` bundle id; rename before a store build (triggers a prebuild regen).
