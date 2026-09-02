import { writeFileSync } from 'node:fs'
import { unpackCreds } from '@tg/core/creds'

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

// Bun loads .env once at process start, so a file created here only helps the *next* run.
// Skip it if real env vars already supply the creds (e.g. Docker/CI) — no .env needed there.
// 'wx' creates atomically and fails if the file already exists, avoiding a
// check-then-write race between a separate existsSync() and writeFileSync().
// creds is an injected seam: BAKED is captured at import, so a test cannot reach it
// through process.env
export function ensureEnvFile(path = '.env', creds = resolveCreds()): boolean {
  // baked creds count too: a published binary must not nag for a .env it doesn't need
  if (creds.apiId && creds.apiHash) return false
  try {
    writeFileSync(path, TEMPLATE, { flag: 'wx' })
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw e
  }
}
