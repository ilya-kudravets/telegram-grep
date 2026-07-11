import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

type Handler = (req: Request) => Response | Promise<Response>
type Route = Handler | Record<string, Handler>

// A stable per-install secret: lets the user bookmark the tokenized URL / install the PWA once.
export function loadOrCreateToken(path: string): string {
  try {
    const existing = readFileSync(path, 'utf8').trim()
    if (existing) return existing
  } catch {
    /* not created yet */
  }
  const token = randomBytes(24).toString('base64url')
  writeFileSync(path, token, { mode: 0o600 })
  return token
}

const unauthorized = () => new Response('unauthorized', { status: 401 })
const forbidden = () => new Response('forbidden', { status: 403 })

// Returns null when the request may proceed, or a rejecting Response.
// Bearer token gates every call; Origin check is defense-in-depth against drive-by CSRF
// (a cross-site page can't read the token from our origin's localStorage, and a custom
// Authorization header would fail CORS preflight — but we reject a mismatched Origin anyway).
export function checkAuth(req: Request, token: string): Response | null {
  if (req.headers.get('authorization') !== `Bearer ${token}`) return unauthorized()
  const origin = req.headers.get('origin')
  if (origin) {
    let host: string
    try {
      host = new URL(origin).host
    } catch {
      return forbidden()
    }
    if (host !== req.headers.get('host')) return forbidden()
  }
  return null
}

// Wrap every API route handler so it requires auth before running.
export function guardRoutes<R extends Record<string, Route>>(token: string, routes: R): R {
  const wrap =
    (h: Handler): Handler =>
    (req) =>
      checkAuth(req, token) ?? h(req)
  const out: Record<string, Route> = {}
  for (const [path, r] of Object.entries(routes)) {
    out[path] =
      typeof r === 'function'
        ? wrap(r)
        : Object.fromEntries(Object.entries(r).map(([m, h]) => [m, wrap(h as Handler)]))
  }
  return out as R
}
