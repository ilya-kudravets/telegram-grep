import { writeFileSync } from 'node:fs'

// SESSION_STRING is deliberately not templated here: auth already persists to
// data/session after first login, so it's only useful for a one-off headless
// bootstrap — pass it as a real env var for that (SESSION_STRING=... bun start),
// don't stash it in .env where a stale/wrong value would go unnoticed.
const TEMPLATE = `# Get these at https://my.telegram.org -> API development tools
API_ID=
API_HASH=
`

// Bun loads .env once at process start, so a file created here only helps the *next* run.
// Skip it if real env vars already supply the creds (e.g. Docker/CI) — no .env needed there.
// 'wx' creates atomically and fails if the file already exists, avoiding a
// check-then-write race between a separate existsSync() and writeFileSync().
export function ensureEnvFile(path = '.env'): boolean {
  if (process.env.API_ID && process.env.API_HASH) return false
  try {
    writeFileSync(path, TEMPLATE, { flag: 'wx' })
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw e
  }
}
