import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { unpackCreds } from '@tg/core/creds'
import { parseKinds } from '@tg/core/search'

// re-exported so the packing stays reachable through the single @tg/bun barrel
export { packCreds, unpackCreds } from '@tg/core/creds'

// SESSION_STRING is deliberately not templated here: auth already persists to
// data/session after first login, so it's only useful for a one-off headless
// bootstrap — pass it as a real env var for that (SESSION_STRING=... bun start),
// don't stash it in .env where a stale/wrong value would go unnoticed.
const TEMPLATE = `# Get these at https://my.telegram.org -> API development tools
API_ID=
API_HASH=
`

// BAKED_CREDS is inlined at build time by `make build-public` (bun build --env='BAKED_*')
// and is absent from a normal build, so a runtime API_ID/API_HASH always wins — a published
// binary keeps working after its baked app id is rotated or banned. This literal
// `process.env.X` read is the substitution site: --env only replaces the literal
// expression, so reading it through a parameter would silently ship no baked pair.
const BAKED = unpackCreds(process.env.BAKED_CREDS)

export function resolveCreds(
  env: Record<string, string | undefined> = process.env,
  baked: { apiId?: string; apiHash?: string } = BAKED,
) {
  return {
    apiId: Number(env.API_ID || baked.apiId),
    apiHash: env.API_HASH || baked.apiHash,
  }
}

/**
 * Broadcast channels are skipped by default (see @tg/core's isBroadcast): their archives
 * are the bulk of a sync and hold nothing you can delete. SYNC_CHANNELS=1 opts back in.
 */
export const syncChannels = (env: Record<string, string | undefined> = process.env) =>
  env.SYNC_CHANNELS === '1'

/**
 * `SEARCH_KINDS=private,group` restricts which peer types the CLI and TUI search — the
 * headless counterpart of the web UI's "where" filter. Unset means everything, which is
 * the right default for a tool an agent drives: a filter it never asked for silently
 * hiding matches would be worse than noise.
 */
export const searchKinds = (env: Record<string, string | undefined> = process.env) =>
  parseKinds(env.SEARCH_KINDS)

// Bun loads .env once at process start, so a file created here only helps the *next* run.
// Skip it if real env vars already supply the creds (e.g. Docker/CI) — no .env needed there.
// 'wx' creates atomically and fails if the file already exists, avoiding a
// check-then-write race between a separate existsSync() and writeFileSync().
// creds is an injected seam: BAKED is captured at import, so a test cannot reach it
// through process.env
/**
 * Creates `data/` owner-only, and tightens it if it already exists.
 *
 * `data/session` **is** the account: its `auth_keys` table grants full access with no
 * phone, no code and no 2FA prompt, and revoking it needs the user to notice and
 * terminate the session from Telegram. `data/cache.db` is every message ever synced —
 * the passwords and seed phrases this tool exists to find. Neither is encrypted on the
 * Bun side (unlike the browser client, which seals both under a passphrase), so the
 * directory mode is the whole defence.
 *
 * Full-disk encryption does not substitute for it: FileVault covers a powered-off
 * stolen laptop, not another local uid, not a backup daemon running as another user,
 * and not a synced folder handing 32MB of private messages to a cloud provider. A
 * default 0644 is readable by all three.
 *
 * The directory is the load-bearing part — 0700 stops anyone else traversing into it,
 * whatever mode the files inside end up with, which matters because mtcute creates the
 * session file itself and we never see it being born. `chmodSync` as well as
 * `mkdirSync`'s mode because that mode is masked by umask and ignored outright for a
 * directory that already exists.
 */
export function secureDataDir(dir = 'data'): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
}

/** 0600 on a file we opened ourselves. Belt to `secureDataDir`'s braces. */
export function secureFile(path: string): void {
  chmodSync(path, 0o600)
}

export function ensureEnvFile(path = '.env', creds = resolveCreds()): boolean {
  // baked creds count too: a published binary must not nag for a .env it doesn't need
  if (creds.apiId && creds.apiHash) return false
  try {
    // 0600: the template invites the user to put their api pair here, and the CLI's own
    // docs have pointed at it for SESSION_STRING — either way it is credential material
    writeFileSync(path, TEMPLATE, { flag: 'wx', mode: 0o600 })
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw e
  }
}
