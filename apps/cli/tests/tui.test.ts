import { expect, test } from 'bun:test'
import { plain } from '../src/tui'

// A peer name is chosen by whoever messages you. Left raw it reaches the terminal, where
// it can repaint the status line the delete confirmation lives on.
test('plain strips the control characters \\s misses', () => {
  expect(plain('\x1b[2A\x1b[Kdeleted 0\x07')).toBe(' [2A [Kdeleted 0 ')
  expect(plain('\x1b]52;c;cGF5bG9hZA==\x07x')).toBe(' ]52;c;cGF5bG9hZA== x')
  expect(plain('a\x00\x7f\x9bb')).toBe('a b')
  expect(plain('one\n\ttwo   three')).toBe('one two three')
})

test('plain keeps ordinary text, punctuation and non-Latin alike', () => {
  expect(plain('Иван Петров · réservé 中文 · ok!')).toBe('Иван Петров · réservé 中文 · ok!')
})
