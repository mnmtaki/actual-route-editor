import { build } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

const result = await build({
  entryPoints: [resolve(root, 'src/main.tsx')],
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  jsxImportSource: 'react',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  write: false,
  outdir: dist,
  entryNames: 'app',
  assetNames: 'asset-[hash]',
  conditions: ['style', 'browser'],
  legalComments: 'none',
})

const javascript = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text
const stylesheet = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''
if (!javascript) throw new Error('未生成浏览器脚本')

const safeScript = javascript.replaceAll('</script', '<\\/script')
const safeStyle = stylesheet.replaceAll('</style', '<\\/style')
const bootStyles = `
      html,body,#root{width:100%;height:100%;margin:0}
      #boot-fallback{height:100%;display:grid;place-items:center;background:#101314;color:#d7d4cc;font:14px system-ui,sans-serif;letter-spacing:.04em}
      #fatal-startup{position:fixed;inset:0;z-index:999999;display:none;overflow:auto;padding:48px;background:#17191a;color:#f2eee6;font:14px/1.6 ui-monospace,Consolas,monospace;white-space:pre-wrap}
      #fatal-startup.visible{display:block}
    `
const bootPrelude = `
      window.__actualRouteShowFatal=function(reason){
        var panel=document.getElementById('fatal-startup');
        if(!panel)return;
        var error=reason&&reason.error?reason.error:reason;
        var detail=error&&error.stack?error.stack:error&&error.message?error.message:String(error||'未知错误');
        panel.textContent='Actual Route Editor failed to start\\n\\n应用加载失败\\n\\nError:\\n'+detail;
        panel.className='visible';
      };
      window.addEventListener('error',function(event){window.__actualRouteShowFatal(event.error||event.message)});
      window.addEventListener('unhandledrejection',function(event){window.__actualRouteShowFatal(event.reason)});
    `
const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#101314">
    <meta name="application-name" content="架空城市轨道交通实际走向绘制器">
    <title>架空城市轨道交通实际走向绘制器</title>
    <style id="app-styles">${bootStyles}${safeStyle}</style>
  </head>
  <body>
    <div id="root"><div id="boot-fallback">正在加载实际走向绘制器……</div></div>
    <div id="fatal-startup" role="alert" aria-live="assertive"></div>
    <script id="app-bundle">${bootPrelude}${safeScript}</script>
  </body>
</html>
`

if (/\b(?:src|href)=["'](?:https?:|\/\/|\/)/i.test(html)) throw new Error('单文件产物中仍存在外部或绝对资源路径')
if (/localhost|127\.0\.0\.1/i.test(html)) throw new Error('单文件产物中包含本地服务地址')
if (!html.includes('<script id="app-bundle">') || !html.includes('<style id="app-styles">')) throw new Error('单文件产物结构不符合预期')

await writeFile(resolve(dist, 'index.html'), html, 'utf8')
const bytes = (await readFile(resolve(dist, 'index.html'))).byteLength
console.log(`已生成纯本地单文件：dist/index.html (${(bytes / 1024).toFixed(1)} KiB)`)
