import './src/polyfills' // MUST be first
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native'
import { createClient } from './src/mtcute-rn/adapter'
import { probeTelegram, type Result, runSelfTest } from './src/mtcute-rn/verify'

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

// Grouped section: uppercase footnote header + rounded card with inset hairline separators.
function Section({ theme, title, children }: { theme: Theme; title: string; children: ReactNode[] }) {
  const rows = children.filter(Boolean)
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={[s.sectionHeader, { color: theme.label2 }]}>{title.toUpperCase()}</Text>
      <View style={[s.card, { backgroundColor: theme.card }]}>
        {rows.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-order presentational rows
          <View key={i}>
            {row}
            {i < rows.length - 1 ? (
              <View style={[s.separator, { backgroundColor: theme.separator }]} />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  )
}

function Dot({ color }: { color: string }) {
  return <View style={[s.dot, { backgroundColor: color }]} />
}

export default function App() {
  const dark = useColorScheme() === 'dark'
  const theme = palette(dark)

  const [tests, setTests] = useState<Result[]>([])
  const [probe, setProbe] = useState('…')
  const [status, setStatus] = useState('idle')
  const [ask, setAsk] = useState<Ask>(null)
  const [value, setValue] = useState('')
  const [me, setMe] = useState('')
  const [dialogs, setDialogs] = useState<string[]>([])
  const resolver = useRef<((v: string) => void) | null>(null)

  // Auto-run the on-device crypto self-test at startup (offline proof).
  useEffect(() => {
    runSelfTest()
      .then((r) => {
        setTests(r)
        r.forEach((t) => console.log('SELFTEST', t.ok ? 'PASS' : 'FAIL', t.name, '|', t.detail))
        console.log('SELFTEST SUMMARY', r.filter((t) => t.ok).length, '/', r.length, 'passed')
      })
      .catch((e) => console.log('SELFTEST THREW', e?.message, e?.stack))

    probeTelegram()
      .then((s) => {
        setProbe(s)
        console.log('PROBE', s)
      })
      .catch((e) => {
        setProbe('FAILED: ' + (e?.message ?? e))
        console.log('PROBE FAILED', e?.message, e?.stack)
      })
  }, [])

  const prompt = (kind: Ask) => (): Promise<string> => {
    setAsk(kind)
    setValue('')
    return new Promise((res) => {
      resolver.current = (v) => {
        setAsk(null)
        res(v)
      }
    })
  }
  const submit = () => resolver.current?.(value)

  async function run() {
    const apiId = Number(process.env.EXPO_PUBLIC_API_ID)
    const apiHash = process.env.EXPO_PUBLIC_API_HASH ?? ''
    const tg = createClient(apiId, apiHash)
    try {
      setStatus('connecting…')
      const user = await tg.start({
        phone: prompt('phone'),
        code: prompt('code'),
        password: prompt('password'),
      })
      setMe(user.displayName ?? String(user.id))
      setStatus('fetching dialogs…')
      const titles: string[] = []
      for await (const d of tg.iterDialogs({ limit: 20 })) {
        titles.push(d.chat.displayName ?? '(no title)')
      }
      setDialogs(titles)
      setStatus('✅ done')
    } catch (e: any) {
      setStatus('❌ ' + (e?.message ?? String(e)))
    }
  }

  const passed = tests.filter((t) => t.ok).length
  const probeOk = probe.startsWith('handshake')
  const probePending = probe === '…'
  const busy = status.endsWith('…')

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={[s.largeTitle, { color: theme.label }]}>mtcute-rn</Text>

        {/* --- crypto self-test --- */}
        <Section theme={theme} title={`Crypto self-test${tests.length ? `  ${passed}/${tests.length}` : ''}`}>
          {tests.length === 0
            ? [
                <View style={s.row} key="loading">
                  <ActivityIndicator color={theme.label2} />
                  <Text style={[s.rowText, { color: theme.label2 }]}>running…</Text>
                </View>,
              ]
            : tests.map((t) => (
                <View style={s.row} key={t.name}>
                  <Dot color={t.ok ? theme.green : theme.red} />
                  <Text style={[s.rowText, { color: theme.label }]} numberOfLines={t.ok ? 1 : 3}>
                    {t.name}
                    {t.ok ? '' : `  → ${t.detail}`}
                  </Text>
                </View>
              ))}
        </Section>

        {/* --- transport probe (auto, no login) --- */}
        <Section theme={theme} title="Transport probe">
          {[
            <View style={s.row} key="probe">
              {probePending ? (
                <ActivityIndicator color={theme.label2} />
              ) : (
                <Dot color={probeOk ? theme.green : theme.red} />
              )}
              <Text style={[s.rowText, { color: probePending ? theme.label2 : theme.label }]} numberOfLines={3}>
                {probe}
              </Text>
            </View>,
          ]}
        </Section>

        {/* --- live Telegram login --- */}
        <Section theme={theme} title="Live connect">
          {[
            <View style={s.row} key="status">
              <Text style={[s.rowText, { color: theme.label }]}>Status</Text>
              <Text style={[s.rowValue, { color: theme.label2 }]}>{status}</Text>
            </View>,
            me ? (
              <View style={s.row} key="me">
                <Text style={[s.rowText, { color: theme.label }]}>Logged in</Text>
                <Text style={[s.rowValue, { color: theme.label2 }]} numberOfLines={1}>
                  {me}
                </Text>
              </View>
            ) : null,
            status === 'idle' ? (
              <Pressable
                key="connect"
                onPress={run}
                style={({ pressed }) => [s.row, s.center, pressed && { opacity: 0.4 }]}
              >
                <Text style={[s.rowText, s.action, { color: theme.tint }]}>Connect to Telegram</Text>
              </Pressable>
            ) : null,
            busy && !ask ? (
              <View style={[s.row, s.center]} key="spin">
                <ActivityIndicator color={theme.tint} />
              </View>
            ) : null,
          ]}
        </Section>

        {/* --- credential prompt --- */}
        {ask ? (
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
                  style={[s.input, { color: theme.label }]}
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
        ) : null}

        {/* --- dialogs --- */}
        {dialogs.length ? (
          <Section theme={theme} title={`Chats  ${dialogs.length}`}>
            {dialogs.map((title, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: dialog list is display-only, order stable
              <View style={s.chatRow} key={i}>
                <View style={[s.avatar, { backgroundColor: theme.avatar }]}>
                  <Text style={s.avatarText}>{(title.trim()[0] ?? '?').toUpperCase()}</Text>
                </View>
                <Text style={[s.rowText, { color: theme.label }]} numberOfLines={1}>
                  {title}
                </Text>
              </View>
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: -0.4, marginBottom: 18, marginTop: 4 },
  sectionHeader: { fontSize: 13, fontWeight: '400', marginLeft: 16, marginBottom: 7, letterSpacing: 0.3 },
  card: { borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 44, paddingVertical: 11 },
  center: { justifyContent: 'center' },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 56, paddingVertical: 8 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  rowText: { flex: 1, fontSize: 17 },
  rowValue: { fontSize: 17, flexShrink: 1, textAlign: 'right' },
  action: { flex: 0, fontWeight: '400' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  input: { flex: 1, fontSize: 17, paddingVertical: 0 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '600' },
})
