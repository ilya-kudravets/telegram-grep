// Serves the browser smoke page. Bun bundles the HTML import (and the TS it pulls in),
// so there is no build step — `make smoke`, then drive http://127.0.0.1:8100 with any
// browser or driver. An origin is required: IndexedDB is unavailable on file://.
import index from './index.html'

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT) || 8100,
  routes: { '/': index },
})
console.log(`smoke page: ${server.url}`)
