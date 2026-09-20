import type { ActualRouteProject, Line, Segment, StructureType } from '../data/model'
import { getSegmentSubpathSpans, pathSpansToSvgPath, reversePathSpans, type PathSpan } from '../geometry/path'
import { getSegmentStyleIntervals } from '../data/structure'
import { resolveLineStyle } from '../data/lineStyles'

const EPSILON = 1e-5

interface Fragment {
  id: string
  order: number
  segment: Segment
  segmentId: string
  startKey: string
  endKey: string
  spans: PathSpan[]
  structureType: StructureType
  lineStyleId?: string | null
  stateKey: string
}

export interface AarcLineArtworkRun {
  id: string
  lineId: string
  segmentIds: string[]
  segment: Segment
  path: string
  structureType: StructureType
  lineStyleId?: string | null
  closed: boolean
}

/**
 * AARC paints one continuous line/span path. ActualRoute stores station-to-
 * station geometry as separate Segments, so painting each Segment separately
 * incorrectly creates a cap at every station. Rejoin adjacent AARC fragments
 * that have the same effective visual state before stroking them.
 */
export function compileAarcLineArtworkRuns(
  project: ActualRouteProject,
  line: Line,
  segments: readonly Segment[],
): AarcLineArtworkRun[] {
  if (line.source?.format !== 'aarc') return []
  const fragments: Fragment[] = []

  segments.forEach((segment, segmentIndex) => {
    getSegmentStyleIntervals(project, segment).forEach((interval, intervalIndex) => {
      const spans = getSegmentSubpathSpans(project, segment, interval.start, interval.end)
      if (!spans.length) return
      const intervalSegment: Segment = { ...segment, structureType: interval.structureType, lineStyleId: interval.lineStyleId }
      const style = resolveLineStyle(project, line, intervalSegment)
      const styleKey = style === null ? '__base_only__' : style.id
      const startKey = interval.start <= EPSILON ? `station:${segment.fromStationId}` : `node:${segment.id}:${interval.start.toFixed(6)}`
      const endKey = interval.end >= 1 - EPSILON ? `station:${segment.toStationId}` : `node:${segment.id}:${interval.end.toFixed(6)}`
      const sourceOrder = Number(segment.source?.raw?.sourceSegmentIndex)
      const order = (Number.isFinite(sourceOrder) ? sourceOrder : segmentIndex) * 1000 + interval.start
      fragments.push({
        id: `${segment.id}:${intervalIndex}`,
        order,
        segment: intervalSegment,
        segmentId: segment.id,
        startKey,
        endKey,
        spans,
        structureType: interval.structureType,
        lineStyleId: interval.lineStyleId,
        stateKey: `${interval.structureType}|${styleKey}`,
      })
    })
  })

  const result: AarcLineArtworkRun[] = []
  const byState = new Map<string, Fragment[]>()
  for (const fragment of fragments) {
    const list = byState.get(fragment.stateKey) ?? []
    list.push(fragment)
    byState.set(fragment.stateKey, list)
  }

  for (const stateFragments of byState.values()) {
    const adjacency = new Map<string, number[]>()
    stateFragments.forEach((fragment, index) => {
      adjacency.set(fragment.startKey, [...(adjacency.get(fragment.startKey) ?? []), index])
      adjacency.set(fragment.endKey, [...(adjacency.get(fragment.endKey) ?? []), index])
    })
    const unused = new Set(stateFragments.map((_, index) => index))
    while (unused.size) {
      const firstIndex = [...unused].sort((a, b) => stateFragments[a].order - stateFragments[b].order || stateFragments[a].id.localeCompare(stateFragments[b].id))[0]
      const first = stateFragments[firstIndex]
      const startKey = (adjacency.get(first.startKey)?.length ?? 0) !== 2 && (adjacency.get(first.endKey)?.length ?? 0) === 2
        ? first.startKey
        : (adjacency.get(first.endKey)?.length ?? 0) !== 2 && (adjacency.get(first.startKey)?.length ?? 0) === 2
          ? first.endKey
          : first.startKey
      let currentKey = startKey
      let currentIndex = firstIndex
      const spans: PathSpan[] = []
      const segmentIds: string[] = []
      let representative = first
      let endKey = startKey
      let minOrder = first.order

      while (unused.has(currentIndex)) {
        unused.delete(currentIndex)
        const fragment = stateFragments[currentIndex]
        if (fragment.order < minOrder) { minOrder = fragment.order; representative = fragment }
        const forward = fragment.startKey === currentKey
        spans.push(...(forward ? fragment.spans : reversePathSpans(fragment.spans)))
        if (!segmentIds.includes(fragment.segmentId)) segmentIds.push(fragment.segmentId)
        endKey = forward ? fragment.endKey : fragment.startKey
        const neighbors = adjacency.get(endKey) ?? []
        const candidates = neighbors.filter(index => unused.has(index))
        if (neighbors.length !== 2 || candidates.length !== 1) break
        currentKey = endKey
        currentIndex = candidates[0]
      }

      if (!spans.length) continue
      const closed = endKey === startKey
      const basePath = pathSpansToSvgPath(spans)
      result.push({
        id: `aarc-run-${line.id}-${result.length}`,
        lineId: line.id,
        segmentIds,
        segment: representative.segment,
        path: closed ? `${basePath} Z` : basePath,
        structureType: representative.structureType,
        lineStyleId: representative.lineStyleId,
        closed,
      })
    }
  }

  return result.sort((a, b) => {
    const aFirst = fragments.find(fragment => a.segmentIds.includes(fragment.segmentId))?.order ?? 0
    const bFirst = fragments.find(fragment => b.segmentIds.includes(fragment.segmentId))?.order ?? 0
    return aFirst - bFirst || a.id.localeCompare(b.id)
  })
}
