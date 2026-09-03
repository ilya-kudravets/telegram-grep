import {
  type DeleteResult,
  type DeleteTarget,
  type PeerKind,
  parseKinds,
  type SearchRow,
} from '@tg/bun'

export interface ApiDeps {
  // null → invalid pattern
  search: (pattern: string, kinds?: Set<PeerKind>) => SearchRow[] | null
  del: (targets: DeleteTarget[]) => Promise<DeleteResult>
  status: () => object
  /** Forgets the sync bookkeeping and starts a fresh full walk. */
  resync: () => void
}

// One request must not fan out into an unbounded loop of irreversible API calls: 1000
// targets are at most 10 messages.deleteMessages calls (CHUNK=100 in the deleter).
export const MAX_TARGETS = 1000

// Bun.serve-compatible route handlers, separated from the server for testing
export function makeApi(deps: ApiDeps) {
  return {
    '/api/search': (req: Request) => {
      const params = new URL(req.url).searchParams
      const q = params.get('q') ?? ''
      if (!q.trim()) return Response.json({ rows: [] })
      const rows = deps.search(q, parseKinds(params.get('kinds')))
      if (rows === null) return Response.json({ error: 'невалидный regex' }, { status: 400 })
      return Response.json({ rows })
    },
    '/api/delete': {
      POST: async (req: Request) => {
        // Deleting for everyone is irreversible, so anything we can't read as a target list
        // is rejected outright — and a malformed body must not escape as a 500 (Bun's dev
        // error page leaks the absolute cwd).
        let raw: unknown
        try {
          raw = ((await req.json()) as { targets?: unknown } | null)?.targets
        } catch {
          return Response.json({ error: 'невалидный JSON' }, { status: 400 })
        }
        if (!Array.isArray(raw)) return Response.json({ error: 'targets пуст' }, { status: 400 })
        if (raw.length > MAX_TARGETS)
          return Response.json({ error: `максимум ${MAX_TARGETS} targets` }, { status: 400 })
        const targets = raw.filter(
          // safe integers, not merely finite: 1e308 and 0.5 are neither chat nor message ids
          // Stryker disable next-line OptionalChaining: t?.chat_id short-circuits first, so t is a non-null object by the time t?.id is read
          (t): t is DeleteTarget => Number.isSafeInteger(t?.chat_id) && Number.isSafeInteger(t?.id),
        )
        if (!targets.length) return Response.json({ error: 'targets пуст' }, { status: 400 })
        return Response.json(await deps.del(targets))
      },
    },
    '/api/resync': {
      POST: () => {
        deps.resync()
        return Response.json({ ok: true })
      },
    },
    '/api/status': () => Response.json(deps.status()),
  }
}
