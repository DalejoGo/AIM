// Minimal static server for the E2E run: serves dist/ like Cloudflare static assets (directory index, 404 page).
// `astro preview` detaches itself when it detects an agent, which Playwright reads as a crash.
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

// Usage: node e2e/serve.mjs [port] [folder]. The folder defaults to dist/ (another build can be tested in place).
const root = process.argv[3] ? resolve(process.argv[3]) : join(import.meta.dirname, '../dist')
const port = Number(process.argv[2] ?? 4322)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
}

async function resolveFile(urlPath) {
  const path = normalize(join(root, decodeURIComponent(urlPath)))
  if (!path.startsWith(root)) return null
  const info = await stat(path).catch(() => null)
  if (info?.isFile()) return path
  if (info?.isDirectory()) {
    const index = join(path, 'index.html')
    if (await stat(index).catch(() => null)) return index
  }
  return null
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  const file = await resolveFile(pathname)
  const target = file ?? join(root, '404.html')
  res.writeHead(file ? 200 : 404, { 'content-type': types[extname(target)] ?? 'application/octet-stream' })
  createReadStream(target).pipe(res)
}).listen(port, '127.0.0.1')
