import type { ActualRouteProject, Line } from './model'

export type AarcCommonLineCap = 'butt' | 'round' | 'square'

function rootLine(project: ActualRouteProject, line: Line): Line {
  const byId = new Map(project.lines.map(item => [item.id, item]))
  const seen = new Set<string>()
  let current = line
  while (current.parentLineId && !seen.has(current.id)) {
    seen.add(current.id)
    const parent = byId.get(current.parentLineId)
    if (!parent) break
    current = parent
  }
  return current
}

function isAarcLine(line: Line | undefined): line is Line {
  return line?.source?.format === 'aarc'
}

/**
 * AARC sorts top-level common lines by zIndex and then renders each root line
 * together with its child lines. Only AARC-derived items are reordered here;
 * native ActualRoute items keep their existing slots and relative order.
 */
export function sortByAarcCommonLineZIndex<T>(
  project: ActualRouteProject,
  values: readonly T[],
  getLineId: (value: T) => string,
): T[] {
  const lineById = new Map(project.lines.map(line => [line.id, line]))
  const lineIndex = new Map(project.lines.map((line, index) => [line.id, index]))
  const decorated = values.map((value, index) => ({ value, index, line: lineById.get(getLineId(value)) }))
  const slots = decorated.filter(item => isAarcLine(item.line)).map(item => item.index)
  if (slots.length < 2) return values.slice()

  const sorted = decorated
    .filter((item): item is typeof item & { line: Line } => isAarcLine(item.line))
    .sort((a, b) => {
      const rootA = rootLine(project, a.line)
      const rootB = rootLine(project, b.line)
      const zA = Number(rootA.source?.sourceZIndex)
      const zB = Number(rootB.source?.sourceZIndex)
      const effectiveZA = Number.isFinite(zA) ? zA : 0
      const effectiveZB = Number.isFinite(zB) ? zB : 0
      if (effectiveZA !== effectiveZB) return effectiveZA - effectiveZB

      const rootIndexA = lineIndex.get(rootA.id) ?? Number.MAX_SAFE_INTEGER
      const rootIndexB = lineIndex.get(rootB.id) ?? Number.MAX_SAFE_INTEGER
      if (rootIndexA !== rootIndexB) return rootIndexA - rootIndexB

      const lineIndexA = lineIndex.get(a.line.id) ?? Number.MAX_SAFE_INTEGER
      const lineIndexB = lineIndex.get(b.line.id) ?? Number.MAX_SAFE_INTEGER
      if (lineIndexA !== lineIndexB) return lineIndexA - lineIndexB

      return a.index - b.index
    })

  const result = values.slice()
  slots.forEach((slot, index) => { result[slot] = sorted[index].value })
  return result
}

/** AARC common lines default to butt caps; native ActualRoute lines stay round. */
export function resolveAarcCommonLineCap(line: Line): AarcCommonLineCap {
  if (line.source?.format !== 'aarc') return 'round'
  const cap = line.source.raw?.cap
  return cap === 'round' || cap === 'square' || cap === 'butt' ? cap : 'butt'
}
