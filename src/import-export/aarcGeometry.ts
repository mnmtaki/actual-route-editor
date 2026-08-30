export interface AarcGeometryPoint {
  id: number
  x: number
  y: number
  dir: 0 | 1
  station: boolean
}

export type AarcOrientation = 'horizontal' | 'vertical' | 'diag-positive' | 'diag-negative'

export interface AarcSkeletonNode {
  x: number
  y: number
  sourcePointIndex?: number
  implicit: boolean
}

export interface AarcGeometryStats {
  implicitCornerCount: number
  horizontalLegCount: number
  verticalLegCount: number
  diagonalLegCount: number
  legalCollinearRunCount: number
  lockedDirectEdgeCount: number
}

export interface AarcGeometryResult {
  orientations: Array<AarcOrientation | null>
  nodes: AarcSkeletonNode[]
  stats: AarcGeometryStats
}

interface Vector { x: number; y: number }
interface EdgeSolution { points: Vector[]; length: number; corners: number; cost: number }
interface StationAnchor { point: AarcGeometryPoint; sourceIndex: number }
interface StationInterval { fromAnchor: number; toAnchor: number; sourceStart: number; sourceEnd: number; explicitControlIndices: number[]; directHeading: AarcOrientation | null; lockedDirect: boolean }

const EPSILON = 1e-7
const CORNER_PENALTY = 1
const ORIENTATION_ORDER: AarcOrientation[] = ['horizontal', 'vertical', 'diag-positive', 'diag-negative']
const VECTORS: Record<AarcOrientation, Vector> = {
  horizontal: { x: 1, y: 0 },
  vertical: { x: 0, y: 1 },
  'diag-positive': { x: 1 / Math.SQRT2, y: 1 / Math.SQRT2 },
  'diag-negative': { x: 1 / Math.SQRT2, y: -1 / Math.SQRT2 },
}

export function reconstructAarcLineGeometry(points: AarcGeometryPoint[]): AarcGeometryResult {
  if (!points.length) return { orientations: [], nodes: [], stats: emptyStats() }
  const anchors = points.map((point, sourceIndex) => ({ point, sourceIndex })).filter(value => value.point.station)
  if (!anchors.length) return explicitOnlyGeometry(points)
  const intervals = buildStationIntervals(points, anchors)
  const runCount = detectLegalCollinearRuns(intervals)
  const stationDirections = resolveStationAnchorDirections(anchors, intervals)
  const orientations: Array<AarcOrientation | null> = points.map(() => null)
  anchors.forEach((anchor, index) => { orientations[anchor.sourceIndex] = stationDirections[index] })
  const nodes: AarcSkeletonNode[] = [{ x: points[0].x, y: points[0].y, sourcePointIndex: 0, implicit: false }]

  for (let intervalIndex = 0; intervalIndex < intervals.length; intervalIndex += 1) {
    const interval = intervals[intervalIndex]
    if (interval.explicitControlIndices.length) {
      appendExplicitInterval(points, interval, nodes)
      continue
    }
    const fromPoint = anchors[interval.fromAnchor].point
    const toPoint = anchors[interval.toAnchor].point
    if (interval.lockedDirect) {
      pushDistinct(nodes, { x: toPoint.x, y: toPoint.y, sourcePointIndex: anchors[interval.toAnchor].sourceIndex, implicit: false })
      continue
    }
    const edge = solveEdge(fromPoint, toPoint, stationDirections[interval.fromAnchor], stationDirections[interval.toAnchor])
    edge.points.slice(1, -1).forEach(point => pushDistinct(nodes, { ...point, implicit: true }))
    pushDistinct(nodes, { x: toPoint.x, y: toPoint.y, sourcePointIndex: anchors[interval.toAnchor].sourceIndex, implicit: false })
  }

  if (anchors[0].sourceIndex > 0) nodes.splice(0, nodes.length, ...points.map((point, sourcePointIndex) => ({ x: point.x, y: point.y, sourcePointIndex, implicit: false })))
  const stats = measureNodes(nodes)
  stats.legalCollinearRunCount = runCount
  stats.lockedDirectEdgeCount = intervals.filter(interval => interval.lockedDirect).length
  return { orientations, nodes, stats }
}

export function resolveAarcDirections(points: AarcGeometryPoint[]): Array<AarcOrientation | null> {
  if (!points.length) return []
  const anchors = points.map((point, sourceIndex) => ({ point, sourceIndex })).filter(value => value.point.station)
  if (!anchors.length) return points.map(() => null)
  const intervals = buildStationIntervals(points, anchors)
  detectLegalCollinearRuns(intervals)
  const resolved = resolveStationAnchorDirections(anchors, intervals)
  const orientations: Array<AarcOrientation | null> = points.map(() => null)
  anchors.forEach((anchor, index) => { orientations[anchor.sourceIndex] = resolved[index] })
  return orientations
}

export function detectLegalCollinearRuns(intervals: StationInterval[]): number {
  let runCount = 0
  for (let start = 0; start < intervals.length;) {
    const heading = intervals[start].directHeading
    if (!heading || intervals[start].explicitControlIndices.length) { start += 1; continue }
    let end = start + 1
    while (end < intervals.length && !intervals[end].explicitControlIndices.length && intervals[end].directHeading === heading) end += 1
    if (end - start >= 2) {
      runCount += 1
      for (let index = start; index < end; index += 1) intervals[index].lockedDirect = true
    }
    start = end
  }
  return runCount
}

export function classifyLeg(a: Vector, b: Vector): 'horizontal' | 'vertical' | 'diagonal' | 'invalid' {
  const heading = headingBetween(a, b)
  if (heading === 'horizontal') return 'horizontal'
  if (heading === 'vertical') return 'vertical'
  if (heading === 'diag-positive' || heading === 'diag-negative') return 'diagonal'
  return 'invalid'
}

function resolveStationAnchorDirections(anchors: StationAnchor[], intervals: StationInterval[]): AarcOrientation[] {
  const hard = anchors.map(() => new Set<AarcOrientation>())
  intervals.forEach(interval => {
    if (!interval.lockedDirect || !interval.directHeading) return
    hard[interval.fromAnchor].add(interval.directHeading)
    hard[interval.toAnchor].add(interval.directHeading)
  })
  const candidates = anchors.map((anchor, index) => hard[index].size === 1
    ? [...hard[index]]
    : anchor.point.dir === 1 ? ['diag-positive', 'diag-negative'] as AarcOrientation[] : ['horizontal', 'vertical'] as AarcOrientation[])
  const costs = candidates.map(() => new Map<AarcOrientation, number>())
  const previous = candidates.map(() => new Map<AarcOrientation, AarcOrientation>())
  candidates[0].forEach((orientation, index) => costs[0].set(orientation, index * 1e-9))
  for (let anchorIndex = 1; anchorIndex < anchors.length; anchorIndex += 1) {
    const interval = intervals[anchorIndex - 1]
    for (const current of candidates[anchorIndex]) {
      let bestCost = Number.POSITIVE_INFINITY
      let bestPrevious: AarcOrientation | undefined
      for (const before of candidates[anchorIndex - 1]) {
        const prior = costs[anchorIndex - 1].get(before)
        if (prior === undefined) continue
        const edgeCost = interval.explicitControlIndices.length
          ? 0
          : interval.lockedDirect
            ? (before === interval.directHeading && current === interval.directHeading ? 0 : 1e12)
            : solveEdge(anchors[anchorIndex - 1].point, anchors[anchorIndex].point, before, current).cost
        const candidateCost = prior + edgeCost + ORIENTATION_ORDER.indexOf(current) * 1e-9
        if (candidateCost < bestCost - EPSILON) { bestCost = candidateCost; bestPrevious = before }
      }
      costs[anchorIndex].set(current, bestCost)
      if (bestPrevious) previous[anchorIndex].set(current, bestPrevious)
    }
  }
  let orientation = [...candidates.at(-1)!].sort((a, b) => (costs.at(-1)!.get(a) ?? Infinity) - (costs.at(-1)!.get(b) ?? Infinity) || ORIENTATION_ORDER.indexOf(a) - ORIENTATION_ORDER.indexOf(b))[0]
  const result = Array<AarcOrientation>(anchors.length)
  for (let index = anchors.length - 1; index >= 0; index -= 1) { result[index] = orientation; orientation = previous[index].get(orientation) ?? orientation }
  return result
}

function buildStationIntervals(points: AarcGeometryPoint[], anchors: StationAnchor[]): StationInterval[] {
  return anchors.slice(0, -1).map((anchor, index) => {
    const next = anchors[index + 1]
    const explicitControlIndices = Array.from({ length: Math.max(0, next.sourceIndex - anchor.sourceIndex - 1) }, (_, offset) => anchor.sourceIndex + offset + 1).filter(sourceIndex => !points[sourceIndex].station)
    return { fromAnchor: index, toAnchor: index + 1, sourceStart: anchor.sourceIndex, sourceEnd: next.sourceIndex, explicitControlIndices, directHeading: explicitControlIndices.length ? null : headingBetween(anchor.point, next.point), lockedDirect: false }
  })
}

function appendExplicitInterval(points: AarcGeometryPoint[], interval: StationInterval, nodes: AarcSkeletonNode[]) {
  for (let sourceIndex = interval.sourceStart + 1; sourceIndex <= interval.sourceEnd; sourceIndex += 1) {
    const point = points[sourceIndex]
    const previous = points[sourceIndex - 1]
    if (headingBetween(previous, point)) {
      pushDistinct(nodes, { x: point.x, y: point.y, sourcePointIndex: sourceIndex, implicit: false })
      continue
    }
    const routed = bestUnorientedConnection(points, sourceIndex - 1, sourceIndex)
    routed.slice(1, -1).forEach(value => pushDistinct(nodes, { ...value, implicit: true }))
    pushDistinct(nodes, { x: point.x, y: point.y, sourcePointIndex: sourceIndex, implicit: false })
  }
}

function bestUnorientedConnection(points: AarcGeometryPoint[], fromIndex: number, toIndex: number): Vector[] {
  const beforeHeading = fromIndex > 0 ? headingBetween(points[fromIndex - 1], points[fromIndex]) : null
  const afterHeading = toIndex + 1 < points.length ? headingBetween(points[toIndex], points[toIndex + 1]) : null
  const fromCandidates = beforeHeading ? [beforeHeading] : candidatesFor(points[fromIndex])
  const toCandidates = afterHeading ? [afterHeading] : candidatesFor(points[toIndex])
  let best: EdgeSolution | null = null
  for (const from of fromCandidates) for (const to of toCandidates) { const solution = solveEdge(points[fromIndex], points[toIndex], from, to); if (!best || solution.cost < best.cost) best = solution }
  return best?.points ?? [points[fromIndex], points[toIndex]]
}

function solveEdge(a: Vector, b: Vector, from: AarcOrientation, to: AarcOrientation): EdgeSolution {
  const fromVector = VECTORS[from], toVector = VECTORS[to]
  const delta = subtract(b, a)
  if (parallel(fromVector, toVector)) {
    if (parallel(delta, fromVector)) return withEndpointOrientationCost(makeSolution([a, b]), fromVector, toVector)
    const connector = perpendicular(fromVector)
    const along = dot(delta, fromVector)
    const first = add(a, scale(fromVector, along / 2))
    const second = subtract(b, scale(fromVector, along / 2))
    if (!parallel(subtract(second, first), connector)) return invalidSolution(a, b)
    return withEndpointOrientationCost(makeSolution([a, first, second, b]), fromVector, toVector)
  }
  const intersection = intersectLines(a, fromVector, b, toVector)
  return intersection ? withEndpointOrientationCost(makeSolution([a, intersection, b]), fromVector, toVector) : invalidSolution(a, b)
}

function withEndpointOrientationCost(solution: EdgeSolution, from: Vector, to: Vector): EdgeSolution {
  if (solution.points.length < 2) return solution
  const first = subtract(solution.points[1], solution.points[0])
  const last = subtract(solution.points.at(-1)!, solution.points.at(-2)!)
  const mismatch = (parallel(first, from) ? 0 : 1) + (parallel(last, to) ? 0 : 1)
  return mismatch ? { ...solution, cost: solution.cost + mismatch * 10000 } : solution
}
function makeSolution(input: Vector[]): EdgeSolution {
  const points = input.filter((point, index) => index === 0 || distance(point, input[index - 1]) > EPSILON)
  const length = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0)
  const corners = Math.max(0, points.length - 2)
  return { points, length, corners, cost: length + corners * CORNER_PENALTY }
}
function invalidSolution(a: Vector, b: Vector): EdgeSolution { return { points: [a, b], length: distance(a, b), corners: 0, cost: 1e12 } }
function intersectLines(a: Vector, u: Vector, b: Vector, v: Vector): Vector | null { const denominator = cross(u, v); if (Math.abs(denominator) < EPSILON) return null; return add(a, scale(u, cross(subtract(b, a), v) / denominator)) }
function headingBetween(a: Vector, b: Vector): AarcOrientation | null {
  const dx = b.x - a.x, dy = b.y - a.y
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return null
  if (Math.abs(dy) < EPSILON) return 'horizontal'
  if (Math.abs(dx) < EPSILON) return 'vertical'
  if (Math.abs(Math.abs(dx) - Math.abs(dy)) < EPSILON) return dx * dy > 0 ? 'diag-positive' : 'diag-negative'
  return null
}
function candidatesFor(point: AarcGeometryPoint): AarcOrientation[] { return point.dir === 1 ? ['diag-positive', 'diag-negative'] : ['horizontal', 'vertical'] }
function pushDistinct(nodes: AarcSkeletonNode[], node: AarcSkeletonNode) { const previous = nodes.at(-1); if (previous && distance(previous, node) < EPSILON) { if (node.sourcePointIndex !== undefined) Object.assign(previous, node); return }; nodes.push(node) }
function measureNodes(nodes: AarcSkeletonNode[]): AarcGeometryStats {
  const stats = emptyStats(); stats.implicitCornerCount = nodes.filter(node => node.implicit).length
  for (let index = 1; index < nodes.length; index += 1) { const kind = classifyLeg(nodes[index - 1], nodes[index]); if (kind === 'horizontal') stats.horizontalLegCount += 1; else if (kind === 'vertical') stats.verticalLegCount += 1; else if (kind === 'diagonal') stats.diagonalLegCount += 1; else throw new Error(`AARC geometry produced a non-octilinear leg at node ${index}`) }
  return stats
}
function explicitOnlyGeometry(points: AarcGeometryPoint[]): AarcGeometryResult { const nodes = points.map((point, sourcePointIndex) => ({ x: point.x, y: point.y, sourcePointIndex, implicit: false })); return { orientations: points.map(() => null), nodes, stats: measureNodes(nodes) } }
function emptyStats(): AarcGeometryStats { return { implicitCornerCount: 0, horizontalLegCount: 0, verticalLegCount: 0, diagonalLegCount: 0, legalCollinearRunCount: 0, lockedDirectEdgeCount: 0 } }
function parallel(a: Vector, b: Vector) { return Math.abs(cross(a, b)) < EPSILON }
function perpendicular(value: Vector): Vector { return { x: -value.y, y: value.x } }
function cross(a: Vector, b: Vector) { return a.x * b.y - a.y * b.x }
function dot(a: Vector, b: Vector) { return a.x * b.x + a.y * b.y }
function add(a: Vector, b: Vector): Vector { return { x: a.x + b.x, y: a.y + b.y } }
function subtract(a: Vector, b: Vector): Vector { return { x: a.x - b.x, y: a.y - b.y } }
function scale(value: Vector, amount: number): Vector { return { x: value.x * amount, y: value.y * amount } }
function distance(a: Vector, b: Vector) { return Math.hypot(b.x - a.x, b.y - a.y) }