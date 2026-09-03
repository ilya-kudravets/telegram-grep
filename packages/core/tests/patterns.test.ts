import { expect, test } from 'bun:test'
import { en } from '../src/locales/en'
import { DEFAULT_PATTERNS } from '../src/patterns'
import { compilePattern } from '../src/search'

test('every template compiles through the app’s own pattern parser', () => {
  for (const { pattern } of DEFAULT_PATTERNS) {
    expect(compilePattern(pattern), pattern).not.toBeNull()
  }
})

test('every label is a real translation key', () => {
  for (const { label } of DEFAULT_PATTERNS) expect(en[label]).toBeString()
})

// A template that matches nothing it is named after is worse than no template: the user
// concludes their history is clean.
test.each([
  ['tplPasswords', 'мой пароль qwerty123'],
  ['tplCodes', 'код 483920 никому не говори'],
  ['tplTokens', 'API_KEY="abc123"'],
  ['tplCards', 'карта 4111 1111 1111 1111'],
  ['tplEmails', 'напиши на ilya@example.com'],
  ['tplPhones', 'звони +7 916 123-45-67'],
  ['tplCrypto', 'кошелёк 0x52908400098527886E0F7030069857D2E4169EE7'],
  ['tplDocs', 'паспорт 45 12 345678'],
  ['tplAddress', 'адрес: Тверская 1'],
])('%s matches what it promises', (label, text) => {
  const tpl = DEFAULT_PATTERNS.find((p) => p.label === label)!
  expect(compilePattern(tpl.pattern)!.test(text)).toBe(true)
})

test('templates do not fire on ordinary chatter', () => {
  const innocent = 'привет, давай встретимся в пятницу у метро'
  const hits = DEFAULT_PATTERNS.filter((p) => compilePattern(p.pattern)!.test(innocent))
  expect(hits.map((h) => h.label)).toEqual([])
})
