import type { ICryptoProvider } from '@mtcute/core/utils.js'
import { createClient } from './adapter'
import { RNCryptoProvider } from './crypto'

// Autonomous checks that need no creds/SMS: crypto known-answer tests (offline)
// and a transport probe (connect + handshake + help.getConfig against a real DC).

const enc = new TextEncoder()
const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('')
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])
const beToBig = (u: Uint8Array) => u.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)

export type Result = { name: string; ok: boolean; detail: string }

export async function runSelfTest(): Promise<Result[]> {
  const c: ICryptoProvider = new RNCryptoProvider()
  await c.initialize?.()
  const out: Result[] = []
  // Each test isolated: a throw becomes a FAIL with its message, not a total abort.
  const test = async (name: string, fn: () => boolean | Promise<boolean>, detail?: () => string) => {
    try {
      const ok = await fn()
      out.push({ name, ok, detail: ok ? '' : (detail?.() ?? '') })
    } catch (e: any) {
      out.push({ name, ok: false, detail: `threw: ${e?.message ?? e}` })
    }
  }

  await test(
    'sha1("abc")',
    () => hex(c.sha1(enc.encode('abc'))) === 'a9993e364706816aba3e25717850c26c9cd0d89d',
    () => hex(c.sha1(enc.encode('abc'))),
  )
  await test(
    'sha256("abc")',
    () => hex(c.sha256(enc.encode('abc'))) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    () => hex(c.sha256(enc.encode('abc'))),
  )
  await test('hmacSha256 (RFC4231 #1)', async () => {
    const mac = hex(await c.hmacSha256(enc.encode('Hi There'), new Uint8Array(20).fill(0x0b)))
    return mac === 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
  })
  await test('pbkdf2-sha256 (c=1)', async () => {
    const dk = hex(await c.pbkdf2(enc.encode('password'), enc.encode('salt'), 1, 32, 'sha256'))
    return dk === '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b'
  })
  await test('aes-256-ige round-trip', () => {
    const key = new Uint8Array(32)
    c.randomFill(key)
    const iv = new Uint8Array(32)
    c.randomFill(iv)
    const data = new Uint8Array(48)
    c.randomFill(data)
    const ige = c.createAesIge(key, iv)
    return eq(c.createAesIge(key, iv).decrypt(ige.encrypt(data)), data)
  })
  await test('aes-256-ctr round-trip', () => {
    const key = new Uint8Array(32)
    c.randomFill(key)
    const iv = new Uint8Array(16)
    c.randomFill(iv)
    const data = new Uint8Array(37)
    c.randomFill(data)
    const ct = c.createAesCtr(key, iv, true).process(data)
    return eq(c.createAesCtr(key, iv, false).process(ct), data)
  })
  await test('factorizePQ', async () => {
    const pq = 1_000_000_007n * 1_000_000_009n
    const buf = new Uint8Array(8)
    let n = pq
    for (let i = 7; i >= 0; i--) {
      buf[i] = Number(n & 0xffn)
      n >>= 8n
    }
    const [f1, f2] = await c.factorizePQ(buf)
    return beToBig(f1) * beToBig(f2) === pq
  })

  return out
}

// Connect to a real DC, run the MTProto auth-key handshake, then a benign RPC.
// No login needed — the auth key is negotiated at the transport level. ANY
// structured reply (even an RpcError like API_ID_INVALID) proves transport +
// AES-IGE + MTProto work end-to-end; only a transport/crypto failure means the
// adapter is broken.
export async function probeTelegram(): Promise<string> {
  const apiId = Number(process.env.EXPO_PUBLIC_API_ID) || 1
  const apiHash = process.env.EXPO_PUBLIC_API_HASH || '0123456789abcdef0123456789abcdef'
  const tg = createClient(apiId, apiHash)
  try {
    const cfg: any = await tg.call({ _: 'help.getConfig' })
    return `handshake+RPC OK — thisDc=${cfg?.thisDc}, dcOptions=${cfg?.dcOptions?.length}`
  } catch (e: any) {
    const name = e?.constructor?.name ?? 'Error'
    const proven = /Rpc|API_ID|AUTH_KEY|CONNECTION_/i.test(`${name} ${e?.message}`)
    return `${proven ? 'handshake OK (encrypted reply)' : 'FAILED'}: ${name} ${e?.message ?? e}`
  } finally {
    try {
      await (tg as any).close?.()
    } catch {}
  }
}
