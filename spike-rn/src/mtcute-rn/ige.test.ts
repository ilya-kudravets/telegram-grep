import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { expect, test } from 'bun:test'
import { igeWith } from './ige'

// one 16-byte AES-256 block, fresh cipher per call (test-only; simple & correct)
const enc = (key: Uint8Array) => (b: Uint8Array) => {
  const c = createCipheriv('aes-256-ecb', key, null)
  c.setAutoPadding(false)
  return new Uint8Array(Buffer.concat([c.update(b), c.final()]))
}
const dec = (key: Uint8Array) => (b: Uint8Array) => {
  const c = createDecipheriv('aes-256-ecb', key, null)
  c.setAutoPadding(false)
  return new Uint8Array(Buffer.concat([c.update(b), c.final()]))
}

// Independent reference IGE (plain arrays, no subarray/pointer reuse) — must
// agree with igeWith(). Catches the likely transcription bug: swapped
// prevC/prevM or wrong xor order.
function igeRef(block: (b: Uint8Array) => Uint8Array, iv: Uint8Array, data: Uint8Array, decrypt: boolean) {
  const xor = (a: Uint8Array, b: Uint8Array) => a.map((v, i) => v ^ b[i])
  let prevC = iv.slice(0, 16)
  let prevM = iv.slice(16, 32)
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i += 16) {
    const blk = data.slice(i, i + 16)
    let res: Uint8Array
    if (decrypt) {
      res = xor(block(xor(blk, prevM)), prevC)
      prevM = res
      prevC = blk
    } else {
      res = xor(block(xor(blk, prevC)), prevM)
      prevC = res
      prevM = blk
    }
    out.set(res, i)
  }
  return out
}

test('igeWith matches independent reference (encrypt & decrypt)', () => {
  const key = new Uint8Array(randomBytes(32))
  const iv = new Uint8Array(randomBytes(32))
  const data = new Uint8Array(randomBytes(16 * 5)) // 5 blocks
  expect([...igeWith(enc(key), iv, data, false)]).toEqual([...igeRef(enc(key), iv, data, false)])
  expect([...igeWith(dec(key), iv, data, true)]).toEqual([...igeRef(dec(key), iv, data, true)])
})

test('encrypt then decrypt round-trips', () => {
  const key = new Uint8Array(randomBytes(32))
  const iv = new Uint8Array(randomBytes(32))
  const data = new Uint8Array(randomBytes(16 * 8))
  const ct = igeWith(enc(key), iv, data, false)
  const pt = igeWith(dec(key), iv, ct, true)
  expect([...pt]).toEqual([...data])
})
