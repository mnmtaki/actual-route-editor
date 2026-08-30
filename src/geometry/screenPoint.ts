export interface WorldPoint { x: number; y: number }
export interface WorldViewBox { x: number; y: number; width: number; height: number }

/** Convert one browser pointer location into the SVG's world coordinate system. */
export function screenPointToWorld(svg: SVGSVGElement, clientX: number, clientY: number, fallbackViewBox?: WorldViewBox): WorldPoint {
  const matrix = svg.getScreenCTM?.()
  if (matrix && typeof svg.createSVGPoint === 'function') {
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const world = point.matrixTransform(matrix.inverse())
    return { x: world.x, y: world.y }
  }
  return screenPointToWorldFallback(svg.getBoundingClientRect(), fallbackViewBox ?? readViewBox(svg), clientX, clientY)
}

/** Mirrors SVG's default xMidYMid meet mapping for non-browser tests and older engines. */
export function screenPointToWorldFallback(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, viewBox: WorldViewBox, clientX: number, clientY: number): WorldPoint {
  if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) return { x: viewBox.x, y: viewBox.y }
  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height)
  const renderedWidth = viewBox.width * scale
  const renderedHeight = viewBox.height * scale
  const contentLeft = rect.left + (rect.width - renderedWidth) / 2
  const contentTop = rect.top + (rect.height - renderedHeight) / 2
  return { x: viewBox.x + (clientX - contentLeft) / scale, y: viewBox.y + (clientY - contentTop) / scale }
}

/** Used only after the user explicitly hits a Segment. */
export function projectPointToSvgPath(path: SVGPathElement, point: WorldPoint): WorldPoint {
  if (typeof path.getTotalLength !== 'function' || typeof path.getPointAtLength !== 'function') return point
  const total = path.getTotalLength()
  if (!Number.isFinite(total) || total <= 0) return point
  const samples = Math.max(24, Math.min(160, Math.ceil(total / 12)))
  let bestLength = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index <= samples; index += 1) {
    const length = total * index / samples
    const candidate = path.getPointAtLength(length)
    const distance = squaredDistance(candidate, point)
    if (distance < bestDistance) { bestDistance = distance; bestLength = length }
  }
  let radius = total / samples
  for (let pass = 0; pass < 8; pass += 1) {
    const left = Math.max(0, bestLength - radius)
    const right = Math.min(total, bestLength + radius)
    const third = (right - left) / 3
    const firstLength = left + third
    const secondLength = right - third
    const first = path.getPointAtLength(firstLength)
    const second = path.getPointAtLength(secondLength)
    if (squaredDistance(first, point) <= squaredDistance(second, point)) bestLength = firstLength
    else bestLength = secondLength
    radius *= .5
  }
  const result = path.getPointAtLength(bestLength)
  return { x: result.x, y: result.y }
}

function readViewBox(svg: SVGSVGElement): WorldViewBox {
  const value = svg.viewBox?.baseVal
  return value && value.width > 0 && value.height > 0 ? { x: value.x, y: value.y, width: value.width, height: value.height } : { x: 0, y: 0, width: svg.clientWidth || 1, height: svg.clientHeight || 1 }
}
function squaredDistance(a: WorldPoint, b: WorldPoint) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy }
