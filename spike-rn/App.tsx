import './src/polyfills' // MUST be first
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Button,
  FlatList,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { createClient } from './src/mtcute-rn/adapter'
import { probeTelegram, type Result, runSelfTest } from './src/mtcute-rn/verify'

type Ask = 'phone' | 'code' | 'password' | null

export default function App() {
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>mtcute-rn spike</Text>

        {/* --- crypto self-test --- */}
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>
            crypto self-test{tests.length ? `  (${passed}/${tests.length})` : '…'}
          </Text>
          {tests.length === 0 ? <ActivityIndicator /> : null}
          {tests.map((t) => (
            <View key={t.name} style={{ flexDirection: 'row', gap: 8 }}>
              <Text>{t.ok ? '✅' : '❌'}</Text>
              <Text style={{ flex: 1 }}>
                {t.name}
                {t.ok ? '' : `  → ${t.detail}`}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ height: 1, backgroundColor: '#ddd' }} />

        {/* --- transport probe (auto, no login) --- */}
        <Text style={{ fontSize: 16, fontWeight: '600' }}>transport probe</Text>
        <Text style={{ color: probe.startsWith('handshake') ? 'green' : probe === '…' ? '#666' : 'crimson' }}>
          {probe}
        </Text>

        <View style={{ height: 1, backgroundColor: '#ddd' }} />

        {/* --- live Telegram login --- */}
        <Text style={{ fontSize: 16, fontWeight: '600' }}>live connect</Text>
        <Text>status: {status}</Text>
        {me ? <Text>logged in as: {me}</Text> : null}
        {status === 'idle' ? <Button title="Connect to Telegram" onPress={run} /> : null}
        {status.endsWith('…') && !ask ? <ActivityIndicator /> : null}

        {ask ? (
          <View style={{ gap: 8 }}>
            <Text>enter {ask}:</Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              autoFocus
              secureTextEntry={ask === 'password'}
              keyboardType={ask === 'phone' || ask === 'code' ? 'phone-pad' : 'default'}
              style={{ borderWidth: 1, borderColor: '#999', padding: 10, borderRadius: 8 }}
            />
            <Button title="OK" onPress={submit} />
          </View>
        ) : null}

        <FlatList
          scrollEnabled={false}
          data={dialogs}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => <Text style={{ paddingVertical: 3 }}>• {item}</Text>}
        />
      </ScrollView>
    </SafeAreaView>
  )
}
