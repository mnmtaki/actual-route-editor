import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const file = resolve(process.argv[2] ?? 'dist/index.html')
const html = await readFile(file, 'utf8')
const messages = []
const virtualConsole = new VirtualConsole()
virtualConsole.on('error', (...args) => messages.push(args.map(String).join(' ')))
virtualConsole.on('jsdomError', (error) => messages.push(error.stack ?? error.message))

const dom = new JSDOM(html, {
  url: `file:///${file.replaceAll('\\', '/')}`,
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    if (!window.structuredClone) window.structuredClone = globalThis.structuredClone
  },
})

await new Promise((resolveWait) => setTimeout(resolveWait, 800))
const document = dom.window.document
const startupFallbackPresent = html.includes('正在加载实际走向绘制器……')
const result = {
  title: document.title,
  rootText: document.getElementById('root')?.textContent?.trim().slice(0, 200) ?? null,
  toolbar: document.querySelectorAll('.toolbar').length,
  leftPanel: document.querySelectorAll('.left-panel').length,
  canvas: document.querySelectorAll('#network-canvas').length,
  rightPanel: document.querySelectorAll('.right-panel').length,
  timeline: document.querySelectorAll('.timeline').length,
  startupFallbackPresent,
  fatalOverlayWorks: false,
  errors: messages,
}
dom.window.__actualRouteShowFatal?.(new Error('offline diagnostic probe'))
result.fatalOverlayWorks = document.getElementById('fatal-startup')?.classList.contains('visible') === true
  && document.getElementById('fatal-startup')?.textContent?.includes('offline diagnostic probe') === true
console.log(JSON.stringify(result, null, 2))
dom.window.close()
if (!result.toolbar || !result.canvas || !result.timeline || !result.startupFallbackPresent || !result.fatalOverlayWorks || result.errors.length) process.exitCode = 1
