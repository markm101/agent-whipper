// Films each demo on the page with the system Firefox, as a contact sheet per
// demo, and prints the page's console warnings (the kit reports loop seams
// there in dev). Usage:
//   node film.mjs <url> [--only 0,2] [--every 700] [--count 20] [--width 1200] [--out shots]
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const url = args[0]
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`)
	return i === -1 ? fallback : args[i + 1]
}
const every = Number(opt('every', 700))
const count = Number(opt('count', 20))
const width = Number(opt('width', 1200))
const out = opt('out', 'shots')
const only = opt('only', null)?.split(',').map(Number)

const browser = await puppeteer.launch({
	browser: 'firefox',
	executablePath: process.env.FIREFOX_PATH ?? '/usr/bin/firefox',
	headless: true,
})
const page = await browser.newPage()
await page.setViewport({ width, height: 900, deviceScaleFactor: 1 })
const notes = []
page.on('console', (m) => {
	if (['warn', 'error'].includes(m.type()) || m.text().includes('[stageshow]')) notes.push(`${m.type()}: ${m.text()}`)
})
page.on('pageerror', (e) => notes.push(`pageerror: ${e.message}`))
await page.goto(url, { waitUntil: 'load' })

const demos = await page.$$('.pg-demo')
console.log(`${demos.length} demos on the page`)
mkdirSync(out, { recursive: true })
for (const [i, demo] of demos.entries()) {
	if (only && !only.includes(i)) continue
	const dir = join(out, `demo-${i}`)
	rmSync(dir, { recursive: true, force: true })
	mkdirSync(dir, { recursive: true })
	await demo.evaluate((el) => el.scrollIntoView({ block: 'center' }))
	const started = Date.now()
	for (let n = 0; n < count; n++) {
		const due = started + n * every
		await new Promise((r) => setTimeout(r, Math.max(0, due - Date.now())))
		await demo.screenshot({ path: join(dir, `${String(n).padStart(2, '0')}.png`) })
	}
	const sheet = join(out, `demo-${i}.png`)
	execFileSync('magick', ['montage', join(dir, '*.png'), '-tile', '4x', '-geometry', '+6+6', '-background', '#ddd', sheet])
	console.log(`demo ${i}: ${count} frames every ${every} ms -> ${sheet} (${((Date.now() - started) / 1000).toFixed(1)} s)`)
}
await browser.close()
console.log(notes.length ? `console:\n${[...new Set(notes)].join('\n')}` : 'console: no warnings or errors')
