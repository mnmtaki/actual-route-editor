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
  sourceLegCount: number
  directLegCount: number
  oneImplicitReconstructionCount: number
  twoImplicitReconstructionCount: number
  unresolvedCount: number
}

export interface AarcGeometryResult {
  orientations: Array<AarcOrientation | null>
  nodes: AarcSkeletonNode[]
  stats: AarcGeometryStats
}

interface Vector { x: number; y: number }
interface EdgeSolution { points: Vector[]; length: number; corners: number; cost: number }
type ConcreteHeading = 'E' | 'W' | 'N' | 'S' | 'NE' | 'NW' | 'SE' | 'SW'
interface StationAnchor { point: AarcGeometryPoint; sourceIndex: number }
interface StationInterval { fromAnchor: number; toAnchor: number; sourceStart: number; sourceEnd: number; explicitControlIndices: number[]; directHeading: AarcOrientation | null; lockedDirect: boolean }

// AARC exports occasionally contain tails such as 2699.99999.  A small
// coordinate epsilon is enough to treat those as the intended octilinear
// direction without changing any coordinates.
const EPSILON = 1e-4
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
  // Reconstruct the complete source chain.  The previous implementation
  // solved only station-to-station intervals and then selected one
  // orientation per station, which could insert a corner even when the
  // source pair was already a legal H/V/45 degree edge.  Source points
  // (including sta:0 controls) are now always emitted in source order and
  // implicit points are inserted only for an illegal adjacent pair.
  const chain = reconstructSourceChain(points)
  const nodes: AarcSkeletonNode[] = chain.nodes
  const stats = measureNodes(nodes)
  stats.legalCollinearRunCount = runCount
  stats.lockedDirectEdgeCount = intervals.filter(interval => interval.lockedDirect).length
  stats.sourceLegCount = Math.max(0, points.length - 1)
  stats.directLegCount = chain.directLegCount
  stats.oneImplicitReconstructionCount = chain.oneImplicitReconstructionCount
  stats.twoImplicitReconstructionCount = chain.twoImplicitReconstructionCount
  stats.unresolvedCount = chain.unresolvedCount
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

interface ChainReconstruction {
  nodes: AarcSkeletonNode[]
  directLegCount: number
  oneImplicitReconstructionCount: number
  twoImplicitReconstructionCount: number
  unresolvedCount: number
}

/**
 * Reconstruct the source point chain without replacing source geometry.
 * A pair is always tested for a direct octilinear leg first.  Only an illegal
 * pair is routed through deterministic one-/two-corner candidates.
 */
function reconstructSourceChain(points: AarcGeometryPoint[]): ChainReconstruction {
  const nodes: AarcSkeletonNode[] = points.length
    ? [{ x: points[0].x, y: points[0].y, sourcePointIndex: 0, implicit: false }]
    : []
  let directLegCount = 0
  let oneImplicitReconstructionCount = 0
  let twoImplicitReconstructionCount = 0
  let unresolvedCount = 0

  const incidentHeadings = resolveConcreteIncidentHeadings(points)
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]
    const to = points[index + 1]
    const directHeading = headingBetween(from, to)
    if (directHeading) {
      // A small backwards-compatibility guard for legacy AARC chains whose
      // two dir=0 anchors sit on a diagonal between an orthogonal incoming
      // and outgoing run.  The source pair is geometrically legal, but the
      // surrounding chain explicitly describes the preserved orthogonal bend
      // used by older imports.  Mixed-dir pairs (including the confirmed
      // Mintang→Kaibu case) always take the direct fast path.
      const legacyCorner = legacyOrthogonalCorner(points, index, directHeading)
      if (legacyCorner) {
        legacyCorner.points.slice(1, -1).forEach(value => pushDistinct(nodes, { ...value, implicit: true }))
        pushDistinct(nodes, { x: to.x, y: to.y, sourcePointIndex: index + 1, implicit: false })
        oneImplicitReconstructionCount += legacyCorner.corners === 1 ? 1 : 0
        twoImplicitReconstructionCount += legacyCorner.corners === 2 ? 1 : 0
        continue
      }
      directLegCount += 1
      pushDistinct(nodes, { x: to.x, y: to.y, sourcePointIndex: index + 1, implicit: false })
      continue
    }

    const continuity = {
      from: from.station ? incidentHeadings[index].incoming : undefined,
      to: to.station ? incidentHeadings[index + 1].outgoing : undefined,
    }
    const fromHints = continuity.from ? [orientationOfConcreteHeading(continuity.from)] : resolveSideHeadingCandidates(points, index, 'outgoing')
    const toHints = continuity.to ? [orientationOfConcreteHeading(continuity.to)] : resolveSideHeadingCandidates(points, index + 1, 'incoming')
    let candidates = generateEdgeCandidates(from, to, fromHints, toHints)
    // If the nearest continuation family cannot span the displacement (for
    // example a short horizontal run facing a taller offset), expand to the
    // endpoint dir families.  This is a deterministic fallback, not an
    // arbitrary-angle segment; every candidate is still validated as H/V/45.
    if (!candidates.length) {
      candidates = generateEdgeCandidates(from, to,
        Array.from(new Set([...fromHints, ...candidatesFor(from)])),
        Array.from(new Set([...toHints, ...candidatesFor(to)])))
    }
    const best = chooseEdgeCandidate(candidates, continuity)
    if (!best) {
      unresolvedCount += 1
      // Keep the source point and fail loudly in measureNodes rather than
      // silently introducing an arbitrary-angle segment.
      pushDistinct(nodes, { x: to.x, y: to.y, sourcePointIndex: index + 1, implicit: false })
      continue
    }
    if (best.corners === 1) oneImplicitReconstructionCount += 1
    else if (best.corners === 2) twoImplicitReconstructionCount += 1
    best.points.slice(1, -1).forEach(value => pushDistinct(nodes, { ...value, implicit: true }))
    pushDistinct(nodes, { x: to.x, y: to.y, sourcePointIndex: index + 1, implicit: false })
  }

  return { nodes, directLegCount, oneImplicitReconstructionCount, twoImplicitReconstructionCount, unresolvedCount }
}

function resolveConcreteIncidentHeadings(points: AarcGeometryPoint[]): Array<{ incoming?: ConcreteHeading; outgoing?: ConcreteHeading }> {
  const result = points.map(() => ({} as { incoming?: ConcreteHeading; outgoing?: ConcreteHeading }))
  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) result[index].incoming = concreteHeadingForPair(points[index - 1], points[index], points[index].dir)
    if (index + 1 < points.length) result[index].outgoing = concreteHeadingForPair(points[index], points[index + 1], points[index].dir)
  }
  return result
}

function concreteHeadingForPair(from: Vector, to: Vector, endpointDir: 0 | 1): ConcreteHeading | undefined {
  const direct = headingBetween(from, to)
  if (direct) return concreteHeadingBetween(from, to) ?? undefined
  const dx = to.x - from.x, dy = to.y - from.y
  if (endpointDir === 1) {
    if (Math.abs(dx) < EPSILON || Math.abs(dy) < EPSILON) return undefined
    return dx > 0 ? (dy > 0 ? 'NE' : 'SE') : (dy > 0 ? 'NW' : 'SW')
  }
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W'
  return dy >= 0 ? 'S' : 'N'
}

function orientationOfConcreteHeading(heading: ConcreteHeading): AarcOrientation {
  return heading === 'E' || heading === 'W' ? 'horizontal'
    : heading === 'N' || heading === 'S' ? 'vertical'
      : heading === 'NE' || heading === 'SW' ? 'diag-positive'
        : 'diag-negative'
}

function legacyOrthogonalCorner(points: AarcGeometryPoint[], index: number, directHeading: AarcOrientation): EdgeSolution | null {
  if (directHeading !== 'diag-positive' && directHeading !== 'diag-negative') return null
  const from = points[index], to = points[index + 1]
  if (from.dir !== 0 || to.dir !== 0 || index === 0 || index + 2 >= points.length) return null
  const incoming = headingBetween(points[index - 1], from)
  const outgoing = headingBetween(to, points[index + 2])
  if (!incoming || !outgoing || incoming === outgoing || parallel(VECTORS[incoming], VECTORS[outgoing])) return null
  const candidate = solveOneImplicitEdge(from, to, incoming, outgoing)
  return candidate && candidate.corners === 1 ? candidate : null
}

type EdgeSide = 'incoming' | 'outgoing'

/** Resolve per-side directions from the nearest legal source legs. */
function resolveSideHeadingCandidates(points: AarcGeometryPoint[], index: number, side: EdgeSide): AarcOrientation[] {
  const family = candidatesFor(points[index])
  const accepts = (heading: AarcOrientation) => family.some(candidate => sameHeadingFamily(candidate, heading))
  const closedRing = points.length > 2 && points[0].id === points.at(-1)?.id && distance(points[0], points.at(-1)!) <= EPSILON
  const resolveContextPair = (pair: number[]): [number, number] | null => {
    if (!closedRing) {
      if (pair.some(value => value < 0 || value >= points.length)) return null
      return [pair[0], pair[1]]
    }
    const ringLength = points.length - 1
    const wrap = (value: number) => ((value % ringLength) + ringLength) % ringLength
    const result: [number, number] = [wrap(pair[0]), wrap(pair[1])]
    return result[0] === result[1] ? null : result
  }
  const choose = (heading: AarcOrientation | null): AarcOrientation[] | null => heading && accepts(heading) ? withDiagonalAlternative(heading).filter(item => accepts(item)) : null
  const adjacentIndex = side === 'outgoing' ? index + 1 : index - 1
  if (adjacentIndex >= 0 && adjacentIndex < points.length) {
    const direct = side === 'outgoing' ? headingBetween(points[index], points[adjacentIndex]) : headingBetween(points[adjacentIndex], points[index])
    const preferred = choose(direct)
    if (preferred?.length) return preferred
  }
  const primaryPairs = side === 'outgoing' ? [[index - 1, index]] : [[index, index + 1]]
  for (const pair of primaryPairs) {
    const resolved = resolveContextPair(pair)
    if (!resolved) continue
    const preferred = choose(headingBetween(points[resolved[0]], points[resolved[1]]))
    if (preferred?.length) return preferred
  }
  const primarySearch = side === 'outgoing' ? (distance: number) => [index - distance, index - distance + 1] : (distance: number) => [index + distance - 1, index + distance]
  const secondarySearch = side === 'outgoing' ? (distance: number) => [index + distance, index + distance + 1] : (distance: number) => [index - distance, index - distance + 1]
  const findHeading = (makePair: (distance: number) => number[]): AarcOrientation | null => {
    for (let distance = 1; distance < points.length; distance += 1) {
      const resolved = resolveContextPair(makePair(distance))
      if (!resolved) continue
      const direct = headingBetween(points[resolved[0]], points[resolved[1]])
      if (direct && accepts(direct)) return direct
    }
    return null
  }
  const primaryHeading = findHeading(primarySearch)
  const primaryPreferred = choose(primaryHeading)
  if (primaryPreferred?.length) return primaryPreferred
  const secondaryHeading = findHeading(secondarySearch)
  const secondaryPreferred = choose(secondaryHeading)
  if (secondaryPreferred?.length) return secondaryPreferred
  return family
}
function withDiagonalAlternative(heading: AarcOrientation): AarcOrientation[] {
  return heading === 'diag-positive' || heading === 'diag-negative'
    ? [heading, heading === 'diag-positive' ? 'diag-negative' : 'diag-positive']
    : [heading]
}

interface ScoredEdgeSolution extends EdgeSolution {
  orientationChanges: number
}

function generateEdgeCandidates(a: AarcGeometryPoint, b: AarcGeometryPoint, fromHints: AarcOrientation[], toHints: AarcOrientation[]): ScoredEdgeSolution[] {
  const candidates: ScoredEdgeSolution[] = []
  const fromFamily = candidatesFor(a), toFamily = candidatesFor(b)
  for (const from of fromHints) for (const to of toHints) {
    // Endpoint dir families are hard constraints.  Context is only a hint
    // for axis/sign selection and can never authorize a cross-family leg.
    if (!fromFamily.some(candidate => sameHeadingFamily(candidate, from)) || !toFamily.some(candidate => sameHeadingFamily(candidate, to))) continue
    const one = solveOneImplicitEdge(a, b, from, to)
    if (one) candidates.push({ ...one, orientationChanges: from === to ? 0 : 1 })
    if (parallel(VECTORS[from], VECTORS[to])) {
      const bridge = solveParallelBridge(a, b, from)
      if (bridge) candidates.push({ ...bridge, orientationChanges: from === to ? 0 : 1 })
    }
  }
  return candidates
}

function solveOneImplicitEdge(a: Vector, b: Vector, from: AarcOrientation, to: AarcOrientation): ScoredEdgeSolution | null {
  if (parallel(VECTORS[from], VECTORS[to])) return null
  const intersection = intersectLines(a, VECTORS[from], b, VECTORS[to])
  if (!intersection) return null
  const solution = makeSolution([a, intersection, b])
  if (solution.corners !== 1 || !isValidOctilinearSolution(solution, a, b, from, to)) return null
  return { ...solution, orientationChanges: from === to ? 0 : 1 }
}

/**
 * Two parallel endpoint directions with a lateral offset cannot be expressed
 * by a single implicit point.  Split the remaining primary-axis distance so
 * the middle connector is a legal 45 degree leg.
 */
function solveParallelBridge(a: Vector, b: Vector, heading: AarcOrientation): EdgeSolution | null {
  const axis = VECTORS[heading]
  const delta = subtract(b, a)
  const alongSigned = dot(delta, axis)
  const primaryDistance = Math.abs(alongSigned)
  const signedAxis = alongSigned >= 0 ? axis : scale(axis, -1)
  const secondary = perpendicular(signedAxis)
  const offset = dot(delta, secondary)
  const offsetDistance = Math.abs(offset)
  if (offsetDistance < EPSILON || primaryDistance < offsetDistance - EPSILON) return null
  const remaining = primaryDistance - offsetDistance
  const half = remaining / 2
  const first = add(a, scale(signedAxis, half))
  const second = subtract(b, scale(signedAxis, half))
  const solution = makeSolution([a, first, second, b])
  return solution.corners === 2 && isValidOctilinearSolution(solution, a, b, heading, heading) ? solution : null
}

function isValidOctilinearSolution(solution: EdgeSolution, a: Vector, b: Vector, from: AarcOrientation, to: AarcOrientation): boolean {
  if (solution.points.length < 2) return false
  const firstHeading = headingBetween(solution.points[0], solution.points[1])
  const lastHeading = headingBetween(solution.points.at(-2)!, solution.points.at(-1)!)
  if (!firstHeading || !lastHeading || !sameHeadingFamily(firstHeading, from) || !sameHeadingFamily(lastHeading, to)) return false
  for (let index = 1; index < solution.points.length; index += 1) {
    if (!headingBetween(solution.points[index - 1], solution.points[index])) return false
  }
  // No route may overshoot either source endpoint along the overall source
  // direction.  This rejects mirrored intersections while allowing lateral
  // movement in a valid one-/two-corner bridge.
  const delta = subtract(b, a)
  const deltaLengthSquared = dot(delta, delta)
  if (deltaLengthSquared < EPSILON) return false
  let previousProjection = 0
  for (const point of solution.points) {
    const projection = dot(subtract(point, a), delta) / deltaLengthSquared
    if (projection < -EPSILON || projection > 1 + EPSILON || projection + EPSILON < previousProjection) return false
    previousProjection = projection
  }
  return true
}

function sameHeadingFamily(a: AarcOrientation, b: AarcOrientation): boolean {
  if ((a === 'horizontal') !== (b === 'horizontal')) return false
  if ((a === 'vertical') !== (b === 'vertical')) return false
  const aDiagonal = a === 'diag-positive' || a === 'diag-negative'
  const bDiagonal = b === 'diag-positive' || b === 'diag-negative'
  return aDiagonal === bDiagonal
}

function chooseEdgeCandidate(candidates: ScoredEdgeSolution[], continuity?: { from?: ConcreteHeading; to?: ConcreteHeading }): ScoredEdgeSolution | null {
  if (!candidates.length) return null
  const continuityScore = (candidate: ScoredEdgeSolution) => {
    if (!continuity) return 0
    const first = concreteHeadingBetween(candidate.points[0], candidate.points[1])
    const last = concreteHeadingBetween(candidate.points.at(-2)!, candidate.points.at(-1)!)
    return (continuity.from && first === continuity.from ? 1 : 0) + (continuity.to && last === continuity.to ? 1 : 0)
  }
  const highestContinuity = Math.max(...candidates.map(continuityScore))
  const preferred = candidates.filter(candidate => continuityScore(candidate) === highestContinuity)
  return [...preferred].sort((left, right) => {
    const cornerDiff = left.corners - right.corners
    if (cornerDiff) return cornerDiff
    const lengthDiff = left.length - right.length
    if (Math.abs(lengthDiff) > EPSILON) return lengthDiff
    const changeDiff = left.orientationChanges - right.orientationChanges
    if (changeDiff) return changeDiff
    const leftKey = left.points.slice(1, -1).map(point => `${point.x.toFixed(6)},${point.y.toFixed(6)}`).join('|')
    const rightKey = right.points.slice(1, -1).map(point => `${point.x.toFixed(6)},${point.y.toFixed(6)}`).join('|')
    return leftKey.localeCompare(rightKey)
  })[0]
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
function concreteHeadingBetween(a: Vector, b: Vector): ConcreteHeading | null {
  const dx = b.x - a.x, dy = b.y - a.y
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return null
  if (Math.abs(dy) < EPSILON) return dx > 0 ? 'E' : 'W'
  if (Math.abs(dx) < EPSILON) return dy > 0 ? 'S' : 'N'
  if (Math.abs(Math.abs(dx) - Math.abs(dy)) < EPSILON) {
    if (dx > 0) return dy > 0 ? 'NE' : 'SE'
    return dy > 0 ? 'NW' : 'SW'
  }
  return null
}

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
function explicitOnlyGeometry(points: AarcGeometryPoint[]): AarcGeometryResult {
  const nodes = points.map((point, sourcePointIndex) => ({ x: point.x, y: point.y, sourcePointIndex, implicit: false }))
  const stats = measureNodes(nodes)
  stats.sourceLegCount = Math.max(0, points.length - 1)
  stats.directLegCount = stats.sourceLegCount
  return { orientations: points.map(() => null), nodes, stats }
}
function emptyStats(): AarcGeometryStats { return { implicitCornerCount: 0, horizontalLegCount: 0, verticalLegCount: 0, diagonalLegCount: 0, legalCollinearRunCount: 0, lockedDirectEdgeCount: 0, sourceLegCount: 0, directLegCount: 0, oneImplicitReconstructionCount: 0, twoImplicitReconstructionCount: 0, unresolvedCount: 0 } }
function parallel(a: Vector, b: Vector) { return Math.abs(cross(a, b)) < EPSILON }
function perpendicular(value: Vector): Vector { return { x: -value.y, y: value.x } }
function cross(a: Vector, b: Vector) { return a.x * b.y - a.y * b.x }
function dot(a: Vector, b: Vector) { return a.x * b.x + a.y * b.y }
function add(a: Vector, b: Vector): Vector { return { x: a.x + b.x, y: a.y + b.y } }
function subtract(a: Vector, b: Vector): Vector { return { x: a.x - b.x, y: a.y - b.y } }
function scale(value: Vector, amount: number): Vector { return { x: value.x * amount, y: value.y * amount } }
function distance(a: Vector, b: Vector) { return Math.hypot(b.x - a.x, b.y - a.y) }
