import { buildAarcStationComponents, readAarcExplicitClusterLinks, type AarcStationPointInput, type AarcStationSnapInfo } from './aarcStationClustering'

/** Legacy name retained for callers; upstream's default clinging distance is 25. */
export const AARC_COMPOUND_DISTANCE = 25
export const AARC_COMPOUND_EPSILON = 1e-4

export interface AarcCompoundPoint {
  id: number
  x: number
  y: number
  sta?: number
  name?: string
  sourceOrder?: number
  free?: boolean
}
export interface AarcCompoundLine { id: number; pts: number[]; parent?: number | null; isFake?: boolean; type?: number; width?: number; ptSnapSize?: number; ptNameSnapSize?: number }
export interface AarcCompoundEdge { a: number; b: number; lineId: number; distance: number; reason: 'proximity' | 'explicit-cluster-link' }
export interface AarcCompoundGroup { id: string; pointIds: number[]; edges: AarcCompoundEdge[] }
export interface AarcCompoundDetectionResult { groups: AarcCompoundGroup[]; edges: AarcCompoundEdge[]; warnings: string[] }
export interface AarcCompoundDetectionOptions {
  configClingingDist?: number
  getSnapSize?: (pointId: number) => number
  getSnapCandidates?: (point: AarcStationPointInput) => AarcStationSnapInfo | undefined
  pointLinks?: unknown
  /** Legacy caller compatibility only; upstream automatic clusters do not use this. */
  getSnapThreshold?: (pointId: number) => number
  /** Legacy caller compatibility only; this is not an upstream AARC config. */
  freeClusterMode?: 'off' | 'strict' | 'loose'
}

class DisjointSet {
  private readonly parent = new Map<number, number>()
  add(id: number) { if (!this.parent.has(id)) this.parent.set(id, id) }
  find(id: number): number {
    const parent = this.parent.get(id)
    if (parent === undefined || parent === id) return id
    const root = this.find(parent)
    this.parent.set(id, root)
    return root
  }
  union(a: number, b: number) {
    const ra = this.find(a), rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }
}

/**
 * Build ActualRoute passenger compound groups from the two AARC source
 * mechanisms that express one interchange visually:
 *
 * 1. automatic proximity/snap staClusters;
 * 2. explicit pointLinks[type=4] "车站团" links (forced interchange).
 *
 * The mechanisms stay separate in diagnostics/edges even though both map to
 * ActualRoute's shared passenger identity (`compoundGroupId`). Ordinary
 * fat/thin/dot links never create a passenger compound.
 */
export function detectAarcCompoundGroups(
  points: AarcCompoundPoint[],
  _lines: AarcCompoundLine[],
  memberships: Map<number, number[]>,
  options: AarcCompoundDetectionOptions = {},
): AarcCompoundDetectionResult {
  const sourcePoints: AarcStationPointInput[] = points
    .filter(point => point.sta === undefined || point.sta === 1)
    .map((point, index) => ({ id: point.id, x: point.x, y: point.y, sourceOrder: point.sourceOrder ?? index, ...(point.name ? { name: point.name } : {}), ...(point.free ? { free: true } : {}) }))
  const automatic = buildAarcStationComponents(sourcePoints, memberships, {
    configClingingDist: options.configClingingDist ?? AARC_COMPOUND_DISTANCE,
    getSnapSize: options.getSnapSize ?? (() => 1),
    getSnapCandidates: options.getSnapCandidates,
  })

  const warnings = [...automatic.warnings]
  const pointMap = new Map(points.map(point => [point.id, point]))
  const validIds = new Set(sourcePoints.map(point => point.id))
  const explicit = readAarcExplicitClusterLinks(options.pointLinks ?? [], validIds, warnings)

  const dsu = new DisjointSet()
  for (const point of sourcePoints) dsu.add(point.id)
  // Use the raw automatic proximity edges, not the importer-filtered component
  // list, so helper-only automatic clusters remain available as bridges.
  for (const edge of automatic.edges) dsu.union(edge.a, edge.b)
  for (const edge of explicit) dsu.union(edge.a, edge.b)

  const edgeList: AarcCompoundEdge[] = automatic.edges.map(edge => {
    const aMemberships = memberships.get(edge.a) ?? [], bMemberships = memberships.get(edge.b) ?? []
    const common = aMemberships.find(lineId => bMemberships.includes(lineId))
    const lineId = common ?? aMemberships[0] ?? bMemberships[0] ?? -1
    return { a: edge.a, b: edge.b, lineId, distance: edge.distance, reason: 'proximity' as const }
  })
  for (const edge of explicit) {
    const aMemberships = memberships.get(edge.a) ?? [], bMemberships = memberships.get(edge.b) ?? []
    const common = aMemberships.find(lineId => bMemberships.includes(lineId))
    edgeList.push({
      a: edge.a,
      b: edge.b,
      lineId: common ?? aMemberships[0] ?? bMemberships[0] ?? -1,
      distance: Math.hypot((pointMap.get(edge.a)?.x ?? 0) - (pointMap.get(edge.b)?.x ?? 0), (pointMap.get(edge.a)?.y ?? 0) - (pointMap.get(edge.b)?.y ?? 0)),
      reason: 'explicit-cluster-link',
    })
  }

  const grouped = new Map<number, number[]>()
  for (const point of sourcePoints) {
    const root = dsu.find(point.id)
    grouped.set(root, [...(grouped.get(root) ?? []), point.id])
  }
  const groups = [...grouped.values()]
    .map(ids => ids.sort((a, b) => a - b))
    .filter(pointIds => pointIds.length > 1)
    .filter(pointIds => new Set(pointIds.flatMap(pointId => memberships.get(pointId) ?? [])).size > 1)
    .map(pointIds => {
      const set = new Set(pointIds)
      const edges = edgeList.filter(edge => set.has(edge.a) && set.has(edge.b)).sort((a, b) => a.a - b.a || a.b - b.b || a.lineId - b.lineId)
      return { id: `aarc-compound-${pointIds.join('-')}`, pointIds, edges }
    })
    .sort((a, b) => a.pointIds[0] - b.pointIds[0])

  return { groups, edges: edgeList.sort((a, b) => a.a - b.a || a.b - b.b || a.lineId - b.lineId), warnings }
}
