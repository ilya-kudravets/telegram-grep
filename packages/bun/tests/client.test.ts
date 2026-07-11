import { expect, test } from 'bun:test'
import { formatSyncLine } from '@tg/bun'
import type { SyncProgress } from '@tg/core/sync'

test('formats a normal progress line with the bar filled proportionally', () => {
  const p: SyncProgress = {
    chatTitle: 'Alice',
    chatsDone: 5,
    chatsTotal: 10,
    messages: 42,
    errors: [],
  }
  const line = formatSyncLine(p)
  expect(line).toContain('5/10')
  expect(line).toContain('Alice')
  expect(line).toContain('42')
})

test('formats a flood-wait line instead when floodWait is set', () => {
  const p: SyncProgress = {
    chatTitle: 'Bob',
    chatsDone: 1,
    chatsTotal: 3,
    messages: 0,
    errors: [],
    floodWait: 30,
  }
  const line = formatSyncLine(p)
  expect(line).toContain('FLOOD_WAIT 30s')
  expect(line).toContain('Bob')
  expect(line).not.toContain('msgs') // that word only appears in the non-flood template
})
