import { mkdirSync } from 'node:fs'
import { TelegramClient, networkMiddlewares } from '@mtcute/bun'
import { detectLangEnv, makeT } from './i18n'

export const lang = detectLangEnv()
export const t = makeT(lang)

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
    process.stdout.write(question + ' ')
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
// SESSION_STRING (если задан в .env) избавляет от интерактивного входа;
// игнорируется, когда в data/session уже есть авторизация
export async function login(tg: TelegramClient) {
  return tg.start({
    session: process.env.SESSION_STRING || undefined,
    phone: () => askHidden(t('askPhone')),
    code: () => askHidden(t('askCode')),
    password: () => askHidden(t('askPassword')),
  })
}
