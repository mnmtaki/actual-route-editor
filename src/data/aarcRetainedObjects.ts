import type { ActualRouteProject } from './model'

export const pointLinkIndex = (id: string): number | null => {
  const match = /^aarc-point-link-(\d+)$/.exec(id)
  return match ? Number(match[1]) : null
}
export function sourcePointLinks(project: ActualRouteProject): Record<string, unknown>[] {
  const records = project.aarc?.pointLinks ?? project.aarc?.raw?.pointLinks
  return Array.isArray(records) ? records as Record<string, unknown>[] : []
}
export function removePointLinks(project: ActualRouteProject, ids: ReadonlySet<string>): boolean {
  const indices = new Set([...ids].map(pointLinkIndex).filter((i): i is number => i !== null))
  if (!indices.size || !sourcePointLinks(project).some((_, i) => indices.has(i))) return false
  const original = sourcePointLinks(project)
  const filtered = original.filter((_, i) => !indices.has(i))
  if (project.aarc) {
    project.aarc.pointLinks = filtered
    if (project.aarc.raw) project.aarc.raw.pointLinks = structuredClone(filtered)
  }
  return true
}
export function changePointLinkType(project: ActualRouteProject, id: string, type: 0 | 1 | 2 | 3): boolean {
  const index = pointLinkIndex(id)
  const original = sourcePointLinks(project)
  if (index === null || !original[index] || ![0,1,2,3].includes(Number(original[index].type))) return false
  const updated = original.map((record,i) => i === index ? { ...record, type } : record)
  if (project.aarc) {
    project.aarc.pointLinks = updated
    if (project.aarc.raw) project.aarc.raw.pointLinks = structuredClone(updated)
  }
  return true
}
export function aarcFakeStationSource(project: ActualRouteProject, id: string): Record<string, unknown> | undefined {
  return (project.aarc?.raw?.points as Array<Record<string, unknown>> | undefined)?.find(point => String(point.id) === id)
}
export function modifyAarcFakeStation(project: ActualRouteProject, id:string, change: { x?:number; y?:number; name?:string; remove?:boolean }): boolean {
  const point=aarcFakeStationSource(project,id)
  if (!point) return false
  if (change.remove) { point.sta = 0; return true }
  if (change.name !== undefined) point.name=change.name
  if (change.x !== undefined || change.y !== undefined) {
    const pos = Array.isArray(point.pos) ? point.pos : []
    point.pos = [change.x ?? Number(pos[0]),change.y ?? Number(pos[1])]
  }
  return true
}
export function fakeTerrainSource(project: ActualRouteProject, id: string): Record<string, unknown> | undefined {
  return (project.aarc?.raw?.lines as Array<Record<string, unknown>> | undefined)?.find(line => String(line.id) === id && line.isFake === true && Number(line.type) === 1)
}
export function removeFakeTerrain(project: ActualRouteProject, ids: ReadonlySet<string>): boolean {
  const raw = project.aarc?.raw
  if (!raw || !Array.isArray(raw.lines)) return false
  const before = raw.lines.length
  raw.lines = raw.lines.filter(entry => !(entry && typeof entry === 'object' && ids.has(String((entry as Record<string,unknown>).id)) && (entry as Record<string,unknown>).isFake === true && Number((entry as Record<string,unknown>).type) === 1))
  project.aarc!.fakeLines = project.aarc!.fakeLines?.filter(entry => !(ids.has(String(entry.id)) && Number(entry.type) === 1))
  return (raw.lines as unknown[]).length !== before
}
