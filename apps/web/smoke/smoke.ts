// Browser smoke for the static-client foundation. Two things cannot be checked from
// `bun test`, and both are load-bearing for the GitHub Pages plan:
//
//   1. the portable core actually runs in a browser (no Node/Bun API sneaks in through
//      @tg/core/cache-memory or @tg/core/search),
//   2. the IndexedDB store round-trips a snapshot across a page load.
//
// The page reports one line per check, so a browser driver only has to read text.
// Load it once to seed, then again: the second load must restore what the first saved.
import { createMemoryCache } from '@tg/core/cache-memory'
import { compilePattern, searchCache } from '@tg/core/search'
import { clearSnapshot, loadSnapshot, saveSnapshot } from '../web/store'

const log = document.getElementById('log') as HTMLElement
const report = (ok: boolean, line: string) => {
  const el = document.createElement('div')
  el.textContent = `${ok ? 'PASS' : 'FAIL'} ${line}`
  el.dataset.ok = String(ok)
  log.append(el)
  return ok
}

const seed = [
  { chat_id: 1, id: 10, date: 1700000001, sender: 'Alice', text: 'my password is hunter2', out: 0 },
  { chat_id: 1, id: 11, date: 1700000002, sender: 'Bob', text: 'nothing to see', out: 1 },
  {
    chat_id: -1000000000123,
    id: 5,
    date: 1700000003,
    sender: 'Chan',
    text: 'API_TOKEN=abc',
    out: 0,
  },
] as const

async function main() {
  if (new URL(location.href).searchParams.has('reset')) await clearSnapshot()
  const restored = await loadSnapshot()

  if (!restored) {
    const cache = createMemoryCache()
    cache.upsertChat(1, 'Alice')
    cache.upsertChat(-1000000000123, 'Channel')
    cache.insertMessages([...seed])
    await saveSnapshot(cache.snapshot())
    report(cache.count() === 3, `seeded ${cache.count()} messages and saved a snapshot`)
    document.body.dataset.phase = 'seeded'
    return
  }

  const cache = createMemoryCache(restored)
  report(cache.count() === 3, `restored ${cache.count()} messages from IndexedDB`)

  const newestFirst = [...cache.iterAll()].map((r) => r.id)
  report(
    String(newestFirst) === String([5, 11, 10]),
    `iterAll is newest-first after a reload: ${newestFirst}`,
  )

  const titled = [...cache.iterAll()].every((r) => r.chat_title !== '')
  report(titled, 'chat titles survived the round-trip')

  const hits = searchCache(cache, compilePattern('/password|token/i')!)
  report(hits.length === 2, `regex search over the restored cache found ${hits.length} of 2`)

  const state = cache.backfillState(1)
  report(!state.backfilled, 'per-chat sync state came back intact')

  document.body.dataset.phase = 'restored'
}

main().catch((e) => {
  report(false, `threw: ${e instanceof Error ? e.message : String(e)}`)
  document.body.dataset.phase = 'error'
})
