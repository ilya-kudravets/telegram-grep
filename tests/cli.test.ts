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

test('help lists the commands', async () => {
  const { code, out } = await run(['help'])
  expect(code).toBe(0)
  expect(Object.keys(out.commands as object)).toEqual(['search', 'stats', 'sync', 'delete'])
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
