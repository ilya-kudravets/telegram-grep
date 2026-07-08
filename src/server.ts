import index from '../web/index.html'
import { makeApi } from './api'
import { createClient, login, onFlood, t } from './client'
import { openCache } from './db'
import { deleteEverywhere } from './deleter'
import { compilePattern, loadPatterns, searchCache } from './search'
import { attachRealtime, type SyncProgress, syncAll } from './sync'
import { guardRoutes, loadOrCreateToken } from './webauth'

const tg = createClient()
const self = await login(tg)
const cache = openCache('data/cache.db')

const status: { sync: SyncProgress | null; syncDone: boolean; error: string; flood: number } = {
  sync: null,
  syncDone: false,
  error: '',
  flood: 0,
}
onFlood((s) => (status.flood = s))

attachRealtime(tg, cache)
await tg.startUpdatesLoop()

syncAll(tg, cache, (p) => {
  status.sync = { ...p }
  status.flood = 0
})
  .then(() => (status.syncDone = true))
  .catch((e) => (status.error = e instanceof Error ? e.message : String(e)))

const token = loadOrCreateToken('data/web-token')

// bind to localhost only unless LAN access is explicitly requested (HOST=0.0.0.0 or LAN=1)
const hostname = process.env.HOST || (process.env.LAN === '1' ? '0.0.0.0' : '127.0.0.1')

const serveOpts = {
  hostname,
  routes: {
    '/': index, // page + bundled assets are public; the app bootstraps the token, /api/* is gated
    ...guardRoutes(
      token,
      makeApi({
        search: (pattern: string) => {
          const re = compilePattern(pattern)
          return re ? searchCache(cache, re) : null
        },
        del: (targets: Parameters<typeof deleteEverywhere>[2]) =>
          deleteEverywhere(tg, cache, targets),
        status: () => ({
          ...status,
          cached: cache.count(),
          patterns: loadPatterns('patterns.txt'),
        }),
      }),
    ),
  },
}

// walk forward if the chosen port is taken, so a stale/other instance doesn't block startup
const basePort = Number(process.env.PORT) || 8080
let server: ReturnType<typeof Bun.serve> | undefined
for (let port = basePort; port < basePort + 20; port++) {
  try {
    server = Bun.serve({ ...serveOpts, port })
    break
  } catch (e) {
    if ((e as { code?: string }).code !== 'EADDRINUSE') throw e
    console.log(t('portBusy', port, port + 1))
  }
}
if (!server) throw new Error(t('allPortsBusy', basePort, basePort + 19))

// the token travels in the URL; the app stores it and strips it on first load
const tokenizedUrl = `${String(server.url).replace(/\/$/, '')}/?token=${token}`
console.log(t('loggedInWeb', self.displayName, tokenizedUrl))
if (hostname === '0.0.0.0') console.log(t('fromPhone', server.port ?? '', token))
else console.log(t('localOnly'))
