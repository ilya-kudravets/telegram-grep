// Entry for the server-less build (GitHub Pages). Everything the self-hosted app gets
// from its server, this gets from the browser: the user's own api_id/api_hash, a session
// encrypted under their passphrase, and @tg/core running against the in-memory cache.
//
// The gate below is the only UI this file owns — once unlocked it hands the shared
// <App/> the same DataLayer the server entry hands it.
import { makeT, normalizeLang } from '@tg/core/i18n'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { type BrowserClient, createBrowserClient } from './core-client'
import { openSession, sealSession } from './crypto'
import {
  type AppCreds,
  clearCreds,
  clearSealedSession,
  loadCreds,
  loadSealedSession,
  saveCreds,
  saveSealedSession,
} from './store'

const MIN_PASSPHRASE = 8
const t = makeT(normalizeLang(navigator.language) ?? 'en')

type Phase = 'boot' | 'creds' | 'unlock' | 'login' | 'seal' | 'ready'

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
  const client = useRef<BrowserClient | null>(null)
  const sessionToSeal = useRef('')

  // First load decides the phase: no credentials → ask for them; a sealed session →
  // unlock; otherwise a fresh login. The cache is restored either way.
  useEffect(() => {
    ;(async () => {
      const creds = await loadCreds()
      if (!creds) return setPhase('creds')
      client.current = await createBrowserClient(creds)
      setPhase((await loadSealedSession()) ? 'unlock' : 'login')
    })().catch((e) => setError(String(e)))
  }, [])

  // wraps a submit handler: one in-flight action, failures shown instead of thrown
  const guard = (fn: () => Promise<void>) => async (e: React.SyntheticEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const field = (form: HTMLFormElement, name: string) =>
    (form.elements.namedItem(name) as HTMLInputElement).value.trim()

  const saveAndBoot = (form: HTMLFormElement) =>
    guard(async () => {
      const creds: AppCreds = {
        apiId: Number(field(form, 'apiId')),
        apiHash: field(form, 'apiHash'),
      }
      if (!creds.apiId || !creds.apiHash) throw new Error(t('credsTitle'))
      await saveCreds(creds)
      client.current = await createBrowserClient(creds)
      setPhase('login')
    })

  // Runs the whole interactive login: mtcute calls back for phone/code/password, each
  // callback parks on a promise the form below resolves.
  const startLogin = guard(async () => {
    const prompt = (label: string, secret = false) =>
      new Promise<string>((resolve) => setAsk({ label, secret, resolve }))
    try {
      const { user, session } = await client.current!.login({
        phone: () => prompt(t('askPhone')),
        code: () => prompt(t('askCode')),
        password: () => prompt(t('askPassword'), true),
      })
      sessionToSeal.current = session
      setConnected(user)
      setPhase('seal')
    } finally {
      setAsk(null) // a failed login must not leave a dead prompt on screen
    }
  })

  const unlock = (form: HTMLFormElement) =>
    guard(async () => {
      const sealed = await loadSealedSession()
      if (!sealed) return setPhase('login')
      const session = await openSession(sealed, field(form, 'passphrase'))
      if (session === null) throw new Error(t('wrongPassphrase'))
      // A session that no longer authorizes is not a dead end: the restored cache is
      // still searchable, so the UI opens with an offline notice and a login button.
      const user = (await client.current!.resume(session)) ?? ''
      setConnected(user)
      setPhase('ready')
      if (user) client.current!.sync() // syncing while unauthorized would only report its failure
    })

  const seal = (form: HTMLFormElement) =>
    guard(async () => {
      const passphrase = field(form, 'passphrase')
      if (passphrase.length < MIN_PASSPHRASE) {
        throw new Error(t('passphraseTooShort', MIN_PASSPHRASE))
      }
      await saveSealedSession(await sealSession(sessionToSeal.current, passphrase))
      sessionToSeal.current = ''
      setPhase('ready')
      client.current!.sync()
    })

  // Reload rather than unwind: the mtcute client and the derived key live in this page,
  // and a fresh page is the honest way to drop both.
  const discard = guard(async () => {
    await clearSealedSession()
    location.reload()
  })
  const forget = guard(async () => {
    await Promise.all([clearSealedSession(), clearCreds()])
    location.reload()
  })

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
          <button type="button" onClick={discard} disabled={busy}>
            {t('discardSession')}
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
        <form onSubmit={(e) => saveAndBoot(e.currentTarget)(e)}>
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
          <button type="button" className="danger" onClick={discard} disabled={busy}>
            {t('discardSession')}
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

      {error && <p className="err">{error}</p>}
      {phase !== 'boot' && phase !== 'creds' && (
        <button type="button" className="link" onClick={forget} disabled={busy}>
          {t('forgetCreds')}
        </button>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Gate />)
