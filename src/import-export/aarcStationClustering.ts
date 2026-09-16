/**
 * Import-time mirror of AARC's automatic station-cluster semantics.
 *
 * Important source distinction:
 * - automatic staClusters come only from sta=1 points that cling by AARC's
 *   distance / snap-size / free-point candidate rules;
 * - pointLinks are NOT edges in that automatic cluster graph. A type=4
 *   pointLink is an explicit "station cluster" / forced-interchange relation
 *   rendered separately by AARC, while every pointLink type may participate
 *   in AARC's fallback station-name lookup.
 */

export const AARC_STATION_SNAP_DISTANCE = 25
export const AARC_STATION_SNAP_EPSILON = 1e-4
export const AARC_STATION_PREFILTER_MULTIPLIER = 2.5

export interface AarcStationPointInput {
  id: number
  x: number
  y: number
  name?: string
  nameS?: string
  nameP?: [number, number]
  sourceOrder: number
  free?: boolean
}

export interface AarcNamePointInput {
  id: number
  name?: string
  nameS?: string
  sourceOrder: number
}

export interface AarcStationSnapInfo {
  candidates: Array<[number, number]>
  reach?: number
  bbox?: { minX: number; maxX: number; minY: number; maxY: number }
}

export interface AarcStationConnectivityEdge {
  a: number
  b: number
  reason: 'proximity'
  distance: number
}

export interface AarcStationComponent {
  id: string
  pointIds: number[]
  referencedPointIds: number[]
  helperPointIds: number[]
  lineIds: number[]
  canonicalPointId: number
  conflictingNames: Array<{ pointId: number; name: string }>
}

export interface AarcStationClusteringMetrics {
  sta1Total: number
  referencedSta1Count: number
  helperCount: number
  proximityEdgeCount: number
  multiPointComponentCount: number
  interchangeStationCount: number
  helperOnlyComponentCount: number
  ambiguousNameCount: number
}

export interface AarcStationClusteringResult {
  components: AarcStationComponent[]
  pointToComponent: Map<number, string>
  edges: AarcStationConnectivityEdge[]
  metrics: AarcStationClusteringMetrics
  warnings: string[]
}

export interface AarcStationClusteringOptions {
  configClingingDist?: number
  getSnapSize?: (id: number) => number
  getSnapCandidates?: (point: AarcStationPointInput) => AarcStationSnapInfo | undefined
}

export interface AarcExplicitClusterLinkEdge {
  a: number
  b: number
  linkIndex: number
}

export interface AarcResolvedStationName {
  name: string
  nameSub: string
  pointId: number
}

class DisjointSet {
  private readonly parent = new Map<number, number>()

  add(id: number) { if (!this.parent.has(id)) this.parent.set(id, id) }

  find(id: number): number {
    const parent = this.parent.get(id)
    if (parent === undefined) return id
    if (parent === id) return id
    const root = this.find(parent)
    this.parent.set(id, root)
    return root
  }

  union(a: number, b: number) {
    const rootA = this.find(a), rootB = this.find(b)
    if (rootA === rootB) return
    if (rootA < rootB) this.parent.set(rootB, rootA)
    else this.parent.set(rootA, rootB)
  }
}

function numericId(value: unknown): number | null {
  const id = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(id) ? id : null
}

function linkGroups(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') return [raw]
  return []
}

function linkEndpoints(link: unknown): [number, number] | null {
  if (!link || typeof link !== 'object') return null
  const pts = (link as { pts?: unknown }).pts
  if (!Array.isArray(pts) || pts.length < 2) return null
  const a = numericId(pts[0]), b = numericId(pts[1])
  return a === null || b === null ? null : [a, b]
}

function bboxOf(candidates: Array<[number, number]>) {
  return candidates.reduce(
    (box, point) => ({
      minX: Math.min(box.minX, point[0]), maxX: Math.max(box.maxX, point[0]),
      minY: Math.min(box.minY, point[1]), maxY: Math.max(box.maxY, point[1]),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  )
}

function normalizeSnapInfo(point: AarcStationPointInput, supplied?: AarcStationSnapInfo): Required<AarcStationSnapInfo> {
  const candidates = supplied?.candidates?.length ? supplied.candidates : [[point.x, point.y] as [number, number]]
  let reach = supplied?.reach
  if (reach === undefined) {
    reach = 0
    for (const candidate of candidates) {
      reach = Math.max(reach, Math.abs(candidate[0] - point.x), Math.abs(candidate[1] - point.y))
    }
  }
  return { candidates, reach, bbox: supplied?.bbox ?? bboxOf(candidates) }
}

function bboxesCouldCling(a: Required<AarcStationSnapInfo>['bbox'], b: Required<AarcStationSnapInfo>['bbox'], distance: number) {
  if (a.minX - b.maxX > distance || b.minX - a.maxX > distance) return false
  if (a.minY - b.maxY > distance || b.minY - a.maxY > distance) return false
  return true
}

function candidateSetsCling(a: Required<AarcStationSnapInfo>, b: Required<AarcStationSnapInfo>, distance: number) {
  if (!bboxesCouldCling(a.bbox, b.bbox, distance)) return false
  const compareSq = (distance + AARC_STATION_SNAP_EPSILON * 10) ** 2
  for (const ca of a.candidates) {
    for (const cb of b.candidates) {
      const dx = ca[0] - cb[0]
      const dxSq = dx * dx
      if (dxSq > compareSq) continue
      const dy = ca[1] - cb[1]
      if (dxSq + dy * dy < compareSq) return true
    }
  }
  return false
}

/**
 * Build AARC's automatic station components.
 *
 * This deliberately does not consume pointLinks. AARC's staClusterStore builds
 * its neighbour graph only from sta points and the clinging oracle, then takes
 * connected components. Explicit type=4 links are handled separately.
 */
export function buildAarcStationComponents(
  points: AarcStationPointInput[],
  memberships: Map<number, number[]>,
  options: AarcStationClusteringOptions = {},
): AarcStationClusteringResult {
  const dsu = new DisjointSet()
  for (const point of points) dsu.add(point.id)
  const edges: AarcStationConnectivityEdge[] = []
  const warnings: string[] = []
  const baseDistance = options.configClingingDist ?? AARC_STATION_SNAP_DISTANCE
  const skipThreshold = AARC_STATION_PREFILTER_MULTIPLIER * baseDistance
  const snapInfo = new Map(points.map(point => [point.id, normalizeSnapInfo(point, options.getSnapCandidates?.(point))]))

  // AARC's optimized grid ultimately applies this same pairwise semantic
  // prefilter: source-position delta <= 2.5 * base distance + both candidate
  // reaches, followed by candidate-bbox and candidate×candidate checks.
  if (skipThreshold > 0) {
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i], b = points[j]
        const aSnap = snapInfo.get(a.id)!, bSnap = snapInfo.get(b.id)!
        const prefilter = skipThreshold + aSnap.reach + bSnap.reach
        if (Math.abs(a.x - b.x) > prefilter || Math.abs(a.y - b.y) > prefilter) continue

        const sizeA = options.getSnapSize?.(a.id) ?? 1
        const sizeB = options.getSnapSize?.(b.id) ?? 1
        const clingingDistance = baseDistance * ((sizeA + sizeB) / 2)
        if (!candidateSetsCling(aSnap, bSnap, clingingDistance)) continue

        dsu.union(a.id, b.id)
        edges.push({ a: a.id, b: b.id, reason: 'proximity', distance: Math.hypot(a.x - b.x, a.y - b.y) })
      }
    }
  }

  const groups = new Map<number, AarcStationPointInput[]>()
  for (const point of points) {
    const root = dsu.find(point.id)
    groups.set(root, [...(groups.get(root) ?? []), point])
  }
  const allComponents = [...groups.values()].map(group => group.sort((a, b) => a.sourceOrder - b.sourceOrder || a.id - b.id))
  const pointToComponent = new Map<number, string>()
  const components: AarcStationComponent[] = []
  let helperOnlyComponentCount = 0
  let ambiguousNameCount = 0

  for (const group of allComponents) {
    const pointIds = group.map(point => point.id).sort((a, b) => a - b)
    const referenced = group.filter(point => (memberships.get(point.id)?.length ?? 0) > 0)
    const referencedPointIds = referenced.map(point => point.id).sort((a, b) => a - b)
    const helperPointIds = group.filter(point => !referenced.includes(point)).map(point => point.id).sort((a, b) => a - b)
    const isHelperOnly = referenced.length === 0
    if (isHelperOnly) helperOnlyComponentCount += 1
    const componentId = `aarc-station-component-${pointIds.join('-')}`
    for (const point of group) pointToComponent.set(point.id, componentId)
    if (isHelperOnly) continue

    // Keep canonical geometry on a line-referenced point. Display-name lookup
    // is a separate AARC rule and may still borrow a name from helpers/links.
    const namedReferenced = referenced.filter(point => Boolean(point.name))
    const canonicalPool = namedReferenced.length ? namedReferenced : referenced
    const canonical = [...canonicalPool].sort((a, b) => {
      const lineCount = (memberships.get(b.id)?.length ?? 0) - (memberships.get(a.id)?.length ?? 0)
      return lineCount || a.sourceOrder - b.sourceOrder || a.id - b.id
    })[0]
    if (!canonical) continue
    const lineIds = [...new Set(referenced.flatMap(point => memberships.get(point.id) ?? []))].sort((a, b) => a - b)
    const named = group.filter(point => Boolean(point.name)).map(point => ({ pointId: point.id, name: point.name! }))
    const names = [...new Set(named.map(entry => entry.name))]
    const conflictingNames = names.length > 1 ? named : []
    if (conflictingNames.length) {
      ambiguousNameCount += 1
      warnings.push(`AARC 自动车站团 ${pointIds.join('、')} 包含冲突站名：${conflictingNames.map(entry => `${entry.pointId}:${entry.name}`).join('；')}；几何基准点为 ${canonical.id}`)
    }
    components.push({ id: componentId, pointIds, referencedPointIds, helperPointIds, lineIds, canonicalPointId: canonical.id, conflictingNames })
  }

  return {
    components: components.sort((a, b) => a.pointIds[0] - b.pointIds[0]),
    pointToComponent,
    edges,
    metrics: {
      sta1Total: points.length,
      referencedSta1Count: points.filter(point => (memberships.get(point.id)?.length ?? 0) > 0).length,
      helperCount: points.filter(point => (memberships.get(point.id)?.length ?? 0) === 0).length,
      proximityEdgeCount: edges.length,
      multiPointComponentCount: allComponents.filter(group => group.length > 1).length,
      interchangeStationCount: components.filter(component => component.lineIds.length > 1).length,
      helperOnlyComponentCount,
      ambiguousNameCount,
    },
    warnings,
  }
}

/** Read only AARC's explicit type=4 "车站团" links. */
export function readAarcExplicitClusterLinks(
  rawPointLinks: unknown,
  validStationPointIds: Set<number>,
  warnings: string[] = [],
): AarcExplicitClusterLinkEdge[] {
  const edges: AarcExplicitClusterLinkEdge[] = []
  for (const [linkIndex, link] of linkGroups(rawPointLinks).entries()) {
    if (!link || typeof link !== 'object') continue
    if (numericId((link as { type?: unknown }).type) !== 4) continue
    const endpoints = linkEndpoints(link)
    if (!endpoints) continue
    const [a, b] = endpoints
    if (!validStationPointIds.has(a) || !validStationPointIds.has(b)) {
      warnings.push(`AARC pointLinks 第 ${linkIndex + 1} 项的显式车站团连接引用了不存在或非 sta=1 Point`)
      continue
    }
    if (a !== b) edges.push({ a, b, linkIndex })
  }
  return edges
}

/**
 * Mirror AARC getStaName(): own name first; otherwise search the automatic
 * cluster, then breadth-first across pointLinks of ANY type until a named
 * cluster is found. Points outside automatic station clusters act as singleton
 * graph nodes, matching AARC's implementation.
 */
export function resolveAarcStationName(
  pointId: number,
  points: AarcNamePointInput[],
  rawPointLinks: unknown,
  automaticComponents: AarcStationComponent[],
): AarcResolvedStationName {
  const pointById = new Map(points.map(point => [point.id, point]))
  const own = pointById.get(pointId)
  if (own?.name) return { name: own.name.replaceAll('\n', ''), nameSub: own.nameS?.replaceAll('\n', '') ?? '', pointId }

  const clusters: number[][] = automaticComponents.map(component => [...component.pointIds])
  const clustered = new Set(clusters.flat())
  for (const point of [...points].sort((a, b) => a.sourceOrder - b.sourceOrder || a.id - b.id)) {
    if (!clustered.has(point.id)) clusters.push([point.id])
  }
  const pointToCluster = new Map<number, number>()
  clusters.forEach((cluster, index) => cluster.forEach(id => pointToCluster.set(id, index)))
  const adjacency = new Map<number, Set<number>>()
  for (const link of linkGroups(rawPointLinks)) {
    const endpoints = linkEndpoints(link)
    if (!endpoints) continue
    const a = pointToCluster.get(endpoints[0]), b = pointToCluster.get(endpoints[1])
    if (a === undefined || b === undefined || a === b) continue
    const aSet = adjacency.get(a) ?? new Set<number>(), bSet = adjacency.get(b) ?? new Set<number>()
    aSet.add(b); bSet.add(a); adjacency.set(a, aSet); adjacency.set(b, bSet)
  }

  const start = pointToCluster.get(pointId)
  if (start !== undefined) {
    const visited = new Set<number>([start]), queue = [start]
    while (queue.length) {
      const current = queue.shift()!
      const named = clusters[current]
        .map(id => pointById.get(id))
        .find((point): point is AarcNamePointInput => Boolean(point?.name))
      if (named?.name) return { name: named.name.replaceAll('\n', ''), nameSub: named.nameS?.replaceAll('\n', '') ?? '', pointId: named.id }
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) { visited.add(next); queue.push(next) }
      }
    }
  }
  return { name: `#${pointId}`, nameSub: '', pointId }
}

export function getAarcComponentEdgeReasons(component: AarcStationComponent, edges: AarcStationConnectivityEdge[]) {
  const pointSet = new Set(component.pointIds)
  return edges.filter(edge => pointSet.has(edge.a) && pointSet.has(edge.b)).map(edge => ({ ...edge }))
}

export interface AarcSourcePointPosition { x: number; y: number }
export interface AarcSourceLineChain { pts: number[] }
type Vec2 = [number, number]

function unitVector(from: Vec2, to: Vec2): Vec2 | undefined {
  const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy)
  return length > AARC_STATION_SNAP_EPSILON ? [dx / length, dy / length] : undefined
}
function cross2(a: Vec2, b: Vec2) { return a[0] * b[1] - a[1] * b[0] }
function dot2(a: Vec2, b: Vec2) { return a[0] * b[0] + a[1] * b[1] }
function add2(a: Vec2, b: Vec2): Vec2 { return [a[0] + b[0], a[1] + b[1]] }
function scale2(a: Vec2, scalar: number): Vec2 { return [a[0] * scalar, a[1] * scalar] }
function sub2(a: Vec2, b: Vec2): Vec2 { return [a[0] - b[0], a[1] - b[1]] }
function negate2(a: Vec2): Vec2 { return [-a[0], -a[1]] }
function same2(a: Vec2, b: Vec2) { return Math.hypot(a[0] - b[0], a[1] - b[1]) <= AARC_STATION_SNAP_EPSILON }
function perpendicularCCW(v: Vec2) { return [-v[1], v[0]] as Vec2 }
function innerNormal2(lineDir: Vec2, towards: Vec2): Vec2 {
  const perp = perpendicularCCW(lineDir), length = Math.hypot(perp[0], perp[1]), unit = [perp[0] / length, perp[1] / length] as Vec2
  return dot2(unit, towards) >= 0 ? unit : negate2(unit)
}
function rayIntersection(sourceA: Vec2, directionA: Vec2, sourceB: Vec2, directionB: Vec2): Vec2 | undefined {
  const denominator = cross2(directionA, directionB)
  if (Math.abs(denominator) <= AARC_STATION_SNAP_EPSILON) return undefined
  const delta = sub2(sourceB, sourceA), scale = cross2(delta, directionB) / denominator
  return add2(sourceA, scale2(directionA, scale))
}
function candidateBbox(candidates: Vec2[]) { return bboxOf(candidates) }

function freeCandidatesAt(position: Vec2, snapDist: number, adjacent?: { prev?: Vec2; next?: Vec2 }) {
  const addForOccurrence = ({ prev, next }: { prev?: Vec2; next?: Vec2 }) => {
    const prevDir = prev ? unitVector(position, prev) : undefined, nextDir = next ? unitVector(position, next) : undefined
    if (!prevDir && !nextDir) return [position]
    if (!prevDir || !nextDir) {
      const direction = nextDir ?? prevDir!, side = scale2(perpendicularCCW(direction), snapDist)
      return [position, add2(position, side), add2(position, negate2(side))]
    }
    const turnCross = cross2(prevDir, nextDir)
    if (Math.abs(turnCross) <= AARC_STATION_SNAP_EPSILON) {
      const side = scale2(perpendicularCCW(nextDir), snapDist)
      return [position, add2(position, side), add2(position, negate2(side))]
    }
    const nPrev = innerNormal2(prevDir, nextDir), nNext = innerNormal2(nextDir, prevDir)
    const result: Vec2[] = [position]
    const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot2(prevDir, nextDir)))) * 180 / Math.PI
    if (angleDeg >= 80) {
      result.push(
        rayIntersection(add2(position, scale2(nPrev, snapDist)), prevDir, add2(position, scale2(nNext, snapDist)), nextDir) ?? position,
        rayIntersection(add2(position, scale2(negate2(nPrev), snapDist)), prevDir, add2(position, scale2(negate2(nNext), snapDist)), nextDir) ?? position,
      )
    }
    result.push(add2(position, scale2(negate2(nPrev), snapDist)), add2(position, scale2(negate2(nNext), snapDist)))
    return result
  }
  return adjacent ? addForOccurrence(adjacent) : [position]
}

/**
 * Build the free-point candidate oracle used by AARC's cluster snap path.
 * AARC intentionally uses only the FIRST adjacent line occurrence for a free
 * point (saveStore.adjacentSegs(...)[0]), even when the point belongs to more
 * than one line.
 */
export function createAarcFreeSnapCandidateResolver(
  pointPositions: Map<number, AarcSourcePointPosition>,
  lines: AarcSourceLineChain[],
  getSnapDistance: (pointId: number) => number,
): (point: AarcStationPointInput) => AarcStationSnapInfo {
  const firstAdjacent = new Map<number, { prev?: Vec2; next?: Vec2 }>()
  for (const line of lines) {
    for (let index = 0; index < line.pts.length; index += 1) {
      const pointId = line.pts[index]
      if (firstAdjacent.has(pointId) || !pointPositions.has(pointId)) continue
      const prevPosition = index > 0 ? pointPositions.get(line.pts[index - 1]) : undefined
      const nextPosition = index + 1 < line.pts.length ? pointPositions.get(line.pts[index + 1]) : undefined
      firstAdjacent.set(pointId, {
        ...(prevPosition ? { prev: [prevPosition.x, prevPosition.y] as Vec2 } : {}),
        ...(nextPosition ? { next: [nextPosition.x, nextPosition.y] as Vec2 } : {}),
      })
    }
  }
  return point => {
    const position: Vec2 = [point.x, point.y]
    const candidates = point.free ? freeCandidatesAt(position, Math.max(0, getSnapDistance(point.id)), firstAdjacent.get(point.id)) : [position]
    let reach = 0
    for (const candidate of candidates) reach = Math.max(reach, Math.abs(candidate[0] - position[0]), Math.abs(candidate[1] - position[1]))
    return { candidates, reach, bbox: candidateBbox(candidates) }
  }
}
