import type { PeerKind } from '@tg/core/cache'
import { LANGS, type Lang, makeT, normalizeLang } from '@tg/core/i18n'
import { DEFAULT_PATTERNS } from '@tg/core/patterns'
import { useEffect, useRef, useState } from 'react'
import './app.css'

// '' = follow the browser; otherwise a forced locale, persisted in localStorage
function initialLangPref(): '' | Lang {
  const saved = localStorage.getItem('lang')
  return saved === '' || saved === 'en' || saved === 'ru' ? saved : ''
}
function resolveLang(pref: '' | Lang): Lang {
  return pref || normalizeLang(navigator.language) || 'en'
}

/** The buckets, in the order the filter lists them, with their i18n labels. */
const SCOPES: {
  kind: PeerKind
  label: 'scopeSaved' | 'scopePrivate' | 'scopeBots' | 'scopeGroups' | 'scopeChannels'
}[] = [
  { kind: 'saved', label: 'scopeSaved' },
  { kind: 'private', label: 'scopePrivate' },
  { kind: 'bot', label: 'scopeBots' },
  { kind: 'group', label: 'scopeGroups' },
  { kind: 'channel', label: 'scopeChannels' },
]

// Everything but channels, matching what the sync downloads: feeds hold nothing of
// yours, and on an old cache they are the bulk of what a regex hits. Bots stay on —
// that is where login codes are, which is half of what anyone searches for.
const DEFAULT_KINDS: PeerKind[] = ['saved', 'private', 'bot', 'group']

function initialKinds(): PeerKind[] {
  const saved = localStorage.getItem('searchKinds')
  if (saved === null) return DEFAULT_KINDS
  const picked = saved.split(',').filter((k): k is PeerKind => SCOPES.some((s) => s.kind === k))
  // an empty stored value would search nothing at all — treat it as never set
  return picked.length ? picked : DEFAULT_KINDS
}

export interface Row {
  chat_id: number
  id: number
  date: number
  sender: string
  text: string
  chat_title: string
}

export interface Status {
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

/**
 * Everything this view needs from a backend — the whole surface, deliberately three
 * calls wide. `data-server.ts` implements it over the self-hosted API + WebSocket;
 * `core-client.ts` implements it against @tg/core in the browser, with no server at all.
 */
export interface DataLayer {
  /** `kinds` is the peer types to search; chats the cache has no label for always count. */
  search(query: string, kinds: PeerKind[]): Promise<{ rows: Row[] } | { error: string }>
  del(targets: { chat_id: number; id: number }[]): Promise<{
    deleted: number
    errors?: { error: string }[]
  }>
  /** Pushes a status snapshot on subscribe and on every change; returns an unsubscribe. */
  subscribeStatus(onStatus: (s: Status) => void): () => void
  /**
   * Drops the sync bookkeeping and walks all history again. Needed because an
   * incremental sync only ever looks *forward*: a chat it already marked backfilled is
   * never revisited, so anything Telegram didn't hand over the first time (a peer that
   * errored, a message that arrived while the tab was closed and the updates loop
   * missed) stays invisible until something forgets the high-water mark.
   */
  resync(): Promise<void>
}

export function App({ data }: { data: DataLayer }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [searchError, setSearchError] = useState('')
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [langPref, setLangPref] = useState<'' | Lang>(initialLangPref)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [kinds, setKinds] = useState<PeerKind[]>(initialKinds)
  const lastCached = useRef(0)
  const t = makeT(resolveLang(langPref))

  // a template fills the search box and closes the sheet — no second click to dismiss
  function pickPattern(pattern: string) {
    setQ(pattern)
    setTemplatesOpen(false)
  }

  // Never lets the last kind go: an empty selection searches nothing, which reads as a
  // broken search rather than as a choice.
  function toggleKind(kind: PeerKind) {
    const next = kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind]
    if (!next.length) return
    localStorage.setItem('searchKinds', next.join(','))
    setKinds(next)
  }

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
    const res = await data.search(query, kinds)
    if ('error' in res) {
      setSearchError(res.error || t('invalidRegex'))
      return
    }
    setSearchError('')
    setRows(res.rows)
    setMarked(new Set())
  }

  // Latest-render refs: the socket effect below must NOT re-subscribe on every keystroke,
  // so it reads the current query and search fn through refs instead of deps.
  const qRef = useRef(q)
  qRef.current = q
  const runSearchRef = useRef(runSearch)
  runSearchRef.current = runSearch
  const researchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // debounce поиска по мере ввода; смена области поиска — тот же повторный запрос
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on the query and the scope, nothing else
  useEffect(() => {
    const timer = setTimeout(() => runSearch(q), 400)
    return () => clearTimeout(timer)
  }, [q, kinds])

  // Статус приходит push-ом от слоя данных: сервер шлёт снимок по WebSocket, браузерный
  // клиент — из своего прогресса синхронизации. Опроса нет ни там, ни там.
  // biome-ignore lint/correctness/useExhaustiveDependencies: subscribe once; the query is read through refs
  useEffect(() => {
    const unsubscribe = data.subscribeStatus((s) => {
      setStatus(s)
      if (s.cached === lastCached.current) return
      lastCached.current = s.cached
      // Кэш вырос — повторяем активный поиск. Дебаунс, чтобы догоняющий поток
      // апдейтов не превратился в запрос на каждое сообщение.
      if (!qRef.current.trim()) return
      clearTimeout(researchTimer.current)
      researchTimer.current = setTimeout(() => runSearchRef.current(qRef.current), 300)
    })
    return () => {
      unsubscribe()
      clearTimeout(researchTimer.current)
    }
  }, [])

  function toggle(k: string) {
    setMarked((m) => {
      const next = new Set(m)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })
  }

  async function resync() {
    await data.resync()
    setNotice(t('resyncStarted'))
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
      const res = await data.del(targets)
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
  // A resync while one is already walking would just fight over the same cursors; the
  // data layers refuse it too, this only keeps the button from lying about it. A failed
  // walk counts as finished — otherwise the one button that could retry it stays dead,
  // since a sync that dies before its first progress report never sets syncDone.
  const syncing = !!sync && !status?.syncDone && !status?.error
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
          {/* <details> is the whole popover: native light-dismiss-ish behaviour, no
              library, and it degrades to an inline list if anything goes wrong */}
          <details
            className="templates"
            open={templatesOpen}
            onToggle={(e) => setTemplatesOpen(e.currentTarget.open)}
          >
            <summary>{t('templatesBtn')}</summary>
            <div className="sheet">
              {DEFAULT_PATTERNS.map(({ label, pattern }) => (
                <button type="button" key={label} onClick={() => pickPattern(pattern)}>
                  {t(label)}
                </button>
              ))}
              {status?.patterns?.length ? (
                <>
                  <span className="sep">{t('patternsFromFile')}</span>
                  {status.patterns.map((p) => (
                    <button type="button" key={p} onClick={() => pickPattern(p)}>
                      {p}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          </details>
          {/* same native <details> popover as the templates sheet */}
          <details
            className="templates"
            open={scopeOpen}
            onToggle={(e) => setScopeOpen(e.currentTarget.open)}
          >
            <summary>{t('scopeBtn')}</summary>
            <div className="sheet">
              {SCOPES.map(({ kind, label }) => (
                <label key={kind}>
                  <input
                    type="checkbox"
                    checked={kinds.includes(kind)}
                    onChange={() => toggleKind(kind)}
                  />
                  {t(label)}
                </label>
              ))}
              <span className="sep">{t('scopeHint')}</span>
            </div>
          </details>
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
      </header>

      <div className="statusbar">
        {sync && !status?.syncDone && (
          <progress value={sync.chatsDone} max={sync.chatsTotal || 1} />
        )}
        <span>{syncLine}</span>
        <button type="button" disabled={syncing} onClick={resync} title={t('resyncHint')}>
          {t('resyncBtn')}
        </button>
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
