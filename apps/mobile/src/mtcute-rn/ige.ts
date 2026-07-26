// Pure AES-IGE composition over a single-block AES primitive. No RN/crypto-lib
// imports here on purpose, so it's unit-testable under `bun test` with any
// ECB block function (node:crypto in the test, quick-crypto in the app).
//
// aesBlock must already be the correct direction: AES-ENCRYPT one 16-byte block
// when decrypt=false, AES-DECRYPT one block when decrypt=true.
export function igeWith(
  aesBlock: (block: Uint8Array) => Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
  decrypt: boolean,
): Uint8Array {
  const out = new Uint8Array(data.length)
  let prevC = iv.subarray(0, 16) // c_{-1}
  let prevM = iv.subarray(16, 32) // m_{-1}
  const t = new Uint8Array(16)
  for (let i = 0; i < data.length; i += 16) {
    const block = data.subarray(i, i + 16)
    if (decrypt) {
      for (let j = 0; j < 16; j++) t[j] = block[j] ^ prevM[j] // c_i ⊕ m_{i-1}
      const d = aesBlock(t)
      for (let j = 0; j < 16; j++) out[i + j] = d[j] ^ prevC[j] // ⊕ c_{i-1}
      prevM = out.subarray(i, i + 16)
      prevC = block
    } else {
      for (let j = 0; j < 16; j++) t[j] = block[j] ^ prevC[j] // m_i ⊕ c_{i-1}
      const e = aesBlock(t)
      for (let j = 0; j < 16; j++) out[i + j] = e[j] ^ prevM[j] // ⊕ m_{i-1}
      prevC = out.subarray(i, i + 16)
      prevM = block
    }
  }
  return out
}
