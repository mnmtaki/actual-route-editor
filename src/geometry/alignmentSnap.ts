export interface SnapPoint { x: number; y: number }

export interface SnapNode extends SnapPoint {
  id: string
  kind: 'station' | 'waypoint' | 'draft'
}

export interface SnapRaySource extends SnapPoint {
  id: string
}

export interface SnapOptions {
  node: boolean
  neighbor: boolean
  grid: boolean
}

export interface SnapThresholds {
  node: number
  ray: number
  grid: number
}

export interface SnapGuide {
  kind: 'ray' | 'grid-x' | 'grid-y' | 'node'
  source?: SnapPoint
  way?: SnapPoint
  point?: SnapPoint
}

export interface EditorSnapResult {
  point: SnapPoint
  guides: SnapGuide[]
}

const DEFAULT_ANGLES = [0, 45, 90, 135]
const SQRT2_HALF = Math.SQRT1_2
const EPS = 1e-9

export function snapEditorPoint(
  raw: SnapPoint,
  options: SnapOptions,
  thresholds: SnapThresholds,
  config: {
    nodes?: SnapNode[]
    neighbors?: SnapRaySource[]
    gridInterval?: number
    angles?: number[]
  } = {},
): EditorSnapResult {
  if (options.node) {
    const node = nearestNode(raw, config.nodes ?? [], thresholds.node)
    if (node) return { point: { x: node.x, y: node.y }, guides: [{ kind: 'node', point: { x: node.x, y: node.y } }] }
  }

  let point = raw
  let guides: SnapGuide[] = []
  let freeWay: SnapPoint | undefined

  if (options.neighbor) {
    const ray = snapNeighborRays(raw, config.neighbors ?? [], thresholds.ray, config.angles ?? DEFAULT_ANGLES)
    if (ray) {
      point = ray.point
      guides = ray.guides
      freeWay = ray.freeWay
    }
  }

  if (options.grid && config.gridInterval && config.gridInterval > 0) {
    const grid = snapGrid(point, config.gridInterval, thresholds.grid, freeWay)
    if (grid) {
      point = grid.point
      guides = [...guides, ...grid.guides]
    }
  }

  return { point, guides }
}

export function snapNeighborRays(
  raw: SnapPoint,
  neighbors: SnapRaySource[],
  threshold: number,
  angles = DEFAULT_ANGLES,
): { point: SnapPoint; guides: SnapGuide[]; freeWay?: SnapPoint } | undefined {
  const candidates: Array<{ distance: number; point: SnapPoint; source: SnapRaySource; way: SnapPoint }> = []
  for (const source of neighbors) {
    for (const angle of angles) {
      const way = angleWay(angle)
      const dx = raw.x - source.x
      const dy = raw.y - source.y
      const signed = dx * (-way.y) + dy * way.x
      const distance = Math.abs(signed)
      if (distance > threshold) continue
      candidates.push({
        distance,
        source,
        way,
        point: {
          x: raw.x + signed * way.y,
          y: raw.y - signed * way.x,
        },
      })
    }
  }
  candidates.sort((a, b) => a.distance - b.distance)
  const first = candidates[0]
  if (!first) return undefined

  const firstGuide = rayGuide(first.source, first.way, first.point)
  const maxCrossDistance = threshold * 2
  for (let index = 1; index < candidates.length; index++) {
    const second = candidates[index]
    if (second.source.id === first.source.id) continue
    const intersection = lineIntersection(first.source, first.way, second.source, second.way)
    if (!intersection || distance(intersection, raw) > maxCrossDistance) continue
    return {
      point: intersection,
      guides: [firstGuide, rayGuide(second.source, second.way, intersection)],
    }
  }

  return {
    point: first.point,
    freeWay: first.way,
    guides: [firstGuide],
  }
}

export function snapGrid(
  raw: SnapPoint,
  interval: number,
  threshold: number,
  freeWay?: SnapPoint,
): { point: SnapPoint; guides: SnapGuide[] } | undefined {
  if (!(interval > 0)) return undefined
  const xTarget = Math.round(raw.x / interval) * interval
  const yTarget = Math.round(raw.y / interval) * interval
  const xDistance = Math.abs(raw.x - xTarget)
  const yDistance = Math.abs(raw.y - yTarget)

  if (!freeWay) {
    const snapX = xDistance <= threshold
    const snapY = yDistance <= threshold
    if (!snapX && !snapY) return undefined
    const point = { x: snapX ? xTarget : raw.x, y: snapY ? yTarget : raw.y }
    const guides: SnapGuide[] = []
    if (snapX) guides.push({ kind: 'grid-x', point: { x: xTarget, y: point.y } })
    if (snapY) guides.push({ kind: 'grid-y', point: { x: point.x, y: yTarget } })
    return { point, guides }
  }

  const candidates: Array<{ amount: number; point: SnapPoint; guide: SnapGuide }> = []
  if (Math.abs(freeWay.x) > EPS) {
    const t = (xTarget - raw.x) / freeWay.x
    if (Math.abs(t) <= threshold / Math.max(Math.abs(freeWay.x), EPS)) {
      const point = { x: raw.x + t * freeWay.x, y: raw.y + t * freeWay.y }
      candidates.push({ amount: Math.abs(t), point, guide: { kind: 'grid-x', point: { x: xTarget, y: point.y } } })
    }
  }
  if (Math.abs(freeWay.y) > EPS) {
    const t = (yTarget - raw.y) / freeWay.y
    if (Math.abs(t) <= threshold / Math.max(Math.abs(freeWay.y), EPS)) {
      const point = { x: raw.x + t * freeWay.x, y: raw.y + t * freeWay.y }
      candidates.push({ amount: Math.abs(t), point, guide: { kind: 'grid-y', point: { x: point.x, y: yTarget } } })
    }
  }
  candidates.sort((a, b) => a.amount - b.amount)
  const best = candidates[0]
  return best ? { point: best.point, guides: [best.guide] } : undefined
}

function nearestNode(raw: SnapPoint, nodes: SnapNode[], threshold: number): SnapNode | undefined {
  return nodes
    .map(node => ({ node, distance: distance(node, raw) }))
    .filter(item => item.distance <= threshold)
    .sort((a, b) => a.distance - b.distance || nodePriority(a.node) - nodePriority(b.node) || a.node.id.localeCompare(b.node.id))[0]?.node
}

function nodePriority(node: SnapNode) {
  return node.kind === 'station' ? 0 : node.kind === 'waypoint' ? 1 : 2
}

function angleWay(angle: number): SnapPoint {
  const normalized = ((angle % 180) + 180) % 180
  if (Math.abs(normalized) < EPS) return { x: 1, y: 0 }
  if (Math.abs(normalized - 45) < EPS) return { x: SQRT2_HALF, y: -SQRT2_HALF }
  if (Math.abs(normalized - 90) < EPS) return { x: 0, y: -1 }
  if (Math.abs(normalized - 135) < EPS) return { x: -SQRT2_HALF, y: -SQRT2_HALF }
  const radians = normalized * Math.PI / 180
  return { x: Math.cos(radians), y: -Math.sin(radians) }
}

function rayGuide(source: SnapPoint, way: SnapPoint, toward: SnapPoint): SnapGuide {
  let resolved = way
  if ((toward.x - source.x) * way.x + (toward.y - source.y) * way.y < 0) {
    resolved = { x: -way.x, y: -way.y }
  }
  return { kind: 'ray', source: { x: source.x, y: source.y }, way: resolved }
}

function lineIntersection(a: SnapPoint, aw: SnapPoint, b: SnapPoint, bw: SnapPoint): SnapPoint | undefined {
  const cross = aw.x * bw.y - aw.y * bw.x
  if (Math.abs(cross) < EPS) return undefined
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = (dx * bw.y - dy * bw.x) / cross
  return { x: a.x + t * aw.x, y: a.y + t * aw.y }
}

function distance(a: SnapPoint, b: SnapPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
