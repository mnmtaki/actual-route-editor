export const AARC_COMPOUND_DISTANCE = 25
export const AARC_COMPOUND_EPSILON = 1e-4

export interface AarcCompoundPoint {
  id: number
  x: number
  y: number
  sta?: number
  name?: string
  sourceOrder?: number
}

export interface AarcCompoundLine {
  id: number
  pts: number[]
  parent?: number | null
  isFake?: boolean
  type?: number
}

export interface AarcCompoundEdge { a: number; b: number; lineId: number; distance: number }
export interface AarcCompoundGroup { id: string; pointIds: number[]; edges: AarcCompoundEdge[] }
export interface AarcCompoundDetectionResult { groups: AarcCompoundGroup[]; edges: AarcCompoundEdge[]; warnings: string[] }

class DisjointSet {
  private readonly parent = new Map<number, number>()
  add(id: number) { if (!this.parent.has(id)) this.parent.set(id, id) }
  find(id: number): number { const parent = this.parent.get(id); if (parent === undefined || parent === id) return parent ?? id; const root = this.find(parent); this.parent.set(id, root); return root }
  union(a: number, b: number) { const ra = this.find(a), rb = this.find(b); if (ra === rb) return; if (ra < rb) this.parent.set(rb, ra); else this.parent.set(ra, rb) }
}

function finiteId(value: unknown): number | null { const number = typeof value === 'number' ? value : Number(value); return Number.isFinite(number) ? number : null }
function normalizedName(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function serviceFamily(lineId: number, lines: Map<number, AarcCompoundLine>, seen = new Set<number>): number {
  if (seen.has(lineId)) return lineId
  seen.add(lineId)
  const parent = lines.get(lineId)?.parent
  return parent !== undefined && parent !== null && lines.has(parent) ? serviceFamily(parent, lines, seen) : lineId
}

/** Detect only the AARC construct where one real rail line has adjacent
 * station occurrences that are one passenger interchange. */
export function detectAarcCompoundGroups(points: AarcCompoundPoint[], lines: AarcCompoundLine[], memberships: Map<number, number[]>): AarcCompoundDetectionResult {
  const pointMap = new Map(points.map(point => [point.id, point]))
  const lineMap = new Map(lines.map(line => [line.id, line]))
  const dsu = new DisjointSet(), edges: AarcCompoundEdge[] = [], edgeKeys = new Set<string>()
  points.forEach(point => dsu.add(point.id))
  const families = (pointId: number) => new Set((memberships.get(pointId) ?? []).map(lineId => serviceFamily(lineId, lineMap)))
  const compatibleNames = (a: AarcCompoundPoint, b: AarcCompoundPoint) => { const an = normalizedName(a.name), bn = normalizedName(b.name); return !an || !bn || an === bn }
  for (const line of lines) {
    const chain = line.pts ?? []
    for (let index = 0; index + 1 < chain.length; index += 1) {
      const aId = finiteId(chain[index]), bId = finiteId(chain[index + 1])
      if (aId === null || bId === null || aId === bId) continue
      const a = pointMap.get(aId), b = pointMap.get(bId)
      if (!a || !b || a.sta !== 1 || b.sta !== 1) continue
      const aMemberships = memberships.get(aId) ?? [], bMemberships = memberships.get(bId) ?? []
      if (!aMemberships.includes(line.id) || !bMemberships.includes(line.id)) continue
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (distance > AARC_COMPOUND_DISTANCE + AARC_COMPOUND_EPSILON || !compatibleNames(a, b)) continue
      const commonFamily = serviceFamily(line.id, lineMap)
      const otherA = new Set([...families(aId)].filter(value => value !== commonFamily)), otherB = new Set([...families(bId)].filter(value => value !== commonFamily))
      if (!otherA.size || !otherB.size || setsEqual(otherA, otherB)) continue
      const [left, right] = aId < bId ? [aId, bId] : [bId, aId], key = `${left}:${right}`
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key); edges.push({ a: left, b: right, lineId: line.id, distance }); dsu.union(left, right)
    }
  }
  const componentEdges = new Map<number, AarcCompoundEdge[]>()
  for (const edge of edges) { const root = dsu.find(edge.a); componentEdges.set(root, [...(componentEdges.get(root) ?? []), edge]) }
  const groups = [...componentEdges.values()].map(groupEdges => {
    const pointIds = [...new Set(groupEdges.flatMap(edge => [edge.a, edge.b]))].sort((a, b) => a - b)
    return { id: `aarc-compound-${pointIds.join('-')}`, pointIds, edges: groupEdges.slice().sort((a, b) => a.a - b.a || a.b - b.b || a.lineId - b.lineId) }
  }).sort((a, b) => a.pointIds[0] - b.pointIds[0])
  return { groups, edges: edges.sort((a, b) => a.a - b.a || a.b - b.b || a.lineId - b.lineId), warnings: [] }
}

function setsEqual(a: Set<number>, b: Set<number>): boolean { return a.size === b.size && [...a].every(value => b.has(value)) }
