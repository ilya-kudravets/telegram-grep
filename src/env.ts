import { existsSync, writeFileSync } from 'node:fs'

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
export function ensureEnvFile(path = '.env'): boolean {
  if (existsSync(path)) return false
  if (process.env.API_ID && process.env.API_HASH) return false
  writeFileSync(path, TEMPLATE)
  return true
}
