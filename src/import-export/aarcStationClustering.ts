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
): AarcStationClusteringResult {
  const pointMap = new Map(points.map(point => [point.id, point]))
  const dsu = new DisjointSet()
  for (const point of points) dsu.add(point.id)
  const edges: AarcStationConnectivityEdge[] = []

  // AARC's implicit station snap is an undirected proximity relation.  Keep
  // the exact Euclidean distance for diagnostics, but never alter coordinates.
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i], b = points[j]
      const aLines = memberships.get(a.id) ?? [], bLines = memberships.get(b.id) ?? []
      // A station snap represents two line renderings of one place.  Two
      // adjacent points on the same line are not an interchange and must not
      // collapse into one station merely because their graphic anchors are
      // close.  Helpers (with no memberships) remain eligible as bridges.
      if (aLines.some(lineId => bLines.includes(lineId))) continue
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (distance <= AARC_STATION_SNAP_DISTANCE + AARC_STATION_SNAP_EPSILON) {
        dsu.union(a.id, b.id)
        edges.push({ a: a.id, b: b.id, reason: 'proximity', distance })
      }
    }
  }

  const warnings: string[] = []
  for (const [linkIndex, link] of linkGroups(rawPointLinks).entries()) {
    const ids = validPointIds((link as { pts?: unknown })?.pts, pointMap, warnings, linkIndex)
    for (let index = 1; index < ids.length; index += 1) {
      dsu.union(ids[0], ids[index])
      edges.push({ a: ids[0], b: ids[index], reason: 'pointLinks' })
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
