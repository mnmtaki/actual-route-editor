type View = { x: number; y: number; width: number; height: number }

export interface RasterZoomSnapshot {
  url: string
  bounds: View
  baseView: View
}

const SNAPSHOT_BLEED = .2
const MAX_SNAPSHOT_DIMENSION = 2200
const MAX_SNAPSHOT_PIXEL_RATIO = 1.25

function collectDocumentCss() {
  if (typeof document === 'undefined') return ''
  const chunks: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      chunks.push(Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n'))
    } catch {
      // Cross-origin stylesheets are not readable. The app stylesheet is still copied.
    }
  }
  return chunks.join('\n')
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to rasterize SVG snapshot'))
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
}

export async function createRasterZoomSnapshot(svg: SVGSVGElement, baseView: View): Promise<RasterZoomSnapshot | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof XMLSerializer === 'undefined') return null
  if (typeof URL?.createObjectURL !== 'function' || typeof URL?.revokeObjectURL !== 'function') return null

  const rect = svg.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return null

  const bounds = {
    x: baseView.x - baseView.width * SNAPSHOT_BLEED,
    y: baseView.y - baseView.height * SNAPSHOT_BLEED,
    width: baseView.width * (1 + SNAPSHOT_BLEED * 2),
    height: baseView.height * (1 + SNAPSHOT_BLEED * 2),
  }

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.querySelector('[data-layer="zoom-raster-snapshot"]')?.remove()
  const cameraViewport = clone.querySelector('[data-layer="camera-viewport"]')
  cameraViewport?.removeAttribute('transform')
  cameraViewport?.removeAttribute('display')
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`)

  const pixelRatio = Math.min(MAX_SNAPSHOT_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1))
  const desiredWidth = Math.max(1, Math.round(rect.width * (1 + SNAPSHOT_BLEED * 2) * pixelRatio))
  const desiredHeight = Math.max(1, Math.round(rect.height * (1 + SNAPSHOT_BLEED * 2) * pixelRatio))
  const dimensionScale = Math.min(1, MAX_SNAPSHOT_DIMENSION / Math.max(desiredWidth, desiredHeight))
  const pixelWidth = Math.max(1, Math.round(desiredWidth * dimensionScale))
  const pixelHeight = Math.max(1, Math.round(desiredHeight * dimensionScale))
  clone.setAttribute('width', String(pixelWidth))
  clone.setAttribute('height', String(pixelHeight))

  const css = collectDocumentCss()
  if (css) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = css
    clone.insertBefore(style, clone.firstChild)
  }

  const source = new XMLSerializer().serializeToString(clone)
  const sourceUrl = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await loadImage(sourceUrl)
    const canvas = document.createElement('canvas')
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight)
    const png = await canvasToBlob(canvas)
    if (!png) return null
    return { url: URL.createObjectURL(png), bounds, baseView: { ...baseView } }
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}
