import { mkdirSync } from 'node:fs'
import { networkMiddlewares, TelegramClient } from '@mtcute/bun'
import { detectLangEnv, makeT } from '@tg/core/i18n'
import type { SyncProgress } from '@tg/core/sync'

export const lang = detectLangEnv()
export const t = makeT(lang)

const bar = (done: number, total: number, width = 20) =>
  '█'.repeat(total ? Math.round((done / total) * width) : 0).padEnd(width, '░')

// shared between the TUI status bar (index.ts) and the headless CLI's sync progress (cli.ts)
export function formatSyncLine(p: SyncProgress): string {
  const b = `[${bar(p.chatsDone, p.chatsTotal)}] ${p.chatsDone}/${p.chatsTotal}`
  return p.floodWait !== undefined
    ? t('syncFloodLine', b, p.floodWait, p.chatTitle)
    : t('syncLine', b, p.chatTitle, p.messages)
}

let floodListener: (seconds: number) => void = () => {}
export function onFlood(fn: (seconds: number) => void) {
  floodListener = fn
}

export function createClient() {
  const apiId = Number(process.env.API_ID)
  const apiHash = process.env.API_HASH
  if (!apiId || !apiHash) {
    console.error(t('needCreds'))
    process.exit(1)
  }
  mkdirSync('data', { recursive: true })
  const tg = new TelegramClient({
    apiId,
    apiHash,
    storage: 'data/session',
    network: {
      middlewares: networkMiddlewares.basic({
        // default maxWait is 10s — real history dumps hit FLOOD_WAIT_20+ constantly
        floodWaiter: {
          maxWait: 600_000,
          maxRetries: 10,
          onBeforeWait: (_ctx, seconds) => floodListener(seconds), // default printed to console and broke the TUI
        },
      }),
    },
  })
  tg.log.mgr.level = 1 // errors only — anything louder corrupts the TUI
  return tg
}

// prompt with '*' echo — phone/code/password must not stay on screen
export function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(`${question} `)
    const stdin = process.stdin
    stdin.setRawMode(true)
    stdin.resume()
    let value = ''
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false)
          stdin.off('data', onData)
          stdin.pause()
          process.stdout.write('\n')
          resolve(value.trim())
          return
        }
        if (ch === '\x03') process.exit(130) // ^C
        if (ch === '\x7f' || ch === '\b') {
          if (value) {
            value = value.slice(0, -1)
            process.stdout.write('\b \b')
          }
        } else if (ch >= ' ') {
          value += ch
          process.stdout.write('*')
        }
      }
    }
    stdin.on('data', onData)
  })
}

// auth happens in the plain terminal, before the TUI/server takes over.
// SESSION_STRING (если задан) избавляет от интерактивного входа;
// игнорируется, когда в data/session уже есть авторизация.
// tg.start({session}) would throw synchronously on a stale/invalid string
// (e.g. exported from a different mtcute version) and crash the whole
// process — import it ourselves first so a bad value just falls back to
// normal login instead of taking down the app.
export async function login(tg: TelegramClient) {
  const session = process.env.SESSION_STRING
  if (session) {
    try {
      await tg.importSession(session)
    } catch {
      console.error(t('badSessionString'))
    }
  }
  return tg.start({
    phone: () => askHidden(t('askPhone')),
    code: () => askHidden(t('askCode')),
    password: () => askHidden(t('askPassword')),
  })
}
