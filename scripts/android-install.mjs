import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const apk = join(root, 'release', 'actual-route-editor-debug.apk')
if (!existsSync(apk)) { console.error('尚未生成 APK，请先运行 npm run android:apk'); process.exit(1) }
const localProperties = join(root, 'android', 'local.properties')
const localSdk = existsSync(localProperties)
  ? readFileSync(localProperties, 'utf8').match(/^sdk\.dir\s*=\s*(.+)$/m)?.[1]?.trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\')
  : undefined
const defaultWindowsSdk = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : undefined
const sdkRoot = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, localSdk, defaultWindowsSdk]
  .find(candidate => candidate && existsSync(candidate))
const sdkAdb = sdkRoot ? join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : undefined
const adb = sdkAdb && existsSync(sdkAdb) ? sdkAdb : 'adb'
const result = spawnSync(adb, ['install', '-r', apk], { cwd: root, stdio: 'inherit' })
if (result.error) { console.error(`无法运行 adb：${result.error.message}`); process.exit(1) }
process.exit(result.status ?? 1)
