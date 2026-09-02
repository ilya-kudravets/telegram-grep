// The self-hosted data layer: everything the UI used to do inline before a second
// backend existed. Behaviour is unchanged — bearer token from the URL on first load,
// search and delete over /api, status pushed over the WebSocket with silent reconnect.
import type { DataLayer, Row, Status } from './app'

// grab ?token=… from the URL on first load, persist it, strip it from the address bar
function bootstrapToken(): string {
  const url = new URL(location.href)
  const fromUrl = url.searchParams.get('token')
  if (fromUrl) {
    localStorage.setItem('apiToken', fromUrl)
    url.searchParams.delete('token')
    history.replaceState(null, '', url.pathname + url.search)
  }
  return localStorage.getItem('apiToken') ?? ''
}

export function createServerData(): DataLayer {
  const token = bootstrapToken()
  // every API call carries the bearer token
  const apiFetch = (path: string, opts: RequestInit = {}) =>
    fetch(path, { ...opts, headers: { ...opts.headers, authorization: `Bearer ${token}` } })

  return {
    async search(query) {
      const res = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`)
      const body = (await res.json()) as { rows?: Row[]; error?: string }
      return res.ok ? { rows: body.rows ?? [] } : { error: body.error ?? '' }
    },

    async del(targets) {
      const res = await apiFetch('/api/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targets }),
      })
      return (await res.json()) as { deleted: number; errors?: { error: string }[] }
    },

    subscribeStatus(onStatus) {
      let ws: WebSocket | null = null
      let retry: ReturnType<typeof setTimeout> | undefined
      let stopped = false

      const connect = () => {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
        ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`)
        ws.onmessage = (ev) => onStatus(JSON.parse(ev.data as string) as Status)
        // сервер перезапускается (bun --hot) — молча переподключаемся
        ws.onclose = () => {
          if (!stopped) retry = setTimeout(connect, 1000)
        }
        ws.onerror = () => ws?.close()
      }
      connect()

      return () => {
        stopped = true
        clearTimeout(retry)
        ws?.close()
      }
    },
  }
}
