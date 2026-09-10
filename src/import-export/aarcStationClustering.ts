/**
 * Import-time connectivity for AARC station points.
 *
 * AARC uses more than one point for a visual interchange: points may be
 * shared by id, placed within the station snap radius, or joined explicitly
 * by pointLinks.  This module deliberately has no dependency on the actual
 * route data model; it produces only the deterministic components needed by
 * the importer.
 */

export const AARC_STATION_SNAP_DISTANCE = 25
export const AARC_STATION_SNAP_EPSILON = 1e-4

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

export interface AarcStationSnapInfo {
  candidates: Array<[number, number]>
  reach?: number
  bbox?: { minX: number; maxX: number; minY: number; maxY: number }
}

export interface AarcStationConnectivityEdge {
  a: number
  b: number
  reason: 'proximity' | 'pointLinks'
  distance?: number
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
  pointLinksEdgeCount: number
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
    // Stable roots are useful for deterministic diagnostics.  Component ids
    // themselves are based on sorted source point ids below.
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

function validPointIds(raw: unknown, points: Map<number, AarcStationPointInput>, warnings: string[], linkIndex: number): number[] {
  if (!Array.isArray(raw)) return []
  const ids: number[] = []
  for (const value of raw) {
    const id = numericId(value)
    if (id === null || !points.has(id) || !points.get(id)) {
      warnings.push(`AARC pointLinks 第 ${linkIndex + 1} 项引用了不存在或非 sta=1 Point ${String(value)}`)
      continue
    }
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

export function buildAarcStationComponents(
  points: AarcStationPointInput[],
  memberships: Map<number, number[]>,
  rawPointLinks: unknown,
  options: { configClingingDist?: number; getSnapSize?: (id: number) => number; getSnapCandidates?: (point: AarcStationPointInput) => AarcStationSnapInfo | undefined; getSnapThreshold?: (id: number) => number; freeClusterMode?: 'off' | 'strict' | 'loose' } = {},
): AarcStationClusteringResult {
  const pointMap = new Map(points.map(point => [point.id, point]))
  const dsu = new DisjointSet()
  for (const point of points) dsu.add(point.id)
  const edges: AarcStationConnectivityEdge[] = []

  const warnings: string[] = []
  const componentLines = new Map<number, Set<number>>(points.map(point => [point.id, new Set(memberships.get(point.id) ?? [])]))
  const tryUnion = (a: number, b: number, reason: 'proximity' | 'pointLinks') => {
    const rootA = dsu.find(a), rootB = dsu.find(b)
    if (rootA === rootB) return true
    // AARC clustering is source-point based, not a passenger/business rule:
    // points from the same line may still be clustered when the upstream
    // snap oracle says they cling (for example a named point plus an
    // auxiliary station anchor).  Keep the line memberships only as derived
    // metadata; never reject a geometric union because of a shared line.
    dsu.union(a, b)
    const root = dsu.find(a), merged = new Set([...(componentLines.get(rootA) ?? []), ...(componentLines.get(rootB) ?? [])])
    componentLines.delete(rootA); componentLines.delete(rootB); componentLines.set(root, merged)
    return true
  }
  // AARC's implicit station snap is an undirected proximity relation.  Keep
  // the exact Euclidean distance for diagnostics, but never alter coordinates.
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i], b = points[j]
      // The upstream oracle does not require a cross-line membership.  Same
      // line auxiliary anchors therefore remain eligible; line identity is
      // resolved later by the importer, not used to veto geometry clusters.
      if (options.freeClusterMode === 'off' && (a.free || b.free)) continue
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const sizeA = Math.max(0, options.getSnapSize?.(a.id) ?? 1), sizeB = Math.max(0, options.getSnapSize?.(b.id) ?? 1)
      const baseDistance = options.configClingingDist ?? AARC_STATION_SNAP_DISTANCE
      const threshold = baseDistance * ((sizeA + sizeB) / 2)
      const aSnap = options.getSnapCandidates?.(a), bSnap = options.getSnapCandidates?.(b)
      if (aSnap?.bbox && bSnap?.bbox && (a.free || b.free)) {
        // Match upstream's bbox prefilter: free candidates can be farther from
        // the source position than the ordinary clinging radius. Candidate
        // providers that only return coordinates remain backward compatible.
        const candidateSpan = threshold + (aSnap.reach ?? 0) + (bSnap.reach ?? 0) + AARC_STATION_SNAP_EPSILON
        if (Math.abs(a.x - b.x) > candidateSpan || Math.abs(a.y - b.y) > candidateSpan) continue
      }
      const directCling = distance <= threshold + AARC_STATION_SNAP_EPSILON
      let candidateCling = false
      if (aSnap && bSnap && (a.free || b.free)) {
        const candidateThresholdA = options.freeClusterMode === 'strict' ? 0 : (options.getSnapThreshold?.(a.id) ?? threshold)
        const candidateThresholdB = options.freeClusterMode === 'strict' ? 0 : (options.getSnapThreshold?.(b.id) ?? threshold)
        const candidateDistance = (from: [number, number], to: [number, number]) => Math.hypot(from[0] - to[0], from[1] - to[1])
        candidateCling = bSnap.candidates.some(candidate => candidateDistance([a.x, a.y], candidate) <= candidateThresholdA + AARC_STATION_SNAP_EPSILON)
          || aSnap.candidates.some(candidate => candidateDistance([b.x, b.y], candidate) <= candidateThresholdB + AARC_STATION_SNAP_EPSILON)
      }
      if (directCling || candidateCling) {
        if (tryUnion(a.id, b.id, 'proximity')) edges.push({ a: a.id, b: b.id, reason: 'proximity', distance })
      }    }
  }

  for (const [linkIndex, link] of linkGroups(rawPointLinks).entries()) {
    // AARC uses pointLinks for several visual/editor purposes (fat/thin/dot
    // links). Only explicit `cluster` links participate in station
    // connectivity. Untyped links are kept as a legacy compatibility path;
    // known non-cluster types must never create an interchange.
    const rawType = link && typeof link === 'object' ? (link as { type?: unknown }).type : undefined
    const linkType = rawType === undefined || rawType === null || rawType === '' ? undefined : numericId(rawType)
    if (linkType !== undefined && linkType !== null && linkType !== 4) continue
    const ids = validPointIds((link as { pts?: unknown })?.pts, pointMap, warnings, linkIndex)
    for (let index = 1; index < ids.length; index += 1) {
      if (tryUnion(ids[0], ids[index], 'pointLinks')) edges.push({ a: ids[0], b: ids[index], reason: 'pointLinks' })
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

    // A named, line-referenced source is preferred over helpers.  Among
    // equally valid sources, more line memberships and then source order give
    // a stable result independent of object/map insertion details.
    const namedReferenced = referenced.filter(point => Boolean(point.name))
    const canonicalPool = namedReferenced.length ? namedReferenced : referenced
    const canonical = [...canonicalPool].sort((a, b) => {
      const lineCount = (memberships.get(b.id)?.length ?? 0) - (memberships.get(a.id)?.length ?? 0)
      return lineCount || a.sourceOrder - b.sourceOrder || a.id - b.id
    })[0]
    if (!canonical) continue
    const lineIds = [...new Set(referenced.flatMap(point => memberships.get(point.id) ?? []))].sort((a, b) => a - b)
    const named = referenced
      .filter(point => Boolean(point.name))
      .map(point => ({ pointId: point.id, name: point.name! }))
    const names = [...new Set(named.map(entry => entry.name))]
    const conflictingNames = names.length > 1 ? named : []
    if (conflictingNames.length) {
      ambiguousNameCount += 1
      warnings.push(`AARC 站点连接组件 ${pointIds.join('、')} 包含冲突站名：${conflictingNames.map(entry => `${entry.pointId}:${entry.name}`).join('；')}；已按稳定顺序选择 ${canonical.id}`)
    }
    components.push({ id: componentId, pointIds, referencedPointIds, helperPointIds, lineIds, canonicalPointId: canonical.id, conflictingNames })
  }

  const multiPointComponentCount = allComponents.filter(group => group.length > 1).length
  return {
    components: components.sort((a, b) => a.pointIds[0] - b.pointIds[0]),
    pointToComponent,
    edges,
    metrics: {
      sta1Total: points.length,
      referencedSta1Count: points.filter(point => (memberships.get(point.id)?.length ?? 0) > 0).length,
      helperCount: points.filter(point => (memberships.get(point.id)?.length ?? 0) === 0).length,
      proximityEdgeCount: edges.filter(edge => edge.reason === 'proximity').length,
      pointLinksEdgeCount: edges.filter(edge => edge.reason === 'pointLinks').length,
      multiPointComponentCount,
      interchangeStationCount: components.filter(component => component.lineIds.length > 1).length,
      helperOnlyComponentCount,
      ambiguousNameCount,
    },
    warnings,
  }
}

export function getAarcComponentEdgeReasons(component: AarcStationComponent, edges: AarcStationConnectivityEdge[]) {
  const pointSet = new Set(component.pointIds)
  return edges
    .filter(edge => pointSet.has(edge.a) && pointSet.has(edge.b))
    .map(edge => ({ ...edge }))
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
function perpendicularCCW(v: Vec2): Vec2 { return [-v[1], v[0]] }
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
function candidateBbox(candidates: Vec2[]) {
  return candidates.reduce((box, point) => ({ minX: Math.min(box.minX, point[0]), maxX: Math.max(box.maxX, point[0]), minY: Math.min(box.minY, point[1]), maxY: Math.max(box.maxY, point[1]) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity })
}
function freeCandidatesAt(position: Vec2, snapDist: number, adjacent: Array<{ prev?: Vec2; next?: Vec2 }>) {
  const all: Vec2[] = []
  const add = (candidate: Vec2) => { if (!all.some(existing => same2(existing, candidate))) all.push(candidate) }
  const addForOccurrence = ({ prev, next }: { prev?: Vec2; next?: Vec2 }) => {
    const prevDir = prev ? unitVector(position, prev) : undefined, nextDir = next ? unitVector(position, next) : undefined
    if (!prevDir && !nextDir) { add(position); return }
    if (!prevDir || !nextDir) {
      const direction = nextDir ?? prevDir!, side = scale2(perpendicularCCW(direction), snapDist)
      add(position); add(add2(position, side)); add(add2(position, negate2(side))); return
    }
    const turnCross = cross2(prevDir, nextDir)
    if (Math.abs(turnCross) <= AARC_STATION_SNAP_EPSILON) {
      const side = scale2(perpendicularCCW(nextDir), snapDist)
      add(position); add(add2(position, side)); add(add2(position, negate2(side))); return
    }
    const nPrev = innerNormal2(prevDir, nextDir), nNext = innerNormal2(nextDir, prevDir)
    add(position)
    const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot2(prevDir, nextDir)))) * 180 / Math.PI
    if (angleDeg >= 80) {
      add(rayIntersection(add2(position, scale2(nPrev, snapDist)), prevDir, add2(position, scale2(nNext, snapDist)), nextDir) ?? position)
      add(rayIntersection(add2(position, scale2(negate2(nPrev), snapDist)), prevDir, add2(position, scale2(negate2(nNext), snapDist)), nextDir) ?? position)
    }
    add(add2(position, scale2(negate2(nPrev), snapDist)))
    add(add2(position, scale2(negate2(nNext), snapDist)))
  }
  if (!adjacent.length) add(position)
  else adjacent.forEach(addForOccurrence)
  return all
}

/** Build the same free-point candidate oracle used by AARC's snap engine. */
export function createAarcFreeSnapCandidateResolver(
  pointPositions: Map<number, AarcSourcePointPosition>,
  lines: AarcSourceLineChain[],
  getSnapDistance: (pointId: number) => number,
): (point: AarcStationPointInput) => AarcStationSnapInfo {
  const adjacent = new Map<number, Array<{ prev?: Vec2; next?: Vec2 }>>()
  for (const line of lines) {
    for (let index = 0; index < line.pts.length; index += 1) {
      const pointId = line.pts[index], position = pointPositions.get(pointId)
      if (!position) continue
      const prevPosition = index > 0 ? pointPositions.get(line.pts[index - 1]) : undefined
      const nextPosition = index + 1 < line.pts.length ? pointPositions.get(line.pts[index + 1]) : undefined
      const entries = adjacent.get(pointId) ?? []
      entries.push({ ...(prevPosition ? { prev: [prevPosition.x, prevPosition.y] as Vec2 } : {}), ...(nextPosition ? { next: [nextPosition.x, nextPosition.y] as Vec2 } : {}) })
      adjacent.set(pointId, entries)
    }
  }
  return point => {
    const position: Vec2 = [point.x, point.y]
    const candidates = point.free ? freeCandidatesAt(position, Math.max(0, getSnapDistance(point.id)), adjacent.get(point.id) ?? []) : [position]
    let reach = 0
    for (const candidate of candidates) reach = Math.max(reach, Math.abs(candidate[0] - position[0]), Math.abs(candidate[1] - position[1]))
    return { candidates, reach, bbox: candidateBbox(candidates) }
  }
}
