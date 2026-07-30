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

// Origin (when present) must match Host. Defense-in-depth against drive-by CSRF: a
// cross-site page can't read the token from our origin's localStorage, but we reject a
// mismatched Origin anyway. Matters more for WebSockets, which are NOT subject to CORS —
// any page may open a socket to us, so Origin is the only browser-supplied signal.
function checkOrigin(req: Request): Response | null {
  const origin = req.headers.get('origin')
  if (!origin) return null
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return forbidden()
  }
  return host === req.headers.get('host') ? null : forbidden()
}

// Returns null when the request may proceed, or a rejecting Response.
export function checkAuth(req: Request, token: string): Response | null {
  if (req.headers.get('authorization') !== `Bearer ${token}`) return unauthorized()
  return checkOrigin(req)
}

// The WebSocket handshake carries the same secret, but in the query string: the browser
// WebSocket API cannot set request headers, so Authorization is not available there.
// Same token, same Origin check — only the transport differs.
export function checkWsAuth(req: Request, token: string): Response | null {
  if (new URL(req.url).searchParams.get('token') !== token) return unauthorized()
  return checkOrigin(req)
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
