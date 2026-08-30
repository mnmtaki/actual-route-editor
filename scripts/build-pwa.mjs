import { build } from 'vite'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(root, 'dist-pwa')
rmSync(outDir, { recursive: true, force: true })
await build({ root, base: './', build: { outDir: 'dist-pwa' } })


const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#15191a"/><path d="M112 376 210 126h58l98 250h-62l-20-56H194l-20 56zm103-112h49l-25-72z" fill="#e7b94a"/><path d="M318 132h55c42 0 67 25 67 62 0 25-12 44-34 54l42 128h-61l-35-113h-34zm0 50v34h48c11 0 17-6 17-17 0-12-6-17-17-17z" fill="#f4f1e9"/></svg>`
writeFileSync(join(outDir, 'icon.svg'), icon)
writeFileSync(join(outDir, 'manifest.webmanifest'), JSON.stringify({ name: '实际走向绘制器', short_name: '实际走向', description: '架空城市轨道交通实际走向绘制器', start_url: './', scope: './', display: 'standalone', orientation: 'any', background_color: '#101314', theme_color: '#15191a', icons: [{ src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] }, null, 2))

function files(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]) }
const assets = files(outDir).map(path => './' + relative(outDir, path).replaceAll('\\', '/')).filter(path => path !== './service-worker.js')
writeFileSync(join(outDir, 'service-worker.js'), `const CACHE='actual-route-${Date.now()}';const ASSETS=${JSON.stringify(assets)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return response}).catch(()=>caches.match('./index.html'))))});`)
const indexPath = join(outDir, 'index.html')
let html = readFileSync(indexPath, 'utf8').replace('</head>', '<link rel="manifest" href="./manifest.webmanifest"><meta name="theme-color" content="#15191a"></head>')
html = html.replace('</body>', `<script>if(location.protocol==='https:'&&'serviceWorker'in navigator){addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js'))}</script></body>`)
writeFileSync(indexPath, html)
console.log(`PWA: ${outDir}`)
