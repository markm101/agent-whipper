import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dist = new URL('./dist/', import.meta.url).pathname
const assets = join(dist, 'assets')
let html = readFileSync(join(dist, 'index.html'), 'utf8')
for (const file of readdirSync(assets)) {
  const body = readFileSync(join(assets, file), 'utf8')
  if (file.endsWith('.js')) {
    html = html.replace(new RegExp(`<script type="module" crossorigin src="/assets/${file}"></script>`), () => `<script type="module">${body.replace(/<\/script/g, '<\\/script')}</script>`)
  } else if (file.endsWith('.css')) {
    html = html.replace(new RegExp(`<link rel="stylesheet" crossorigin href="/assets/${file}">`), () => `<style>${body}</style>`)
  }
}
if (/\/assets\//.test(html)) throw new Error('An asset was not inlined: ' + html.match(/[^"]*\/assets\/[^"]*/)[0])
const out = new URL('../overview.html', import.meta.url).pathname
writeFileSync(out, html)
console.log(`wrote ${out} (${Math.round(html.length / 1024)} KB)`)
