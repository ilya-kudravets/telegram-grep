// Headless JSON CLI — lets any AI agent drive the cache without the TUI.
// search/stats are offline (cache only, no Telegram connection); sync/delete
// need an authenticated session (data/session or SESSION_STRING in .env).
import { mkdirSync } from 'node:fs'
import { createClient, login } from './client'
import { openCache } from './db'
import { type DeleteTarget, deleteEverywhere } from './deleter'
import { compilePattern, searchCache } from './search'
import { syncAll } from './sync'

const CACHE = 'data/cache.db'
const out = (data: unknown) => process.stdout.write(`${JSON.stringify(data)}\n`)
// offline commands open the cache without createClient, which is what mkdirs data/
function openDb() {
  mkdirSync('data', { recursive: true })
  return openCache(CACHE)
}

const USAGE = {
  usage: 'tg-client <command>',
  commands: {
    search: 'search "<regex|/pat/flags>" [--limit N] — search the cache (offline), JSON matches',
    stats: 'stats — number of cached messages (offline)',
    sync: 'sync — download/update history from Telegram (needs auth)',
    delete: 'delete <chatId>:<msgId> ... — delete messages for everyone (needs auth)',
  },
}

// pull `--flag value` out of args, returning [value, remaining args]
function takeFlag(args: string[], flag: string): [string | undefined, string[]] {
  const i = args.indexOf(flag)
  if (i < 0) return [undefined, args]
  return [args[i + 1], args.slice(0, i).concat(args.slice(i + 2))]
}

// createClient() process.exit()s on missing creds and login() prompts on a TTY —
// both break the one-line-JSON contract for a headless agent. Check creds up front
// and turn any login failure (e.g. setRawMode throwing on a non-TTY when no session
// exists) into a JSON error instead of a bare stack trace + nonzero exit.
async function authedClient() {
  if (!process.env.API_ID || !process.env.API_HASH) {
    out({ error: 'missing API_ID/API_HASH in .env' })
    return null
  }
  const tg = createClient()
  try {
    await login(tg)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    out({ error: `login failed: ${msg}; set SESSION_STRING in .env for non-interactive auth` })
    return null
  }
  return tg
}

export async function runCli(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv

  switch (cmd) {
    case 'search': {
      const [limitStr, rest] = takeFlag(args, '--limit')
      const re = compilePattern(rest.join(' '))
      if (!re) {
        out({ error: 'empty or invalid pattern' })
        return 1
      }
      let limit = 1000
      if (limitStr !== undefined) {
        limit = Number(limitStr)
        if (!Number.isInteger(limit) || limit <= 0) {
          out({ error: '--limit must be a positive integer' })
          return 1
        }
      }
      const cache = openDb()
      const results = searchCache(cache, re, limit)
      cache.close()
      out({ count: results.length, results })
      return 0
    }

    case 'stats': {
      const cache = openDb()
      out({ messages: cache.count() })
      cache.close()
      return 0
    }

    case 'sync': {
      const tg = await authedClient()
      if (!tg) return 1
      const cache = openDb()
      const p = await syncAll(tg, cache)
      out({ chatsDone: p.chatsDone, messages: cache.count(), errors: p.errors })
      cache.close()
      return 0
    }

    case 'delete': {
      const targets: DeleteTarget[] = []
      for (const arg of args) {
        const [c, i] = arg.split(':')
        const chat_id = Number(c)
        const id = Number(i)
        if (!chat_id || !id) {
          out({ error: `bad target '${arg}', expected <chatId>:<msgId>` })
          return 1
        }
        targets.push({ chat_id, id })
      }
      if (!targets.length) {
        out({ error: 'no targets; usage: delete <chatId>:<msgId> ...' })
        return 1
      }
      const tg = await authedClient()
      if (!tg) return 1
      const cache = openDb()
      out(await deleteEverywhere(tg, cache, targets))
      cache.close()
      return 0
    }

    case 'help':
    case '--help':
    case '-h':
      out(USAGE)
      return 0

    default:
      out({ error: `unknown command '${cmd}'`, ...USAGE })
      return 1
  }
}
