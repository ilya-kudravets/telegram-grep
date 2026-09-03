import {
  attachRealtime,
  compilePattern,
  createClient,
  DEFAULT_PATTERNS,
  deleteEverywhere,
  ensureEnvFile,
  formatSyncLine,
  loadPatterns,
  login,
  onFlood,
  openCache,
  searchCache,
  searchKinds,
  syncAll,
  syncChannels,
  t,
  watchPatterns,
} from '@tg/bun'
import { runCli } from './cli'

// Headless CLI for AI agents: any subcommand runs and exits without the TUI.
// `tui` (or no args) falls through to the interactive client below.
const cmd = process.argv[2]
if (cmd && cmd !== 'tui') {
  process.exit(await runCli(process.argv.slice(2)))
}

if (ensureEnvFile()) {
  console.log(
    'Created .env — fill in API_ID/API_HASH (https://my.telegram.org → API development tools) and rerun.',
  )
  process.exit(0)
}

const tg = createClient()
const self = await login(tg)
console.log(t('loggedInUi', self.displayName))

const cache = openCache('data/cache.db')

// dynamic import: ./tui pulls opentui's native binary — keep it off the headless path
const { runTui } = await import('./tui')
const tui = await runTui(t, {
  search: (pattern) => {
    const re = compilePattern(pattern)
    return re ? searchCache(cache, re, undefined, searchKinds()) : []
  },
  del: (targets) => deleteEverywhere(tg, cache, targets),
  // ^P cycles the built-in templates first, then whatever patterns.txt adds — the same
  // list the web UI shows in its Templates sheet
  patterns: () => [...DEFAULT_PATTERNS.map((tpl) => tpl.pattern), ...loadPatterns('patterns.txt')],
})
onFlood((s) => tui.setStatus(t('floodWaitStatus', s)))

watchPatterns('patterns.txt', () => tui.setStatus(t('patternsReloaded')))
attachRealtime(tg, cache, () => tui.refresh(), undefined, syncChannels())
await tg.startUpdatesLoop()

syncAll(tg, cache, (p) => tui.setStatus(formatSyncLine(p)), undefined, syncChannels())
  .then((p) =>
    tui.setStatus(
      t('syncDone', p.chatsDone, cache.count()) +
        (p.errors.length ? t('syncSkipped', p.errors.length, p.errors[0]!.error) : ''),
    ),
  )
  .catch((e) => tui.setStatus(t('syncError', e instanceof Error ? e.message : String(e))))
