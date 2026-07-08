import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  TextRenderable,
  createCliRenderer,
  type KeyEvent,
} from '@opentui/core'
import type { SearchRow } from './db'
import type { DeleteResult, DeleteTarget } from './deleter'
import type { T } from './i18n'

export interface TuiDeps {
  search: (pattern: string) => SearchRow[]
  del: (targets: DeleteTarget[]) => Promise<DeleteResult>
  patterns: () => string[]
}

export async function runTui(t: T, deps: TuiDeps) {
  const HELP = t('help')
  const renderer = await createCliRenderer({ exitOnCtrlC: true })

  let rows: SearchRow[] = []
  const marked = new Set<string>() // `${chat_id}:${id}`
  let pendingDelete: DeleteTarget[] | null = null
  let focused: 'input' | 'list' = 'input'
  let patternIdx = -1
  let statusExtra = ''

  const root = new BoxRenderable(renderer, {
    id: 'root',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
  })
  const inputBox = new BoxRenderable(renderer, {
    id: 'input-box',
    borderStyle: 'rounded',
    title: t('titleSearch'),
    height: 3,
    flexShrink: 0,
  })
  const input = new InputRenderable(renderer, {
    id: 'pattern-input',
    placeholder: t('placeholder'),
    flexGrow: 1,
  })
  const listBox = new BoxRenderable(renderer, {
    id: 'list-box',
    borderStyle: 'rounded',
    title: t('titleMessages'),
    flexGrow: 1,
  })
  const list = new SelectRenderable(renderer, {
    id: 'results',
    options: [],
    width: '100%',
    flexGrow: 1,
    showDescription: true,
    showScrollIndicator: true,
  })
  const status = new TextRenderable(renderer, { id: 'status', content: '', fg: '#888888' })
  // control hints live on their own line below the status
  const help = new TextRenderable(renderer, { id: 'help', content: HELP, fg: '#555555' })

  inputBox.add(input)
  listBox.add(list)
  root.add(inputBox)
  root.add(listBox)
  root.add(status)
  root.add(help)
  renderer.root.add(root)

  const keyOf = (r: SearchRow) => `${r.chat_id}:${r.id}`

  function renderStatus() {
    const base = pendingDelete
      ? t('confirmDeleteTui', pendingDelete.length)
      : t('statusBase', rows.length, marked.size)
    status.content = statusExtra ? `${statusExtra} | ${base}` : base
  }

  function renderList() {
    const keep = list.getSelectedIndex()
    list.options = rows.map((r) => ({
      name: `${marked.has(keyOf(r)) ? '✓' : ' '} ${r.chat_title} · ${new Date(r.date * 1000).toISOString().slice(0, 16).replace('T', ' ')} · ${r.sender}`,
      description: r.text.replace(/\s+/g, ' ').slice(0, 120),
      value: r,
    }))
    if (keep >= 0 && keep < rows.length) list.setSelectedIndex(keep)
    renderStatus()
  }

  function runSearch() {
    rows = input.value.trim() ? deps.search(input.value) : []
    marked.clear()
    pendingDelete = null
    renderList()
  }

  let debounce: ReturnType<typeof setTimeout> | undefined
  input.on(InputRenderableEvents.INPUT, () => {
    clearTimeout(debounce)
    debounce = setTimeout(runSearch, 400)
  })

  function setFocus(which: 'input' | 'list') {
    focused = which
    if (which === 'input') {
      list.blur()
      input.focus()
    } else {
      input.blur()
      list.focus()
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const targets = pendingDelete
    pendingDelete = null
    statusExtra = t('deleting', targets.length)
    renderStatus()
    const res = await deps.del(targets)
    statusExtra =
      t('deleted', res.deleted) +
      (res.errors.length ? t('deleteErrors', res.errors.length, res.errors[0]!.error) : '')
    runSearch()
  }

  renderer.keyInput.on('keypress', (key: KeyEvent) => {
    if (key.name === 'tab') {
      setFocus(focused === 'input' ? 'list' : 'input')
      return
    }
    if (key.ctrl && key.name === 'p') {
      const pats = deps.patterns()
      if (pats.length) {
        patternIdx = (patternIdx + 1) % pats.length
        input.value = pats[patternIdx]!
        statusExtra = t('patternN', patternIdx + 1, pats.length)
        runSearch()
      } else {
        statusExtra = t('patternsEmpty')
        renderStatus()
      }
      return
    }
    if (key.name === 'escape') {
      // full visible reset: clear the query, results, selection and any pending confirm.
      // programmatic value set doesn't emit INPUT, so drop rows here too.
      input.value = ''
      rows = []
      pendingDelete = null
      marked.clear()
      statusExtra = ''
      setFocus('input')
      renderList()
      return
    }
    if (pendingDelete) {
      if (key.name === 'y') void confirmDelete()
      else if (key.name === 'n') {
        pendingDelete = null
        renderStatus()
      }
      return
    }
    if (focused !== 'list') return
    const current = rows[list.getSelectedIndex()]
    if (key.name === 'space' && current) {
      const k = keyOf(current)
      if (marked.has(k)) marked.delete(k)
      else marked.add(k)
      list.moveDown()
      renderList()
    } else if (key.name === 'd' && rows.length) {
      const targets = marked.size
        ? rows.filter((r) => marked.has(keyOf(r)))
        : current
          ? [current]
          : []
      if (targets.length) {
        pendingDelete = targets.map((r) => ({ chat_id: r.chat_id, id: r.id }))
        renderStatus()
      }
    }
  })

  input.on(InputRenderableEvents.ENTER, () => {
    clearTimeout(debounce)
    runSearch()
    setFocus('list')
  })

  setFocus('input')
  renderStatus()

  let lastRefresh = 0
  return {
    setStatus(s: string) {
      statusExtra = s
      renderStatus()
    },
    // realtime cache changes → re-run the active search, throttled to 1/s
    refresh() {
      if (!input.value.trim() || Date.now() - lastRefresh < 1000) return
      lastRefresh = Date.now()
      rows = deps.search(input.value)
      renderList()
    },
  }
}
