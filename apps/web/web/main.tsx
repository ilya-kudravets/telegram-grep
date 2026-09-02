// Entry for the self-hosted app: the shared UI wired to the server-backed data layer.
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { createServerData } from './data-server'

createRoot(document.getElementById('root')!).render(<App data={createServerData()} />)
