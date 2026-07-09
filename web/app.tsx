import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LANGS, type Lang, makeT, normalizeLang } from '../src/i18n'
import './app.css'

// '' = follow the browser; otherwise a forced locale, persisted in localStorage
function initialLangPref(): '' | Lang {
  const saved = localStorage.getItem('lang')
  return saved === '' || saved === 'en' || saved === 'ru' ? saved : ''
}
function resolveLang(pref: '' | Lang): Lang {
  return pref || normalizeLang(navigator.language) || 'en'
}

interface Row {
  chat_id: number
  id: number
  date: number
  sender: string
  text: string
  chat_title: string
}

interface Status {
  sync: {
    chatTitle: string
    chatsDone: number
    chatsTotal: number
    messages: number
    errors: { error: string }[]
  } | null
  syncDone: boolean
  error: string
  flood: number
  cached: number
  patterns: string[]
}

const keyOf = (r: Row) => `${r.chat_id}:${r.id}`

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
const TOKEN = bootstrapToken()

// every API call carries the bearer token
function apiFetch(path: string, opts: RequestInit = {}) {
  return fetch(path, {
    ...opts,
    headers: { ...opts.headers, authorization: `Bearer ${TOKEN}` },
  })
}

function App() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [searchError, setSearchError] = useState('')
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [langPref, setLangPref] = useState<'' | Lang>(initialLangPref)
  const lastCached = useRef(0)
  const t = makeT(resolveLang(langPref))

  function changeLang(pref: '' | Lang) {
    localStorage.setItem('lang', pref)
    setLangPref(pref)
  }

  async function runSearch(query: string) {
    if (!query.trim()) {
      setRows([])
      setSearchError('')
      return
    }
    const res = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`)
    const data = (await res.json()) as { rows?: Row[]; error?: string }
    if (!res.ok) {
      setSearchError(data.error ?? t('invalidRegex'))
      return
    }
    setSearchError('')
    setRows(data.rows ?? [])
    setMarked(new Set())
  }

  // debounce поиска по мере ввода
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run only when the query changes
  useEffect(() => {
    const timer = setTimeout(() => runSearch(q), 400)
    return () => clearTimeout(timer)
  }, [q])

  // статус + realtime: кэш вырос — повторяем активный поиск
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run only when the query changes
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const s = (await (await apiFetch('/api/status')).json()) as Status
        setStatus(s)
        if (s.cached !== lastCached.current) {
          lastCached.current = s.cached
          if (q.trim()) runSearch(q)
        }
      } catch {
        /* сервер перезапускается — молча ждём */
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [q])

  function toggle(k: string) {
    setMarked((m) => {
      const next = new Set(m)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })
  }

  async function del() {
    const targets = (marked.size ? rows.filter((r) => marked.has(keyOf(r))) : []).map((r) => ({
      chat_id: r.chat_id,
      id: r.id,
    }))
    if (!targets.length) return
    if (!confirm(t('confirmDeleteWeb', targets.length))) return
    setBusy(true)
    try {
      const res = (await (
        await apiFetch('/api/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targets }),
        })
      ).json()) as { deleted: number; errors?: { error: string }[] }
      setNotice(
        t('deleted', res.deleted) +
          (res.errors?.length ? t('deleteErrors', res.errors.length, res.errors[0]!.error) : ''),
      )
      runSearch(q)
    } finally {
      setBusy(false)
    }
  }

  const sync = status?.sync
  const syncLine = status?.error
    ? t('syncError', status.error)
    : status?.flood
      ? t('floodWaitStatus', status.flood)
      : status?.syncDone
        ? t('cachedMsgs', status.cached) +
          (sync?.errors.length ? t('skippedShort', sync.errors.length) : '')
        : sync
          ? t('syncLine', `${sync.chatsDone}/${sync.chatsTotal}`, sync.chatTitle, sync.messages) +
            (sync.errors.length ? t('errorsShort', sync.errors.length) : '')
          : '…'

  return (
    <div className="app">
      <header>
        <h1 className="large-title">{t('appTitle')}</h1>
        <div className="topbar">
          <input
            type="search"
            placeholder={t('placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <select
            aria-label={t('language')}
            value={langPref}
            onChange={(e) => changeLang(e.target.value as '' | Lang)}
          >
            <option value="">{t('systemLang')}</option>
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        {status?.patterns?.length ? (
          <div className="patterns">
            {status.patterns.map((p) => (
              <button type="button" key={p} onClick={() => setQ(p)}>
                {p}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div className="statusbar">
        {sync && !status?.syncDone && (
          <progress value={sync.chatsDone} max={sync.chatsTotal || 1} />
        )}
        <span>{syncLine}</span>
        {searchError && <span className="err">{searchError}</span>}
        {notice && <span>{notice}</span>}
      </div>

      <main>
        {rows.length > 0 && (
          <div className="toolbar">
            <label>
              <input
                type="checkbox"
                checked={marked.size === rows.length && rows.length > 0}
                onChange={(e) => setMarked(e.target.checked ? new Set(rows.map(keyOf)) : new Set())}
              />
              {t('selectAll', rows.length)}
            </label>
            <button type="button" className="danger" disabled={!marked.size || busy} onClick={del}>
              {busy ? t('deletingBtn') : t('deleteBtn', marked.size)}
            </button>
          </div>
        )}
        <ul className="results">
          {rows.map((r) => {
            const k = keyOf(r)
            return (
              <li key={k} className={marked.has(k) ? 'sel' : ''} onClick={() => toggle(k)}>
                <input type="checkbox" checked={marked.has(k)} readOnly />
                <div>
                  <div className="meta">
                    <b>{r.chat_title}</b> · {r.sender} ·{' '}
                    {new Date(r.date * 1000).toLocaleString(resolveLang(langPref))}
                  </div>
                  <div className="text">{r.text}</div>
                </div>
              </li>
            )
          })}
        </ul>
        {q.trim() && !rows.length && !searchError && <p className="empty">{t('noMatches')}</p>}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
