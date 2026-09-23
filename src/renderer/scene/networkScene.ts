import type { ActualRouteProject, Line, LineStyle, Segment, Selection, Station } from '../../data/model'
import { getCompoundStationCanonical } from '../../data/compoundStation'
import { isFakeLine } from '../../data/fakeLines'
import { getLineStyle, resolveLineStyle } from '../../data/lineStyles'
import { lineWithEffectiveColor } from '../../data/lineIdentity'
import { projectWithLineColorsAt } from '../../data/lineColorHistory'
import { projectWithLineParentsAt } from '../../data/lineParentHistory'
import { effectiveLineWidth } from '../../data/style'
import { compileElevatedRuns, getSegmentStyleIntervals, type StructureRun } from '../../data/structure'
import { getSegmentPath, getSegmentSubpathSpans, pathSpansToSvgPath } from '../../geometry/path'
import { getActiveNetworkAtTime, getEditorVisibleStationsAtTime } from '../../timeline/active'
import { compileAarcLineArtworkRuns } from '../lineArtworkRuns'

export interface NetworkLineSceneArtwork {
  id: string
  segment: Segment
  line: Line
  path: string
  lineWidth: number
  style: LineStyle | null
}

export interface NetworkLineSceneHit {
  segment: Segment
  path: string
}

export type NetworkLineSceneItem =
  | {
      kind: 'fake-aarc'
      id: string
      lineId: string
      sourceLineId: number
    }
  | {
      kind: 'line'
      id: string
      lineId: string
      aarcContinuous: boolean
      artworks: NetworkLineSceneArtwork[]
      hits: NetworkLineSceneHit[]
    }

export interface NetworkStructureSceneItem {
  id: string
  run: StructureRun
  line: Line
  lineWidth: number
  style: LineStyle
}

export interface NetworkLineScene {
  lines: NetworkLineSceneItem[]
  structures: NetworkStructureSceneItem[]
}

export interface NetworkStationSceneMarker {
  station: Station
  selected: boolean
}

export interface NetworkStationScene {
  markers: NetworkStationSceneMarker[]
  labels: Station[]
}

/**
 * Compile the heavy transit geometry into renderer-neutral drawing data.
 * SVG and a future Canvas renderer should consume the same scene instead of
 * repeating timeline, line-style and path calculations independently.
 */
export function compileNetworkLineScene(
  project: ActualRouteProject,
  includeLineIds?: ReadonlySet<string>,
  excludeArtworkLineIds?: ReadonlySet<string>,
): NetworkLineScene {
  const active = getActiveNetworkAtTime(project, project.timeline.currentDate)
  const historicalIdentityProject = projectWithLineColorsAt(
    projectWithLineParentsAt(project, project.timeline.currentDate),
    project.timeline.currentDate,
  )
  const effectiveById = new Map(active.segments.map(segment => [segment.id, segment]))
  const activeProject: ActualRouteProject = {
    ...historicalIdentityProject,
    geometry: {
      ...project.geometry,
      segments: project.geometry.segments.map(segment => effectiveById.get(segment.id) ?? segment),
    },
  }

  const segmentsByLineId = new Map<string, Segment[]>()
  for (const segment of active.segments) {
    const bucket = segmentsByLineId.get(segment.lineId)
    if (bucket) bucket.push(segment)
    else segmentsByLineId.set(segment.lineId, [segment])
  }

  const lineAllowed = (lineId: string) => !includeLineIds || includeLineIds.has(lineId)
  const artworkAllowed = (lineId: string) => lineAllowed(lineId) && !excludeArtworkLineIds?.has(lineId)
  const lines: NetworkLineSceneItem[] = []

  for (const rawLine of active.lines) {
    if (!lineAllowed(rawLine.id)) continue
    const sourceId = Number(rawLine.source?.sourceLineId ?? rawLine.source?.lineId)
    const showArtwork = artworkAllowed(rawLine.id)

    if (isFakeLine(rawLine) && rawLine.source?.format === 'aarc' && Number.isFinite(sourceId)) {
      if (showArtwork) lines.push({ kind: 'fake-aarc', id: `fake-common-${rawLine.id}`, lineId: rawLine.id, sourceLineId: sourceId })
      continue
    }

    const line = lineWithEffectiveColor(project, rawLine, project.timeline.currentDate)
    const lineSegments = segmentsByLineId.get(rawLine.id) ?? []
    const hits = lineSegments.map(segment => ({ segment, path: getSegmentPath(project, segment) }))

    if (rawLine.source?.format === 'aarc') {
      const artworks = showArtwork
        ? compileAarcLineArtworkRuns(project, line, lineSegments).map(run => ({
            id: run.id,
            segment: run.segment,
            line,
            path: run.path,
            lineWidth: effectiveLineWidth(line, project.settings),
            style: resolveLineStyle(project, line, run.segment),
          }))
        : []
      lines.push({ kind: 'line', id: rawLine.id, lineId: rawLine.id, aarcContinuous: true, artworks, hits })
      continue
    }

    for (const segment of lineSegments) {
      const artworks: NetworkLineSceneArtwork[] = []
      if (showArtwork) {
        getSegmentStyleIntervals(project, segment).forEach((interval, index) => {
          const spans = getSegmentSubpathSpans(project, segment, interval.start, interval.end)
          if (!spans.length) return
          const intervalSegment: Segment = { ...segment, structureType: interval.structureType, lineStyleId: interval.lineStyleId }
          artworks.push({
            id: `${segment.id}:${index}`,
            segment: intervalSegment,
            line,
            path: pathSpansToSvgPath(spans),
            lineWidth: effectiveLineWidth(line, project.settings),
            style: resolveLineStyle(project, line, interval.lineStyleId === undefined ? undefined : intervalSegment),
          })
        })
      }
      lines.push({
        kind: 'line',
        id: segment.id,
        lineId: rawLine.id,
        aarcContinuous: false,
        artworks,
        hits: hits.filter(hit => hit.segment.id === segment.id),
      })
    }
  }

  const structures = compileElevatedRuns(activeProject, new Set(active.segments.map(segment => segment.id)))
    .filter(run => artworkAllowed(run.lineId))
    .flatMap(run => {
      const rawLine = project.lines.find(item => item.id === run.lineId)
      if (!rawLine) return []
      const line = lineWithEffectiveColor(project, rawLine, project.timeline.currentDate)
      return [{
        id: run.id,
        run,
        line,
        lineWidth: effectiveLineWidth(line, project.settings),
        style: getLineStyle(project, 'elevated'),
      }]
    })

  return { lines, structures }
}

/**
 * Compile visible station membership and selection state separately from JSX.
 * Marker artwork remains in StationMarker for now; this is the first seam for
 * moving station drawing into the shared scene without changing behavior.
 */
export function compileNetworkStationScene(
  project: ActualRouteProject,
  selection: Selection,
  selectedStationIds: readonly string[],
  includeStationIds?: ReadonlySet<string>,
  excludeMarkerStationIds?: ReadonlySet<string>,
  excludeLabelStationIds?: ReadonlySet<string>,
): NetworkStationScene {
  const stations = getEditorVisibleStationsAtTime(project, project.timeline.currentDate)
  const visible = includeStationIds ? stations.filter(station => includeStationIds.has(station.id)) : stations
  const selectedIds = new Set(selectedStationIds)
  const selectedCanonicalId = selection?.type === 'station'
    ? getCompoundStationCanonical(project, selection.id)?.id
    : undefined

  return {
    markers: visible
      .filter(station => !excludeMarkerStationIds?.has(station.id))
      .map(station => ({
        station,
        selected: (selection?.type === 'station' && (selection.id === station.id || selectedCanonicalId === station.id)) || selectedIds.has(station.id),
      })),
    labels: visible.filter(station => !excludeLabelStationIds?.has(station.id)),
  }
}
