// Serves the built static bundle from a subpath, the way a GitHub project page does.
// Anything requested outside the prefix 404s on purpose: that is the check — an absolute
// asset path in the bundle shows up here as a miss instead of silently working.
const PREFIX = process.env.PAGES_PREFIX || '/telegram-grep/'
const ROOT = 'dist/pages'

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT) || 8101,
  async fetch(req) {
    const { pathname } = new URL(req.url)
    if (!pathname.startsWith(PREFIX)) return new Response('outside the prefix', { status: 404 })
    const rest = pathname.slice(PREFIX.length) || 'static.html'
    const file = Bun.file(`${ROOT}/${rest}`)
    return (await file.exists()) ? new Response(file) : new Response('not found', { status: 404 })
  },
})
console.log(`static bundle: ${server.url}${PREFIX.slice(1)}`)
