export type CanvasView = { x: number; y: number; width: number; height: number }

const DEFAULT_BLEED = .2
const MAX_BITMAP_DIMENSION = 2600
const MAX_PIXEL_RATIO = 1.5

export interface PreparedRasterSource {
  markup: string
}

export interface RasterizedScene {
  canvas: HTMLCanvasElement
  baseView: CanvasView
  bleed: number
}

function collectDocumentCss() {
  if (typeof document === 'undefined') return ''
  const chunks: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      chunks.push(Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n'))
    } catch {
      // Ignore cross-origin stylesheets. The editor's own styles remain available.
    }
  }
  return chunks.join('\n')
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to rasterize map scene'))
    image.src = url
  })
}

function expandedView(view: CanvasView, bleed = DEFAULT_BLEED): CanvasView {
  return {
    x: view.x - view.width * bleed,
    y: view.y - view.height * bleed,
    width: view.width * (1 + bleed * 2),
    height: view.height * (1 + bleed * 2),
  }
}

function stripEditorArtifacts(svg: SVGSVGElement) {
  svg.querySelectorAll(
    '[data-editor="true"],.segment-hit,.station-hit-target,.station-selection-ring,[data-layer="opening-phase-preview"],[data-layer$="-active-overlay"],[data-layer="vector-basemap-active-overlay"],[data-layer="background-image"],[data-layer="line-legend"],[data-layer="canvas-background"]',
  ).forEach(node => node.remove())
  svg.querySelectorAll('.segment-selected,.selected').forEach(node => node.classList.remove('segment-selected', 'selected'))
  svg.querySelector('[data-layer="camera-viewport"]')?.removeAttribute('transform')
}

/**
 * Prepare the formal map once when project/static artwork changes. View changes
 * reuse this serialized vector source, avoiding cloneNode/XML serialization on
 * every wheel commit.
 */
export function prepareRasterSource(sourceSvg: SVGSVGElement): PreparedRasterSource | null {
  if (typeof document === 'undefined' || typeof XMLSerializer === 'undefined') return null
  const clone = sourceSvg.cloneNode(true) as SVGSVGElement
  stripEditorArtifacts(clone)
  clone.removeAttribute('id')
  clone.removeAttribute('class')
  clone.removeAttribute('style')
  clone.removeAttribute('viewBox')
  clone.removeAttribute('width')
  clone.removeAttribute('height')

  const css = collectDocumentCss()
  if (css) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = css
    clone.insertBefore(style, clone.firstChild)
  }

  return { markup: clone.innerHTML }
}

function rasterBackground(bounds: CanvasView, gridVisible: boolean) {
  const base = `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#f3f0e9"/>`
  if (!gridVisible) return base
  return base + `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="url(#grid)"/>`
}

export async function rasterizePreparedMap(
  source: PreparedRasterSource,
  baseView: CanvasView,
  cssWidth: number,
  cssHeight: number,
  options?: { bleed?: number; gridVisible?: boolean },
): Promise<RasterizedScene | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof URL.revokeObjectURL !== 'function') return null
  if (!(cssWidth > 1) || !(cssHeight > 1)) return null

  const bleed = options?.bleed ?? DEFAULT_BLEED
  const bounds = expandedView(baseView, bleed)
  const ratio = Math.min(MAX_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1))
  const desiredWidth = Math.max(1, Math.round(cssWidth * (1 + bleed * 2) * ratio))
  const desiredHeight = Math.max(1, Math.round(cssHeight * (1 + bleed * 2) * ratio))
  const sizeScale = Math.min(1, MAX_BITMAP_DIMENSION / Math.max(desiredWidth, desiredHeight))
  const bitmapWidth = Math.max(1, Math.round(desiredWidth * sizeScale))
  const bitmapHeight = Math.max(1, Math.round(desiredHeight * sizeScale))

  const sourceSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" width="${bitmapWidth}" height="${bitmapHeight}">${rasterBackground(bounds, Boolean(options?.gridVisible))}${source.markup}</svg>`
  const url = URL.createObjectURL(new Blob([sourceSvg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await loadImage(url)
    const buffer = document.createElement('canvas')
    buffer.width = bitmapWidth
    buffer.height = bitmapHeight
    const context = buffer.getContext('2d')
    if (!context) return null
    context.drawImage(image, 0, 0, bitmapWidth, bitmapHeight)
    return { canvas: buffer, baseView: { ...baseView }, bleed }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Convenience path used by tests/fallback callers. */
export async function rasterizeVisibleMap(
  sourceSvg: SVGSVGElement,
  baseView: CanvasView,
  cssWidth: number,
  cssHeight: number,
  bleed = DEFAULT_BLEED,
): Promise<RasterizedScene | null> {
  const source = prepareRasterSource(sourceSvg)
  return source ? rasterizePreparedMap(source, baseView, cssWidth, cssHeight, { bleed }) : null
}

export function commitRasterizedScene(target: HTMLCanvasElement, scene: RasterizedScene) {
  target.width = scene.canvas.width
  target.height = scene.canvas.height
  const context = target.getContext('2d')
  if (!context) return false
  context.clearRect(0, 0, target.width, target.height)
  context.drawImage(scene.canvas, 0, 0)
  return true
}

function screenMapping(view: CanvasView, width: number, height: number) {
  const scale = Math.min(width / view.width, height / view.height)
  const offsetX = (width - view.width * scale) / 2
  const offsetY = (height - view.height * scale) / 2
  return {
    scale,
    constantX: offsetX - view.x * scale,
    constantY: offsetY - view.y * scale,
  }
}

/**
 * CSS transform that maps pixels from a retained bitmap rendered at baseView
 * into the screen positions for liveView. This mirrors SVG xMidYMid meet.
 */
export function canvasCameraTransform(baseView: CanvasView, liveView: CanvasView, width: number, height: number) {
  const base = screenMapping(baseView, width, height)
  const live = screenMapping(liveView, width, height)
  if (!(base.scale > 0) || !(live.scale > 0)) return 'none'
  const scale = live.scale / base.scale
  const x = live.constantX - scale * base.constantX
  const y = live.constantY - scale * base.constantY
  if (Math.abs(scale - 1) < 1e-9 && Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return 'none'
  return `matrix(${scale}, 0, 0, ${scale}, ${x}, ${y})`
}

export const CANVAS_SCENE_BLEED = DEFAULT_BLEED
