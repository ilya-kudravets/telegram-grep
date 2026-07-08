import type { SearchRow } from './db'
import type { DeleteResult, DeleteTarget } from './deleter'

export interface ApiDeps {
  // null → invalid pattern
  search: (pattern: string) => SearchRow[] | null
  del: (targets: DeleteTarget[]) => Promise<DeleteResult>
  status: () => object
}

// Bun.serve-compatible route handlers, separated from the server for testing
export function makeApi(deps: ApiDeps) {
  return {
    '/api/search': (req: Request) => {
      const q = new URL(req.url).searchParams.get('q') ?? ''
      if (!q.trim()) return Response.json({ rows: [] })
      const rows = deps.search(q)
      if (rows === null) return Response.json({ error: 'невалидный regex' }, { status: 400 })
      return Response.json({ rows })
    },
    '/api/delete': {
      POST: async (req: Request) => {
        const body = (await req.json()) as { targets?: DeleteTarget[] }
        const targets = (body.targets ?? []).filter(
          // Stryker disable next-line OptionalChaining: t?.chat_id short-circuits first, so t is a non-null object by the time t?.id is read
          (t) => Number.isFinite(t?.chat_id) && Number.isFinite(t?.id),
        )
        if (!targets.length) return Response.json({ error: 'targets пуст' }, { status: 400 })
        return Response.json(await deps.del(targets))
      },
    },
    '/api/status': () => Response.json(deps.status()),
  }
}
