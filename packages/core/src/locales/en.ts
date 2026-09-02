// English translations. Values may contain {0},{1}… placeholders.
// This is the base locale — every key must exist here; other locales may omit keys (fall back here).
export const en = {
  // client / cli
  needCreds: 'Fill API_ID and API_HASH in .env (my.telegram.org → API development tools)',
  badSessionString:
    'SESSION_STRING is invalid or unusable — ignoring it, falling back to normal login',
  askPhone: 'Phone (+1…):',
  apiIdPublished:
    'Telegram is refusing this app id: it has been published publicly. Use your own api_id — the link below switches to that form.',
  codeSentApp:
    'The code was sent inside Telegram, to another device you are logged in on — not by SMS.',
  codeSentVia: 'The code was sent via {0}.',
  codeRejected: 'That code was rejected. Try again.',
  passwordRejected: 'That password was rejected. Try again.',
  askCode: 'Code from Telegram:',
  askPassword: '2FA password:',
  // index (tui bootstrap)
  loggedInUi: 'Logged in as {0}. Starting UI…',
  floodWaitStatus: 'FLOOD_WAIT: waiting {0}s…',
  patternsReloaded: 'patterns.txt reloaded',
  syncLine: 'sync {0} · {1} · {2} msgs',
  syncFloodLine: 'sync {0} · FLOOD_WAIT {1}s ({2})',
  syncDone: 'sync done: {0} chats, {1} messages cached',
  syncSkipped: ', {0} skipped ({1})',
  syncError: 'sync error: {0}',
  // server
  loggedInWeb: 'Logged in as {0}. Web UI: {1}',
  fromPhone: 'From your phone: http://<this-mac-ip>:{0}/?token={1}',
  localOnly: 'Local only (127.0.0.1). Run with LAN=1 to allow phone access.',
  portBusy: 'Port {0} busy, trying {1}…',
  allPortsBusy: 'All ports {0}–{1} are busy',
  // tui
  help: 'tab focus · space mark · d delete · ^P file patterns · esc reset · ^C quit',
  placeholder: 'regex… (plain → /i, or /pat/flags)',
  titleSearch: 'search',
  titleMessages: 'messages',
  confirmDeleteTui: 'Delete {0} message(s) everywhere? y/n',
  statusBase: '{0} matches · {1} marked',
  deleting: 'deleting {0}…',
  deleted: 'deleted {0}',
  deleteErrors: ', {0} errors: {1}',
  patternN: 'pattern {0}/{1}',
  patternsEmpty: 'patterns.txt is empty',
  // web
  appTitle: 'Search',
  confirmDeleteWeb: 'Delete {0} message(s) everywhere?',
  selectAll: 'all ({0})',
  deleteBtn: 'Delete ({0})',
  deletingBtn: 'deleting…',
  noMatches: 'no matches',
  cachedMsgs: 'cached {0} msgs',
  skippedShort: ' · {0} skipped',
  errorsShort: ' · {0} errors',
  invalidRegex: 'invalid regex',
  language: 'Language',
  systemLang: 'System',
  // static (browser-only) client
  credsTitle: 'Your Telegram application',
  credsHint: 'Create one at my.telegram.org/apps — it stays in this browser only.',
  apiIdLabel: 'api_id',
  apiHashLabel: 'api_hash',
  saveBtn: 'Save',
  unlockTitle: 'Unlock your session',
  passphraseLabel: 'Passphrase',
  unlockBtn: 'Unlock',
  wrongPassphrase: 'wrong passphrase',
  logoutBtn: 'Log out',
  eraseBtn: 'Erase all data',
  confirmErase:
    'Erase the cached messages, the stored session and the saved credentials from this browser?',
  ownCredsLink: 'use my own api_id',
  sealTitle: 'Choose a passphrase',
  sealHint:
    'It encrypts your session and your cached messages in this browser, and is never stored anywhere. There is no recovery: forget it and the only way back is erasing the data and logging in again.',
  passphraseTooShort: 'at least {0} characters',
  loginTitle: 'Log in to Telegram',
  loginStart: 'Start',
  loginBtn: 'Continue',
  loginFailed: 'login failed: {0}',
  connectedAs: 'connected as {0}',
  offlineOnly: 'not connected — searching the local cache',
  syncBtn: 'Sync',
  working: 'working…',
}

export type Dict = typeof en
export type Key = keyof Dict
