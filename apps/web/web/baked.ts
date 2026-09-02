// Optional fallback application credentials for a published build, so a public page can
// work without every visitor registering their own app first. Absent from a plain
// `bun build` — then the first-run form is the only source.
//
// A pair baked into a *browser* bundle is public, full stop: DevTools reads it in
// seconds, packing or not. The packing (see @tg/core/creds) only keeps bots that grep
// deployments for a 32-hex api_hash from finding one. So bake an app id registered for
// this site — never the one you use yourself — and expect to rotate it if it gets
// flagged: Telegram restricts the app id, which breaks the page for everyone at once.
import { unpackCreds } from '@tg/core/creds'
import type { AppCreds } from './store'

// `bun build --env='BAKED_*'` substitutes this exact literal and nothing else, so the
// read must stay written out here — and it must not sit behind a `typeof process` guard
// either: substitution replaces the read, not the guard, so in a browser (where there is
// no `process`) the guard would discard the value that was just baked in. try/catch
// instead: substituted, nothing throws; un-substituted, the ReferenceError is the signal
// that this build has no baked pair.
let packed: string | undefined
try {
  packed = process.env.BAKED_CREDS
} catch {
  packed = undefined
}

const { apiId, apiHash } = unpackCreds(packed)

/** Undefined unless the build was given a complete pair. */
export const bakedCreds: AppCreds | undefined =
  Number(apiId) > 0 && apiHash ? { apiId: Number(apiId), apiHash } : undefined
