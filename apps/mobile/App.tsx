import './src/polyfills' // MUST be first
import type { TelegramClient } from '@mtcute/core/client.js'
import type { SearchRow } from '@tg/core/cache'
import { deleteEverywhere } from '@tg/core/deleter'
import { compilePattern, searchCache } from '@tg/core/search'
import { attachRealtime, type SyncProgress, syncAll } from '@tg/core/sync'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native'
import { type MobileCache, openCache } from './src/cache'
import { createClient } from './src/mtcute-rn/adapter'

type Ask = 'phone' | 'code' | 'password' | null

// iOS system colors (Apple HIG) for light / dark.
function palette(dark: boolean) {
  return {
    bg: dark ? '#000000' : '#f2f2f7',
    card: dark ? '#1c1c1e' : '#ffffff',
    label: dark ? '#ffffff' : '#000000',
    label2: dark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)',
    label3: dark ? 'rgba(235,235,245,0.3)' : 'rgba(60,60,67,0.3)',
    separator: dark ? 'rgba(84,84,88,0.6)' : 'rgba(60,60,67,0.29)',
    tint: dark ? '#0a84ff' : '#007aff',
    red: dark ? '#ff453a' : '#ff3b30',
    green: dark ? '#30d158' : '#34c759',
    field: dark ? 'rgba(118,118,128,0.24)' : 'rgba(118,118,128,0.12)',
    avatar: dark ? '#0a84ff' : '#007aff',
  }
}
type Theme = ReturnType<typeof palette>

function Section({ theme, title, children }: { theme: Theme; title: string; children: ReactNode[] }) {
  const rows = children.filter(Boolean)
  if (!rows.length) return null
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={[s.sectionHeader, { color: theme.label2 }]}>{title.toUpperCase()}</Text>
      <View style={[s.card, { backgroundColor: theme.card }]}>
        {rows.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-order presentational rows
          <View key={i}>
            {row}
            {i < rows.length - 1 ? <View style={[s.separator, { backgroundColor: theme.separator }]} /> : null}
          </View>
        ))}
      </View>
    </View>
  )
}

const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleDateString()

export default function App() {
  const dark = useColorScheme() === 'dark'
  const theme = palette(dark)

  const cacheRef = useRef<MobileCache | null>(null)
  const tgRef = useRef<TelegramClient | null>(null)

  const [connected, setConnected] = useState(false)
  const [me, setMe] = useState('')
  const [status, setStatus] = useState('') // transient error/progress line
  const [progress, setProgress] = useState<SyncProgress | null>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchRow[]>([])
  const [count, setCount] = useState(0)
  const lastQuery = useRef('')

  // credential prompt plumbing (resolves the promise start() awaits)
  const [ask, setAsk] = useState<Ask>(null)
  const [value, setValue] = useState('')
  const resolver = useRef<((v: string) => void) | null>(null)
  const prompt = (kind: Exclude<Ask, null>) => (): Promise<string> => {
    setAsk(kind)
    setValue('')
    return new Promise((res) => {
      resolver.current = (v) => {
        setAsk(null)
        res(v)
      }
    })
  }
  const reject = () => Promise.reject(new Error('login required'))

  function runSearch(raw: string) {
    lastQuery.current = raw
    const cache = cacheRef.current
    if (!cache) return
    const re = compilePattern(raw)
    setResults(re ? searchCache(cache, re, 200) : [])
  }

  // interactive=false → silent auto-reconnect (bad/absent session just fails quietly,
  // search stays available); interactive=true → prompt for phone/code/password.
  async function connect(interactive: boolean) {
    const tg = tgRef.current
    const cache = cacheRef.current
    if (!tg || !cache) return
    setStatus('connecting…')
    try {
      const user = await tg.start({
        phone: interactive ? prompt('phone') : reject,
        code: interactive ? prompt('code') : reject,
        password: interactive ? prompt('password') : reject,
      })
      setMe(user.displayName ?? String(user.id))
      cache.setSession(await tg.exportSession())
      attachRealtime(tg, cache, () => {
        setCount(cache.count())
        runSearch(lastQuery.current)
      })
      setConnected(true)
      setStatus('')
    } catch (e) {
      setStatus(interactive ? `❌ ${e instanceof Error ? e.message : String(e)}` : '')
    }
  }
  const submit = () => resolver.current?.(value.trim())

  // open the cache (offline-ready: search works with no connection), create the
  // client, then try a silent reconnect from the persisted session.
  useEffect(() => {
    const cache = openCache()
    cacheRef.current = cache
    setCount(cache.count())
    const tg = createClient(Number(process.env.EXPO_PUBLIC_API_ID), process.env.EXPO_PUBLIC_API_HASH ?? '')
    tgRef.current = tg
    const saved = cache.getSession()
    if (saved) {
      tg.importSession(saved)
        .then(() => connect(false))
        .catch(() => {})
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: run-once boot; connect closes over stable refs
  }, [])

  async function sync() {
    const tg = tgRef.current
    const cache = cacheRef.current
    if (!tg || !cache) return
    setProgress({ chatTitle: '', chatsDone: 0, chatsTotal: 0, messages: 0, errors: [] })
    try {
      await syncAll(tg, cache, setProgress)
      setCount(cache.count())
      runSearch(lastQuery.current)
    } catch (e) {
      setStatus(`❌ sync: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setProgress(null)
    }
  }

  function confirmDelete(row: SearchRow) {
    if (!connected) {
      setStatus('connect to delete')
      return
    }
    Alert.alert('Delete for everyone?', row.text.slice(0, 120), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const tg = tgRef.current
          const cache = cacheRef.current
          if (!tg || !cache) return
          const r = await deleteEverywhere(tg, cache, [{ chat_id: row.chat_id, id: row.id }])
          if (r.errors.length) setStatus(`❌ ${r.errors[0]?.error}`)
          setCount(cache.count())
          runSearch(lastQuery.current)
        },
      },
    ])
  }

  const syncing = progress !== null
  const syncPct = progress?.chatsTotal ? Math.round((progress.chatsDone / progress.chatsTotal) * 100) : 0

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <View style={{ padding: 16, paddingBottom: 0 }}>
        <Text style={[s.largeTitle, { color: theme.label }]}>Search</Text>

        <View style={[s.searchField, { backgroundColor: theme.field }]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => runSearch(query)}
            placeholder="regex or /pat/flags"
            placeholderTextColor={theme.label3}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[s.searchInput, { color: theme.label }]}
          />
        </View>

        <View style={s.toolbar}>
          <Text style={[s.meta, { color: theme.label2 }]} numberOfLines={1}>
            {results.length} of {count} cached{connected ? ` · ${me}` : ''}
          </Text>
          {connected ? (
            <Pressable onPress={sync} disabled={syncing} hitSlop={8}>
              <Text style={[s.action, { color: syncing ? theme.label3 : theme.tint }]}>
                {syncing ? `Syncing ${syncPct}%` : 'Sync'}
              </Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => connect(true)} hitSlop={8}>
              <Text style={[s.action, { color: theme.tint }]}>Connect</Text>
            </Pressable>
          )}
        </View>
        {status ? <Text style={[s.meta, { color: theme.red }]}>{status}</Text> : null}
      </View>

      {/* credential prompt */}
      {ask ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Section theme={theme} title={`Enter ${ask}`}>
            {[
              <View style={s.row} key="input">
                <TextInput
                  value={value}
                  onChangeText={setValue}
                  autoFocus
                  placeholder={ask}
                  placeholderTextColor={theme.label3}
                  secureTextEntry={ask === 'password'}
                  keyboardType={ask === 'phone' || ask === 'code' ? 'phone-pad' : 'default'}
                  onSubmitEditing={submit}
                  returnKeyType="done"
                  style={[s.rowText, { color: theme.label }]}
                />
              </View>,
              <Pressable
                key="ok"
                onPress={submit}
                style={({ pressed }) => [s.row, s.center, pressed && { opacity: 0.4 }]}
              >
                <Text style={[s.rowText, s.action, { color: theme.tint }]}>OK</Text>
              </Pressable>,
            ]}
          </Section>
        </View>
      ) : null}

      <FlatList
        data={results}
        keyExtractor={(r) => `${r.chat_id}:${r.id}`}
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={[s.separator, { backgroundColor: theme.separator }]} />}
        renderItem={({ item }) => (
          <Pressable
            onLongPress={() => confirmDelete(item)}
            style={({ pressed }) => [s.result, pressed && { opacity: 0.5 }]}
          >
            <View style={s.resultHead}>
              <Text style={[s.resultSender, { color: theme.label }]} numberOfLines={1}>
                {item.sender || '(unknown)'}
              </Text>
              <Text style={[s.resultChat, { color: theme.label2 }]} numberOfLines={1}>
                {item.chat_title} · {fmtDate(item.date)}
              </Text>
            </View>
            <Text style={[s.resultText, { color: theme.label }]} numberOfLines={3}>
              {item.text}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          syncing ? (
            <View style={[s.row, s.center]}>
              <ActivityIndicator color={theme.label2} />
            </View>
          ) : (
            <Text style={[s.meta, { color: theme.label3, textAlign: 'center', marginTop: 40 }]}>
              {query ? 'no matches' : 'type a pattern to search your cached messages'}
            </Text>
          )
        }
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: -0.4, marginBottom: 12, marginTop: 4 },
  sectionHeader: { fontSize: 13, fontWeight: '400', marginLeft: 16, marginBottom: 7, letterSpacing: 0.3 },
  card: { borderRadius: 12, overflow: 'hidden' },
  searchField: { borderRadius: 10, paddingHorizontal: 12, height: 38, justifyContent: 'center' },
  searchInput: { fontSize: 17, padding: 0 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  meta: { fontSize: 13, flexShrink: 1 },
  action: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 44, paddingVertical: 11 },
  center: { justifyContent: 'center' },
  separator: { height: StyleSheet.hairlineWidth },
  rowText: { flex: 1, fontSize: 17 },
  result: { paddingVertical: 10 },
  resultHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  resultSender: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  resultChat: { fontSize: 12, flexShrink: 1, textAlign: 'right' },
  resultText: { fontSize: 15, lineHeight: 20 },
})
