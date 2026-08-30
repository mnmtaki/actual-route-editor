import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const localPropertiesPath = join(root, 'android', 'local.properties')
const readSdkFromLocalProperties = () => {
  if (!existsSync(localPropertiesPath)) return undefined
  const match = readFileSync(localPropertiesPath, 'utf8').match(/^sdk\.dir\s*=\s*(.+)$/m)
  return match?.[1]?.trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\')
}
const defaultWindowsSdk = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : undefined
const sdkRoot = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, readSdkFromLocalProperties(), defaultWindowsSdk]
  .find(candidate => candidate && existsSync(candidate))
if (!sdkRoot) {
  console.error('Android SDK 未找到：已检查 ANDROID_HOME、ANDROID_SDK_ROOT、android/local.properties 和 %LOCALAPPDATA%\\Android\\Sdk。')
  process.exit(2)
}
if (!existsSync(localPropertiesPath)) writeFileSync(localPropertiesPath, `sdk.dir=${sdkRoot.replace(/\\/g, '/')}\n`, 'utf8')
const localAndroidTools = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android') : undefined
const localJdk = localAndroidTools && existsSync(localAndroidTools)
  ? readdirSync(localAndroidTools).filter(name => /^jdk-17(?:\.|$)/.test(name)).sort().at(-1)
  : undefined
const javaHome = [
  process.env.JAVA_HOME,
  process.platform === 'win32' ? 'C:\\Program Files\\Android\\Android Studio\\jbr' : undefined,
  process.platform === 'win32' ? 'C:\\Program Files\\Java\\jdk-21' : undefined,
  localJdk ? join(localAndroidTools, localJdk) : undefined,
].find(candidate => candidate && existsSync(join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')))
const childEnv = {
  ...process.env,
  ANDROID_HOME: sdkRoot,
  ANDROID_SDK_ROOT: sdkRoot,
  ...(javaHome ? { JAVA_HOME: javaHome } : {}),
  GRADLE_OPTS: `${process.env.GRADLE_OPTS ?? ''} -Dhttp.keepAlive=false -Dhttps.protocols=TLSv1.2`.trim(),
}
const run = (command, args) => { const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: childEnv }); if (result.error) { console.error(result.error.message); process.exit(1) } if (result.status !== 0) process.exit(result.status ?? 1) }
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
run(npm, ['run', 'build'])
run(npx, ['cap', 'sync', 'android'])
console.log(`Android SDK: ${sdkRoot}`)
if (javaHome) console.log(`Android JDK: ${javaHome}`)
run(process.platform === 'win32' ? join(root, 'android', 'gradlew.bat') : join(root, 'android', 'gradlew'), ['-p', join(root, 'android'), 'assembleDebug', '--max-workers=1', '--no-parallel'])
const source = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
const target = join(root, 'release', 'actual-route-editor-debug.apk')
mkdirSync(join(root, 'release'), { recursive: true }); copyFileSync(source, target)
const gradle = readFileSync(join(root, 'android', 'app', 'build.gradle'), 'utf8')
const versionCode = gradle.match(/versionCode\s+(\d+)/)?.[1]
const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1]
const bytes = readFileSync(target), sha256 = createHash('sha256').update(bytes).digest('hex')
console.log(JSON.stringify({ apk: target, size: statSync(target).size, sha256, versionCode, versionName }, null, 2))
