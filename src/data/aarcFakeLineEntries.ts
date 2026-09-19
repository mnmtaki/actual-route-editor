import type { ActualRouteProject, Line } from './model'
import { resolveAarcLineMetrics } from '../import-export/aarcNormalize'

function finite(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}
function sourceLines(project: ActualRouteProject): Array<Record<string, unknown>> {
  const raw = project.aarc?.raw?.lines
  return Array.isArray(raw) ? raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : []
}
function sourceConfig(project: ActualRouteProject): Record<string, unknown> {
  const rawConfig = project.aarc?.raw?.config
  const value = project.aarc?.config ?? rawConfig
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function resolveEffectiveStyleId(raw: Record<string, unknown>, allLines: Array<Record<string, unknown>>, seen = new Set<number>()): number | undefined {
  const own = finite(raw.style)
  if (own !== undefined && own !== -1) return own
  const lineId = finite(raw.id), parentId = finite(raw.parent)
  if (lineId !== undefined) {
    if (seen.has(lineId)) return undefined
    seen.add(lineId)
  }
  const parent = parentId === undefined ? undefined : allLines.find(line => finite(line.id) === parentId)
  return parent ? resolveEffectiveStyleId(parent, allLines, seen) : undefined
}

/**
 * AARC keeps fake common lines in save.lines and shows them in its line list.
 * ActualRoute keeps their source-faithful geometry in AarcFakeLines, while a
 * lightweight native Line entry makes them selectable/editable in the normal
 * line UI without creating passenger relations.
 */
export function materializeAarcFakeLineEntries(project: ActualRouteProject): ActualRouteProject {
  const rawLines = sourceLines(project)
  const candidates = rawLines.filter(line => line.isFake === true && Number(line.type ?? 0) !== 1 && Array.isArray(line.pts) && line.pts.length >= 2)
  if (!candidates.length) return project
  const existingSourceIds = new Set(project.lines.map(line => finite(line.source?.sourceLineId ?? line.source?.lineId)).filter((id): id is number => id !== undefined))
  const nativeIdBySourceId = new Map(project.lines.flatMap(line => { const sourceId = finite(line.source?.sourceLineId ?? line.source?.lineId); return sourceId === undefined ? [] : [[sourceId, line.id] as const] }))
  for (const raw of candidates) { const sourceLineId = finite(raw.id); if (sourceLineId !== undefined && !nativeIdBySourceId.has(sourceLineId)) nativeIdBySourceId.set(sourceLineId, `aarc-line-${sourceLineId}`) }
  const additions: Line[] = []
  for (const [sourceOrder, raw] of rawLines.entries()) {
    if (!candidates.includes(raw)) continue
    const sourceLineId = finite(raw.id)
    if (sourceLineId === undefined || existingSourceIds.has(sourceLineId)) continue
    const parentSourceId = finite(raw.parent)
    const parentLineId = parentSourceId === undefined ? undefined : nativeIdBySourceId.get(parentSourceId)
    const metrics = resolveAarcLineMetrics(raw, sourceConfig(project))
    const effectiveStyleId = resolveEffectiveStyleId(raw, rawLines)
    additions.push({
      id: `aarc-line-${sourceLineId}`,
      name: typeof raw.name === 'string' ? raw.name : '',
      ...(typeof raw.nameSub === 'string' && raw.nameSub ? { nameSub: raw.nameSub } : {}),
      color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#64748b',
      ...(effectiveStyleId !== undefined ? { lineStyleId: String(effectiveStyleId) } : {}),
      ...(parentLineId ? { parentLineId } : {}),
      isFake: true,
      stationSequence: [],
      lineOrder: project.lines.length + sourceOrder,
      visible: true,
      locked: false,
      source: {
        format: 'aarc',
        lineId: sourceLineId,
        sourceLineId,
        sourceWidthRatio: metrics.widthRatio,
        sourcePhysicalWidth: metrics.bodyWidth,
        sourceColor: typeof raw.color === 'string' ? raw.color : undefined,
        sourceColorPre: finite(raw.colorPre),
        sourceStyleId: finite(raw.style),
        sourceParentId: parentSourceId,
        sourceZIndex: finite(raw.zIndex),
        raw: structuredClone(raw),
      },
    })
    existingSourceIds.add(sourceLineId)
  }
  if (!additions.length) return project
  const next = structuredClone(project)
  next.lines.push(...additions)
  return next
}
