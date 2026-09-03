import { expect, test } from 'bun:test'
import { en } from '../src/locales/en'
import { DEFAULT_PATTERNS } from '../src/patterns'
import { compilePattern } from '../src/search'

const tpl = (label: string) =>
  compilePattern(DEFAULT_PATTERNS.find((p) => p.label === label)!.pattern)!

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
  ['tplPasswords', 'пин-код от карты 1234'],
  ['tplPasswords', 'login: admin'],
  ['tplCodes', 'код 483920 никому не говори'],
  ['tplCodes', 'Login code: 12345'],
  ['tplTokens', 'API_KEY="abc123xyz"'],
  ['tplTokens', 'Authorization: Bearer 0123456789abcdef0123'],
  ['tplKeyFormats', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
  ['tplKeyFormats', 'AKIAIOSFODNN7EXAMPLE'],
  ['tplKeyFormats', 'бот: 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw5'],
  ['tplKeyFormats', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig'],
  ['tplKeyFormats', '-----BEGIN RSA PRIVATE KEY-----'],
  ['tplKeyFormats', 'postgres://app:s3cret@db.internal:5432/prod'],
  ['tplSeed', 'вот моя сид-фраза, сохрани'],
  ['tplSeed', 'private key attached'],
  ['tplCards', 'карта 4111 1111 1111 1111'],
  ['tplCards', '2200700012345678'],
  ['tplBank', 'IBAN DE89370400440532013000'],
  ['tplBank', 'р/с 40817810099910004312, БИК 044525225'],
  ['tplCrypto', 'кошелёк 0x52908400098527886E0F7030069857D2E4169EE7'],
  ['tplCrypto', 'TON: EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2'],
  ['tplCrypto', 'TRON TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'],
  ['tplDocs', 'паспорт 45 12 345678'],
  ['tplDocs', 'мой инн 771234567890'],
  ['tplDocs', 'my SSN is on the photo'],
  ['tplEmails', 'напиши на ilya@example.com'],
  ['tplPhones', 'звони +7 916 123-45-67'],
  ['tplPhones', 'номер 8 (916) 123-45-67'],
  ['tplAddress', 'адрес: Тверская 1'],
  ['tplAddress', 'живу по адресу ул. Ленина 5, кв. 12'],
  ['tplAddress', 'my address is 5 Main Street'],
  ['tplLocation', 'я тут 55.7558, 37.6173'],
  ['tplLocation', 'https://maps.app.goo.gl/abc123'],
  ['tplInvites', 'https://t.me/+AbCdEfGh123'],
  ['tplInvites', 'https://discord.gg/xyz'],
  ['tplInfra', 'ssh root@192.168.1.10'],
  ['tplInfra', 'сервер 10.0.0.5:8080'],
])('%s matches "%s"', (label, text) => {
  expect(tpl(label).test(text)).toBe(true)
})

// Smart means quiet, too: words that only look like the thing must not fire.
test.each([
  ['tplPasswords', 'пассажиры уже в автобусе'],
  ['tplCodes', 'закодировать 12345 символов'],
  ['tplTokens', 'token is a word'],
  ['tplKeyFormats', 'akiaiosfodnn7example'],
  ['tplCards', 'заказ № 1234 5678 9012 3456'],
  ['tplDocs', 'Финн приехал'],
  ['tplPhones', '8 марта 2024 в 12:30'],
  ['tplAddress', 'IP address changed'],
  ['tplAddress', 'email address is wrong'],
  ['tplAddress', 'надо адресовать вопрос'],
])('%s stays quiet on "%s"', (label, text) => {
  expect(tpl(label).test(text)).toBe(false)
})

test('templates do not fire on ordinary chatter', () => {
  for (const innocent of [
    'привет, давай встретимся в пятницу у метро',
    'созвон в 15:30, скинь ссылку на зум когда будет',
    'we shipped v1.2.3 today, see the changelog',
    'счёт 3:2, красиво сыграли',
  ]) {
    const hits = DEFAULT_PATTERNS.filter((p) => compilePattern(p.pattern)!.test(innocent))
    expect(
      hits.map((h) => h.label),
      innocent,
    ).toEqual([])
  }
})
