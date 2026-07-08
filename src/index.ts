import { createClient, login, onFlood, t } from './client'
import { openCache } from './db'
import { deleteEverywhere } from './deleter'
import { compilePattern, loadPatterns, searchCache, watchPatterns } from './search'
import { attachRealtime, syncAll } from './sync'
import { runTui } from './tui'

const tg = createClient()
const self = await login(tg)
console.log(t('loggedInUi', self.displayName))

const cache = openCache('data/cache.db')

const tui = await runTui(t, {
  search: (pattern) => {
    const re = compilePattern(pattern)
    return re ? searchCache(cache, re) : []
  },
  del: (targets) => deleteEverywhere(tg, cache, targets),
  patterns: () => loadPatterns('patterns.txt'),
})
onFlood((s) => tui.setStatus(t('floodWaitStatus', s)))

watchPatterns('patterns.txt', () => tui.setStatus(t('patternsReloaded')))
attachRealtime(tg, cache, () => tui.refresh())
await tg.startUpdatesLoop()

const bar = (done: number, total: number, width = 20) =>
  '█'.repeat(total ? Math.round((done / total) * width) : 0).padEnd(width, '░')

syncAll(tg, cache, (p) => {
  const b = `[${bar(p.chatsDone, p.chatsTotal)}] ${p.chatsDone}/${p.chatsTotal}`
  tui.setStatus(
    p.floodWait !== undefined
      ? t('syncFloodLine', b, p.floodWait, p.chatTitle)
      : t('syncLine', b, p.chatTitle, p.messages),
  )
})
  .then((p) =>
    tui.setStatus(
      t('syncDone', p.chatsDone, cache.count()) +
        (p.errors.length ? t('syncSkipped', p.errors.length, p.errors[0]!.error) : ''),
    ),
  )
  .catch((e) => tui.setStatus(t('syncError', e instanceof Error ? e.message : String(e))))
