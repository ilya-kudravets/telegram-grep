import { existsSync, writeFileSync } from 'node:fs'

const TEMPLATE = `# Get these at https://my.telegram.org -> API development tools
API_ID=
API_HASH=

# optional: paste a session string (exported from mtcute) to skip interactive phone/code login
SESSION_STRING=
`

// Bun loads .env once at process start, so a file created here only helps the *next* run.
// Skip it if real env vars already supply the creds (e.g. Docker/CI) — no .env needed there.
export function ensureEnvFile(path = '.env'): boolean {
  if (existsSync(path)) return false
  if (process.env.API_ID && process.env.API_HASH) return false
  writeFileSync(path, TEMPLATE)
  return true
}
