import { Capacitor, registerPlugin } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

interface DocumentPickerPlugin {
  openDocument(options: { mimeTypes: string[] }): Promise<{ name: string; mimeType: string; dataBase64: string }>
  createDocument(options: { filename: string; mimeType: string; dataBase64: string }): Promise<{ uri: string; name: string }>
}

const DocumentPicker = registerPlugin<DocumentPickerPlugin>('DocumentPicker')
export const isAndroidApp = () => Capacitor.getPlatform() === 'android'

export interface OpenedFile { name: string; type: string; text?: string; dataUrl?: string }

function decodeUtf8(base64: string) {
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

function textToBase64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

async function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('无法读取导出内容'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(blob)
  })
}

export async function openTextDocument(): Promise<OpenedFile> {
  const file = await DocumentPicker.openDocument({ mimeTypes: ['application/json', 'text/json', 'text/plain', 'application/octet-stream'] })
  return { name: file.name, type: file.mimeType, text: decodeUtf8(file.dataBase64) }
}

export async function openImageDocument(): Promise<OpenedFile> {
  const file = await DocumentPicker.openDocument({ mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] })
  return { name: file.name, type: file.mimeType, dataUrl: `data:${file.mimeType || 'application/octet-stream'};base64,${file.dataBase64}` }
}

function browserDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function saveBlob(filename: string, blob: Blob) {
  if (!isAndroidApp()) { browserDownload(filename, blob); return }
  await DocumentPicker.createDocument({ filename, mimeType: blob.type || 'application/octet-stream', dataBase64: await blobToBase64(blob) })
}

export function saveText(filename: string, text: string, mimeType: string) {
  return saveBlob(filename, new Blob([text], { type: mimeType }))
}

export async function shareBlob(filename: string, blob: Blob, title = '实际走向绘制器') {
  if (!isAndroidApp() && navigator.share && navigator.canShare?.({ files: [new File([blob], filename, { type: blob.type })] })) {
    await navigator.share({ title, files: [new File([blob], filename, { type: blob.type })] }); return
  }
  if (!isAndroidApp()) { browserDownload(filename, blob); return }
  const result = await Filesystem.writeFile({ path: `shares/${Date.now()}-${filename}`, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true })
  await Share.share({ title, files: [result.uri], dialogTitle: '分享文件' })
}

export function shareText(filename: string, text: string, mimeType: string) {
  return shareBlob(filename, new Blob([text], { type: mimeType }))
}

export const __fileIOTest = { decodeUtf8, textToBase64 }
