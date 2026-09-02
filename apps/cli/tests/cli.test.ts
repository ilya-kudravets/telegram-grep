import { afterEach, expect, test } from 'bun:test'
import { runCli } from '../src/cli'

// capture the single JSON line runCli writes to stdout
function capture(): { line: () => unknown; restore: () => void } {
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ''
  process.stdout.write = ((chunk: string) => {
    buf += chunk
    return true
  }) as typeof process.stdout.write
  return { line: () => JSON.parse(buf), restore: () => (process.stdout.write = orig) }
}

let cap: ReturnType<typeof capture>
afterEach(() => cap?.restore())

async function run(argv: string[]) {
  cap = capture()
  const code = await runCli(argv)
  return { code, out: cap.line() as Record<string, unknown> }
}

// the flags land in process.env, so a test that sets them must put it back — and must
// await the body, or the restore runs before the assertions do
async function withEnv(fn: () => Promise<void>): Promise<void> {
  const { API_ID, API_HASH } = process.env
  try {
    await fn()
  } finally {
    if (API_ID === undefined) delete process.env.API_ID
    else process.env.API_ID = API_ID
    if (API_HASH === undefined) delete process.env.API_HASH
    else process.env.API_HASH = API_HASH
  }
}

test('credential flags are consumed before the command and reach the client', async () => {
  await withEnv(async () => {
    const { code, out } = await run(['--api-id', '4242', '--api-hash', 'abc123', 'help'])
    expect(code).toBe(0)
    expect(out.usage).toBeDefined() // flags stripped — 'help' still dispatched
    expect(process.env.API_ID).toBe('4242')
    expect(process.env.API_HASH).toBe('abc123')
  })
})

test('a credential flag with no value errors instead of eating the command', async () => {
  const { code, out } = await run(['stats', '--api-hash'])
  expect(code).toBe(1)
  expect(out.error).toContain('--api-hash')
})

test('help lists the commands', async () => {
  const { code, out } = await run(['help'])
  expect(code).toBe(0)
  expect(Object.keys(out.commands as object)).toEqual([
    'search',
    'stats',
    'sync',
    'delete',
    'version',
  ])
})

test('version reports the package version', async () => {
  const { code, out } = await run(['--version'])
  expect(code).toBe(0)
  expect(out.version).toMatch(/^\d+\.\d+\.\d+$/)
})

test('unknown command errors with usage', async () => {
  const { code, out } = await run(['frobnicate'])
  expect(code).toBe(1)
  expect(out.error).toContain('frobnicate')
  expect(out.usage).toBeDefined()
})

test('search rejects an empty/invalid pattern before touching the cache', async () => {
  const { code, out } = await run(['search', '/(/'])
  expect(code).toBe(1)
  expect(out.error).toContain('pattern')
})

test('search rejects a non-positive --limit', async () => {
  const { code, out } = await run(['search', 'foo', '--limit', '0'])
  expect(code).toBe(1)
  expect(out.error).toContain('--limit')
})

test('delete rejects a malformed target', async () => {
  const { code, out } = await run(['delete', 'notacolon'])
  expect(code).toBe(1)
  expect(out.error).toContain('notacolon')
})

test('delete with no targets reports usage', async () => {
  const { code, out } = await run(['delete'])
  expect(code).toBe(1)
  expect(out.error).toContain('no targets')
})
