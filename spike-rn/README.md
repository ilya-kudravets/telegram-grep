# mtcute-rn spike — ✅ VERIFIED WORKING

**Question:** can `@mtcute/core` run on-device in React Native (Hermes) with a
hand-written platform adapter — no TDLib, no C++, no WASM — far enough to talk to
Telegram? **Answer: yes.** Built and run on the iOS simulator (Expo SDK 57 / RN
0.86 / Hermes, `react-native-quick-crypto` 1.1.5):

- **crypto self-test 7/7** on device — sha1, sha256, hmac-sha256, pbkdf2, **AES-256-IGE**, AES-256-CTR, factorizePQ
- **MTProto auth-key handshake** (RSA + DH + AES-IGE) completed against a real DC (`149.154.167.50`)
- **`help.getConfig` round-trip**: encrypted request → decrypted + gunzip'd + parsed reply → `thisDc=2, dcOptions=19`

So the entire pipeline — WebSocket transport + obfuscation + all crypto + MTProto
serialization + gzip — works in RN. Your existing `sync/search/deleter` (built on
the same mtcute high-level API) can port to iOS+Android on this adapter.

## What's here

The adapter (`polyfills` + `crypto` + `ige` + `adapter`) is the reusable part —
effectively the missing `mtcute-react-native` platform package. `verify.ts` is a
dev harness and stays app-side.

| File | Role |
|---|---|
| `src/mtcute-rn/adapter.ts` | `ICorePlatform` + WebSocket `TelegramTransport` + `createClient` (wires everything + `MemoryStorage`) |
| `src/mtcute-rn/crypto.ts` | `ICryptoProvider` on quick-crypto; **AES-IGE composed from AES-ECB** |
| `src/mtcute-rn/ige.ts` + `ige.test.ts` | pure AES-IGE composition + `bun test` known-answer check (kept separate so the test loads without quick-crypto) |
| `src/mtcute-rn/verify.ts` | on-device crypto self-test + autonomous transport probe (`help.getConfig`) |
| `src/polyfills.ts` | quick-crypto `install()`, Buffer, **`performance.now`**, **`AbortSignal.throwIfAborted`** |
| `App.tsx` | UI: crypto self-test grid + transport probe + phone/code/2FA login |

WASM is avoided on purpose (Hermes has none): AES-IGE is hand-rolled from ECB,
`factorizePQ` is pure JS in core, gzip is `pako`.

## The RN gotchas we hit (all fixed in the code above)

Each of these produced a cryptic `undefined is not a function` / `undefined
cannot be used as a constructor` — the debugging is baked into the fixes:

1. **`BaseTelegramClient` is NOT a root export** of `@mtcute/core` — it lives in
   `@mtcute/core/client.js`. Importing from the root gives `undefined`. (`client.ts`)
2. **`react-native-quick-crypto` has no default export** — use named imports
   (`createCipheriv`, `createHash`, …). (`crypto.ts`)
3. **quick-crypto rejects `null` IV** for ECB (Node accepts it) — pass `new Uint8Array(0)`. (`crypto.ts`)
4. **`pako` default import resolves oddly under Metro** — use named `{ inflate, deflate }`. (`crypto.ts`)
5. **Hermes lacks `performance.now()` and `AbortSignal.throwIfAborted()`** — both
   used by mtcute's flood-control; polyfilled. (`polyfills.ts`)

## Run

This folder is a complete Expo project (Expo SDK 57 / RN 0.86). `node_modules`,
`ios/`, `android/` are gitignored and regenerate:

```sh
cd spike-rn
cp .env.example .env          # then put your API_ID/API_HASH from my.telegram.org
npm install                   # exact working versions are pinned in package-lock.json
npx expo prebuild             # regenerates ios/ + installs pods (needs CocoaPods)
npx expo run:ios              # crypto self-test + transport probe run automatically
```

`bun test src/mtcute-rn/ige.test.ts` runs the offline AES-IGE check (no RN needed).
`verified-screenshot.png` is the on-device result (7/7 crypto + green transport probe).

The crypto self-test and transport probe are autonomous (no creds needed — the
probe uses a throwaway api_id and a benign `help.getConfig`). **Tapping "Connect
to Telegram"** runs the real phone → code → 2FA login and lists dialogs; that
needs your API creds in `.env` and a phone that can receive the SMS.

## Still not covered (deliberately)

- **Session persistence** — uses `MemoryStorage`; swap for an `op-sqlite` storage (port `db.ts`).
- **Background / push** — iOS suspends the WS in background; APNs/FCM device-token push is a separate native piece.
- **Android** — same JS should run; the native deps (quick-crypto/nitro) build on Android too, not yet exercised here.
