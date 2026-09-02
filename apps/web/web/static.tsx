// Entry for the server-less build (GitHub Pages). Everything the self-hosted app gets
// from its server, this gets from the browser: application credentials (the user's own,
// or the fallback pair a public build may bake in), a session and a message cache
// encrypted under the user's passphrase, and @tg/core running against the in-memory
// cache.
//
// The gate below is the only UI this file owns — once unlocked it hands the shared
// <App/> the same DataLayer the server entry hands it.
//
// The passphrase is asked for *before* the Telegram login, not after: the vault has to
// exist before the first byte of cache or session is written, and asking once up front
// is simpler than retrofitting a key onto data already in flight.
import { makeT, normalizeLang } from '@tg/core/i18n'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { bakedCreds } from './baked'
import { type BrowserClient, createBrowserClient } from './core-client'
import { createVault, unlockVault } from './crypto'
import {
  type AppCreds,
  loadCreds,
  loadSealedSession,
  saveCreds,
  saveSealedSession,
  wipeAll,
} from './store'

const MIN_PASSPHRASE = 8
const t = makeT(normalizeLang(navigator.language) ?? 'en')

type Phase = 'boot' | 'creds' | 'unlock' | 'seal' | 'login' | 'ready'

/** A pending mtcute prompt: the login flow blocks on this promise until the user answers. */
interface Ask {
  label: string
  secret: boolean
  resolve(value: string): void
}

function Gate() {
  const [phase, setPhase] = useState<Phase>('boot')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState('')
  const [ask, setAsk] = useState<Ask | null>(null)
  const [notice, setNotice] = useState('') // where the code went, or why it was rejected
  const [ownCreds, setOwnCreds] = useState(false) // user-supplied pair, not the baked one
  const creds = useRef<AppCreds | undefined>(undefined)
  const client = useRef<BrowserClient | null>(null)

  // First load decides the phase: no credentials at all → ask for them; a stored session
  // → unlock it; otherwise a fresh passphrase, then a login.
  useEffect(() => {
    ;(async () => {
      const stored = await loadCreds()
      creds.current = stored ?? bakedCreds
      setOwnCreds(stored !== undefined)
      if (!creds.current) return setPhase('creds')
      setPhase((await loadSealedSession()) ? 'unlock' : 'seal')
    })().catch((e) => setError(String(e)))
  }, [])

  // Telegram's own wording for a leaked app id is `API_ID_PUBLISHED_FLOOD`, which tells a
  // user nothing — and a baked pair is exactly the pair that can end up in that state.
  const explain = (message: string) =>
    message.includes('API_ID_PUBLISHED_FLOOD') ? t('apiIdPublished') : message

  // wraps a submit handler: one in-flight action, failures shown instead of thrown
  const guard = (fn: () => Promise<void>) => async (e: React.SyntheticEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setError(explain(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  const field = (form: HTMLFormElement, name: string) =>
    (form.elements.namedItem(name) as HTMLInputElement).value.trim()

  const passphraseOf = (form: HTMLFormElement) => {
    const passphrase = field(form, 'passphrase')
    if (passphrase.length < MIN_PASSPHRASE) {
      throw new Error(t('passphraseTooShort', MIN_PASSPHRASE))
    }
    return passphrase
  }

  const saveOwnCreds = (form: HTMLFormElement) =>
    guard(async () => {
      const pair: AppCreds = {
        apiId: Number(field(form, 'apiId')),
        apiHash: field(form, 'apiHash'),
      }
      if (!pair.apiId || !pair.apiHash) throw new Error(t('credsTitle'))
      await saveCreds(pair)
      // Reload rather than swap the pair under a live client: a running mtcute client is
      // bound to the api_id it was built with.
      location.reload()
    })

  const seal = (form: HTMLFormElement) =>
    guard(async () => {
      const vault = await createVault(passphraseOf(form))
      client.current = await createBrowserClient(creds.current!, vault)
      setPhase('login')
    })

  const unlock = (form: HTMLFormElement) =>
    guard(async () => {
      const sealed = await loadSealedSession()
      if (!sealed) return setPhase('seal')
      const vault = await unlockVault(field(form, 'passphrase'), sealed)
      if (!vault) throw new Error(t('wrongPassphrase'))
      client.current = await createBrowserClient(creds.current!, vault)
      // A session that no longer authorizes is not a dead end: the cache is decrypted and
      // searchable, so the UI opens with an offline notice and a login button.
      const user = (await client.current.resume((await vault.open(sealed))!)) ?? ''
      setConnected(user)
      setPhase('ready')
      if (user) client.current.sync() // syncing while unauthorized would only report its failure
    })

  // Runs the whole interactive login: mtcute calls back for phone/code/password, each
  // callback parks on a promise the form below resolves. The session it returns is sealed
  // with the vault the passphrase already created.
  const startLogin = guard(async () => {
    const prompt = (label: string, secret = false) =>
      new Promise<string>((resolve) => setAsk({ label, secret, resolve }))
    setNotice('')
    try {
      const { user, session } = await client.current!.login({
        phone: () => prompt(t('askPhone')),
        code: () => prompt(t('askCode')),
        password: () => prompt(t('askPassword'), true),
        codeSent: (via) => setNotice(via === 'app' ? t('codeSentApp') : t('codeSentVia', via)),
        rejected: (what) => setNotice(what === 'code' ? t('codeRejected') : t('passwordRejected')),
      })
      await saveSealedSession(await client.current!.seal(session))
      setConnected(user)
      setPhase('ready')
      client.current!.sync()
    } finally {
      setAsk(null) // a failed login must not leave a dead prompt on screen
    }
  })

  // Revokes the session on Telegram's side first: if that call fails the local data stays
  // put, so the user can retry instead of ending up logged in everywhere but here.
  const logout = guard(async () => {
    await client.current?.logout()
    await wipeAll()
    location.reload()
  })

  // The unconditional escape: no network, no key needed. Also the answer to a forgotten
  // passphrase, since nothing sealed under it can be recovered.
  const erase = guard(async () => {
    if (!confirm(t('confirmErase'))) return
    await wipeAll()
    location.reload()
  })

  const credsLink = ownCreds ? null : (
    <button type="button" className="link" onClick={() => setPhase('creds')} disabled={busy}>
      {t('ownCredsLink')}
    </button>
  )

  if (phase === 'ready' && client.current) {
    return (
      <>
        <div className="gatebar">
          <span>{connected ? t('connectedAs', connected) : t('offlineOnly')}</span>
          <button type="button" onClick={() => client.current?.sync()}>
            {t('syncBtn')}
          </button>
          {!connected && (
            <button
              type="button"
              // back to the gate first: the phone/code prompts render there, not here
              onClick={(e) => {
                setPhase('login')
                startLogin(e)
              }}
              disabled={busy}
            >
              {t('loginTitle')}
            </button>
          )}
          <button type="button" onClick={logout} disabled={busy}>
            {t('logoutBtn')}
          </button>
          <button type="button" className="danger" onClick={erase} disabled={busy}>
            {t('eraseBtn')}
          </button>
          {error && <span className="err">{error}</span>}
        </div>
        <App data={client.current.data} />
      </>
    )
  }

  return (
    <div className="gate">
      <h1>{t('appTitle')}</h1>

      {phase === 'boot' && <p>{t('working')}</p>}

      {phase === 'creds' && (
        <form onSubmit={(e) => saveOwnCreds(e.currentTarget)(e)}>
          <h2>{t('credsTitle')}</h2>
          <p>{t('credsHint')}</p>
          <input
            name="apiId"
            inputMode="numeric"
            placeholder={t('apiIdLabel')}
            required
            autoFocus
          />
          <input name="apiHash" placeholder={t('apiHashLabel')} required />
          <button type="submit" disabled={busy}>
            {t('saveBtn')}
          </button>
        </form>
      )}

      {phase === 'seal' && (
        <form onSubmit={(e) => seal(e.currentTarget)(e)}>
          <h2>{t('sealTitle')}</h2>
          <p>{t('sealHint')}</p>
          <input
            name="passphrase"
            type="password"
            placeholder={t('passphraseLabel')}
            required
            autoFocus
          />
          <button type="submit" disabled={busy}>
            {t('saveBtn')}
          </button>
        </form>
      )}

      {phase === 'unlock' && (
        <form onSubmit={(e) => unlock(e.currentTarget)(e)}>
          <h2>{t('unlockTitle')}</h2>
          <input
            name="passphrase"
            type="password"
            placeholder={t('passphraseLabel')}
            required
            autoFocus
          />
          <button type="submit" disabled={busy}>
            {t('unlockBtn')}
          </button>
        </form>
      )}

      {phase === 'login' &&
        (ask ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const value = field(e.currentTarget, 'answer')
              setAsk(null)
              ask.resolve(value)
            }}
          >
            <h2>{ask.label}</h2>
            {notice && <p>{notice}</p>}
            <input name="answer" type={ask.secret ? 'password' : 'text'} autoFocus required />
            <button type="submit">{t('loginBtn')}</button>
          </form>
        ) : (
          <form onSubmit={startLogin}>
            <h2>{t('loginTitle')}</h2>
            <button type="submit" disabled={busy}>
              {busy ? t('working') : t('loginStart')}
            </button>
          </form>
        ))}

      {error && <p className="err">{error}</p>}
      {phase !== 'boot' && phase !== 'creds' && credsLink}
      {phase !== 'boot' && (
        <button type="button" className="link danger" onClick={erase} disabled={busy}>
          {t('eraseBtn')}
        </button>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Gate />)
