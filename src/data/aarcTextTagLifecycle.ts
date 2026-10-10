import type { AarcTextTag, ActualRouteProject } from './model'

/** AARC labels can belong to regular lines or imported fake lines. Terrain tags are independent. */
export function ownerLineForAarcTag(project: ActualRouteProject, tag: AarcTextTag): string | undefined {
  if (tag.kind === 'TerrainNameLabel' || tag.source?.targetKind === 'terrain') return undefined
  if (tag.lineId && project.lines.some(line => line.id === tag.lineId)) return tag.lineId
  const sourceId = Number(tag.source?.forId)
  if (!Number.isFinite(sourceId)) return undefined
  return project.lines.find(line => line.source?.format === 'aarc' && Number(line.source.sourceLineId ?? line.source.lineId) === sourceId)?.id
}

function rawTagId(tag: AarcTextTag): number | undefined {
  const id = tag.source?.textTagId ?? tag.raw?.id
  const value = Number(id)
  return id !== undefined && id !== null && Number.isFinite(value) ? value : undefined
}

/** Mutate a cloned project, removing both native tags and retained AARC source references. */
export function removeAarcTextTags(project: ActualRouteProject, ids: ReadonlySet<string>): void {
  if (!ids.size) return
  const removed = (project.textTags ?? []).filter(tag => ids.has(tag.id))
  if (!removed.length) return
  project.textTags = (project.textTags ?? []).filter(tag => !ids.has(tag.id))
  const sourceIds = new Set(removed.map(rawTagId).filter((value): value is number => value !== undefined))
  if (!sourceIds.size) return
  const raw = project.aarc?.raw
  if (raw && Array.isArray(raw.textTags)) {
    raw.textTags = raw.textTags.filter((item: unknown) => !item || typeof item !== 'object' || !sourceIds.has(Number((item as Record<string, unknown>).id)))
  }
  for (const group of project.aarc?.selectionGroups ?? []) {
    group.textTagIds = group.textTagIds.filter(id => !sourceIds.has(id))
  }
  if (raw && Array.isArray(raw.selectionGroups)) {
    for (const value of raw.selectionGroups) {
      if (!value || typeof value !== 'object') continue
      const group = value as Record<string, unknown>
      if (Array.isArray(group.textTagIds)) group.textTagIds = group.textTagIds.filter((id: unknown) => !sourceIds.has(Number(id)))
    }
  }
}

/** Keep retained source coordinates aligned with the native ARE label after a group move. */
export function moveAarcTextTags(project: ActualRouteProject, ids: ReadonlySet<string>, dx: number, dy: number): void {
  if (!ids.size) return
  const rawTags = project.aarc?.raw?.textTags
  for (const tag of project.textTags ?? []) {
    if (!ids.has(tag.id)) continue
    tag.x += dx
    tag.y += dy
    for (const record of [tag.raw, tag.source?.raw]) {
      if (record && Array.isArray(record.pos) && record.pos.length >= 2) {
        record.pos = [Number(record.pos[0]) + dx, Number(record.pos[1]) + dy]
      }
    }
    const id = rawTagId(tag)
    if (id === undefined || !Array.isArray(rawTags)) continue
    const source = rawTags.find((item: unknown) => item && typeof item === 'object' && Number((item as Record<string, unknown>).id) === id) as Record<string, unknown> | undefined
    if (source && Array.isArray(source.pos) && source.pos.length >= 2) source.pos = [Number(source.pos[0]) + dx, Number(source.pos[1]) + dy]
  }
}
