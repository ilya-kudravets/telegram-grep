import {
  attachRealtime,
  compilePattern,
  createClient,
  deleteEverywhere,
  loadPatterns,
  login,
  onFlood,
  openCache,
  type SyncProgress,
  searchCache,
  syncAll,
  syncChannels,
  t,
} from '@tg/bun'
import index from '../web/index.html'
import { makeApi } from './api'
import { makeLive } from './live'
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

// One source of truth for both transports: the /api/status response and every WS push.
const statusPayload = () => ({
  ...status,
  cached: cache.count(),
  patterns: loadPatterns('patterns.txt'),
})

const token = loadOrCreateToken('data/web-token')
const live = makeLive(token, statusPayload)
const broadcast = () => live.broadcast()

onFlood((s) => {
  status.flood = s
  broadcast()
})

attachRealtime(tg, cache, broadcast, undefined, syncChannels())
await tg.startUpdatesLoop()

// The boot sync and the /api/resync one are the same walk — the only difference is that
// a resync clears the cursors first. `running` keeps two of them off the same chats.
let running = false
function runSync() {
  if (running) return
  running = true
  status.syncDone = false
  status.error = ''
  syncAll(
    tg,
    cache,
    (p) => {
      status.sync = { ...p }
      status.flood = 0
      broadcast()
    },
    undefined,
    syncChannels(),
  )
    .then(() => {
      status.syncDone = true
    })
    .catch((e) => {
      status.error = e instanceof Error ? e.message : String(e)
    })
    .finally(() => {
      running = false
      broadcast()
    })
}
runSync()

// bind to localhost only unless LAN access is explicitly requested (HOST=0.0.0.0 or LAN=1)
const hostname = process.env.HOST || (process.env.LAN === '1' ? '0.0.0.0' : '127.0.0.1')

const serveOpts = {
  hostname,
  routes: {
    '/': index, // page + bundled assets are public; the app bootstraps the token, /api/* is gated
    '/ws': (req: Request, srv: Bun.Server<undefined>) => live.route(req, srv),
    ...guardRoutes(
      token,
      makeApi({
        search: (pattern, kinds) => {
          const re = compilePattern(pattern)
          return re ? searchCache(cache, re, undefined, kinds) : null
        },
        del: (targets: Parameters<typeof deleteEverywhere>[2]) =>
          deleteEverywhere(tg, cache, targets),
        status: statusPayload,
        resync: () => {
          if (running) return
          cache.resetSyncState()
          runSync()
        },
      }),
    ),
  },
  websocket: live.websocket,
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
live.setPublisher(server) // only now can pushes go out

// the token travels in the URL; the app stores it and strips it on first load
const tokenizedUrl = `${String(server.url).replace(/\/$/, '')}/?token=${token}`
console.log(t('loggedInWeb', self.displayName, tokenizedUrl))
if (hostname === '0.0.0.0') console.log(t('fromPhone', server.port ?? '', token))
else console.log(t('localOnly'))
