import { buildAarcStationComponents, type AarcStationPointInput, type AarcStationSnapInfo } from './aarcStationClustering'

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
export interface AarcCompoundEdge { a: number; b: number; lineId: number; distance: number }
export interface AarcCompoundGroup { id: string; pointIds: number[]; edges: AarcCompoundEdge[] }
export interface AarcCompoundDetectionResult { groups: AarcCompoundGroup[]; edges: AarcCompoundEdge[]; warnings: string[] }
export interface AarcCompoundDetectionOptions {
  configClingingDist?: number
  getSnapSize?: (pointId: number) => number
  getSnapCandidates?: (point: AarcStationPointInput) => AarcStationSnapInfo | undefined
  getSnapThreshold?: (pointId: number) => number
  freeClusterMode?: 'off' | 'strict' | 'loose'
  pointLinks?: unknown
}

/**
 * Build passenger compound candidates from the same geometric station-cluster
 * oracle used by the importer.  There is deliberately no same-line adjacency,
 * name compatibility, service-family, or hard-coded distance business rule
 * here; those were Build67 heuristics and disagreed with AARC source semantics.
 * A component becomes a passenger compound only when its referenced points
 * carry at least two line ids.  Geometry entities remain independent in the
 * importer and only receive a shared compoundGroupId.
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
  const result = buildAarcStationComponents(
    sourcePoints,
    memberships,
    options.pointLinks ?? [],
    {
      configClingingDist: options.configClingingDist ?? AARC_COMPOUND_DISTANCE,
      getSnapSize: options.getSnapSize ?? (() => 1),
      getSnapCandidates: options.getSnapCandidates,
      getSnapThreshold: options.getSnapThreshold,
      freeClusterMode: options.freeClusterMode ?? 'loose',
    },
  )
  const pointMap = new Map(points.map(point => [point.id, point]))
  const edgeList: AarcCompoundEdge[] = result.edges.map(edge => {
    const aMemberships = memberships.get(edge.a) ?? [], bMemberships = memberships.get(edge.b) ?? []
    const common = aMemberships.find(lineId => bMemberships.includes(lineId))
    const lineId = common ?? aMemberships[0] ?? bMemberships[0] ?? -1
    return { a: edge.a, b: edge.b, lineId, distance: edge.distance ?? Math.hypot((pointMap.get(edge.a)?.x ?? 0) - (pointMap.get(edge.b)?.x ?? 0), (pointMap.get(edge.a)?.y ?? 0) - (pointMap.get(edge.b)?.y ?? 0)) }
  })
  const groups = result.components
    .filter(component => component.pointIds.length > 1 && component.lineIds.length > 1)
    .map(component => {
      const pointIds = component.pointIds.slice().sort((a, b) => a - b)
      const set = new Set(pointIds)
      const edges = edgeList.filter(edge => set.has(edge.a) && set.has(edge.b)).sort((a, b) => a.a - b.a || a.b - b.b || a.lineId - b.lineId)
      return { id: `aarc-compound-${pointIds.join('-')}`, pointIds, edges }
    })
    .sort((a, b) => a.pointIds[0] - b.pointIds[0])
  return { groups, edges: edgeList.sort((a, b) => a.a - b.a || a.b - b.b || a.lineId - b.lineId), warnings: result.warnings }
}
