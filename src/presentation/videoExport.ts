import { waitForDocumentFonts } from '../import-export/rasterExport'

export interface VideoFormat { label: string; mimeType: string; extension: 'mp4' | 'webm' }
export function getSupportedVideoFormats(): VideoFormat[] {
  if (typeof MediaRecorder === 'undefined') return []
  const candidates: VideoFormat[] = [
    { label: 'MP4 (H.264)', mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
    { label: 'WebM (VP9)', mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { label: 'WebM (VP8)', mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { label: 'WebM', mimeType: 'video/webm', extension: 'webm' },
  ]
  return candidates.filter((candidate, index) => MediaRecorder.isTypeSupported(candidate.mimeType) && candidates.findIndex(item => item.extension === candidate.extension && MediaRecorder.isTypeSupported(item.mimeType)) === index)
}
export async function exportPresentationVideo(options: { width: number; height: number; fps: 30 | 60; duration: number; format: VideoFormat; renderFrame: (time: number) => Promise<SVGSVGElement>; onProgress?: (value: number) => void }) {
  await waitForDocumentFonts()
  const canvas = document.createElement('canvas'); canvas.width = options.width; canvas.height = options.height
  const context = canvas.getContext('2d', { alpha: false }); if (!context) throw new Error('浏览器无法创建视频画布')
  const manualStream = canvas.captureStream(0); const manualTrack = manualStream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }
  const manualFrames = typeof manualTrack?.requestFrame === 'function'; const stream = manualFrames ? manualStream : canvas.captureStream(options.fps)
  if (!manualFrames) manualStream.getTracks().forEach(track => track.stop())
  const recorder = new MediaRecorder(stream, { mimeType: options.format.mimeType, videoBitsPerSecond: options.width * options.height >= 2_000_000 ? 12_000_000 : 7_000_000 })
  const chunks: Blob[] = []; recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
  const stopped = new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error('视频编码失败')) })
  recorder.start(1000)
  const frameCount = Math.max(1, Math.ceil(options.duration * options.fps))
  const recordingStart = performance.now()
  try {
    for (let frame = 0; frame <= frameCount; frame++) {
      const time = Math.min(options.duration, frame / options.fps)
      const svg = await options.renderFrame(time)
      await drawSvg(context, svg, options.width, options.height)
      if (manualFrames) manualTrack.requestFrame?.()
      options.onProgress?.(frame / frameCount)
      const deadline = recordingStart + (frame + 1) * 1000 / options.fps
      await wait(Math.max(0, deadline - performance.now()))
    }
  } finally { if (recorder.state !== 'inactive') recorder.stop() }
  await stopped; stream.getTracks().forEach(track => track.stop())
  return new Blob(chunks, { type: options.format.mimeType })
}
async function drawSvg(context: CanvasRenderingContext2D, svg: SVGSVGElement, width: number, height: number) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = '.presentation-station-label,.presentation-legend-label{paint-order:stroke;stroke:#f3f0e9;stroke-width:3px;stroke-linejoin:round}.presentation-legend-label{font-family:system-ui,sans-serif;fill:#182020;font-size:14px;stroke-width:2px}.presentation-title{font:700 28px system-ui,sans-serif;fill:#182020;paint-order:stroke;stroke:#f3f0e9;stroke-width:4px}'
  clone.prepend(style)
  const markup = new XMLSerializer().serializeToString(clone); const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
  try { const image = await loadImage(url); context.clearRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height) } finally { URL.revokeObjectURL(url) }
}
function loadImage(url: string) { return new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('视频帧光栅化失败')); image.src = url }) }
function wait(milliseconds: number) { return new Promise(resolve => setTimeout(resolve, milliseconds)) }
export function downloadVideo(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
