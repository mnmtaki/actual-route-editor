import { memo, useMemo } from 'react'
import type { ActualRouteProject, Segment } from '../data/model'
import { getActiveNetworkAtTime } from '../timeline/active'
import { getSegmentPath, getSegmentSubpathSpans, pathSpansToSvgPath } from '../geometry/path'
import { SegmentArtwork, StructureRunArtwork } from './segmentStyles'
import { compileElevatedRuns, getSegmentStyleIntervals } from '../data/structure'
import { AarcFakeLinesLayer } from './AarcFakeLines'
import { compileAarcLineArtworkRuns } from './lineArtworkRuns'
import { isFakeLine } from '../data/fakeLines'
import { effectiveLineWidth } from '../data/style'
import { getLineStyle, resolveLineStyle } from '../data/lineStyles'
import { lineWithEffectiveColor } from '../data/lineIdentity'
import { projectWithLineParentsAt } from '../data/lineParentHistory'
import { projectWithLineColorsAt } from '../data/lineColorHistory'

export interface NetworkLineLayerProps {
  project: ActualRouteProject
  includeLineIds?: ReadonlySet<string>
  excludeArtworkLineIds?: ReadonlySet<string>
  renderHits?: boolean
  onSegmentPointerDown?: (event: React.PointerEvent<SVGPathElement>, segment: Segment) => void
  overlay?: boolean
}

/**
 * Heavy transit-line SVG subtree. Keeping this behind React.memo lets object
 * drags reuse the untouched network while a tiny overlay redraws only affected
 * lines, mirroring AARC's main-canvas / active-canvas split.
 */
export const NetworkLineLayer = memo(function NetworkLineLayer({
  project,
  includeLineIds,
  excludeArtworkLineIds,
  renderHits = true,
  onSegmentPointerDown,
  overlay = false,
}: NetworkLineLayerProps) {
  const active = useMemo(() => getActiveNetworkAtTime(project, project.timeline.currentDate), [project])
  const historicalIdentityProject = useMemo(
    () => projectWithLineColorsAt(projectWithLineParentsAt(project, project.timeline.currentDate), project.timeline.currentDate),
    [project],
  )
  const activeProject = useMemo(() => {
    const effectiveById = new Map(active.segments.map(segment => [segment.id, segment]))
    return {
      ...historicalIdentityProject,
      geometry: {
        ...project.geometry,
        segments: project.geometry.segments.map(segment => effectiveById.get(segment.id) ?? segment),
      },
    }
  }, [project.geometry, historicalIdentityProject, active.segments])
  const segmentsByLineId = useMemo(() => {
    const grouped = new Map<string, Segment[]>()
    for (const segment of active.segments) {
      const bucket = grouped.get(segment.lineId)
      if (bucket) bucket.push(segment)
      else grouped.set(segment.lineId, [segment])
    }
    return grouped
  }, [active.segments])
  const elevatedRuns = useMemo(
    () => compileElevatedRuns(activeProject, new Set(active.segments.map(segment => segment.id))),
    [activeProject, active.segments],
  )
  const lineAllowed = (lineId: string) => !includeLineIds || includeLineIds.has(lineId)
  const artworkAllowed = (lineId: string) => lineAllowed(lineId) && !excludeArtworkLineIds?.has(lineId)

  return <>
    <g data-layer={overlay ? 'segments-active-overlay' : 'segments'} data-static-network-layer={overlay ? undefined : 'lines'} pointerEvents={overlay ? 'none' : undefined}>
      {active.lines.flatMap(rawLine => {
        if (!lineAllowed(rawLine.id)) return []
        const sourceId = Number(rawLine.source?.sourceLineId ?? rawLine.source?.lineId)
        const showArtwork = artworkAllowed(rawLine.id)
        if (isFakeLine(rawLine) && rawLine.source?.format === 'aarc' && Number.isFinite(sourceId)) {
          return showArtwork
            ? [<AarcFakeLinesLayer key={`fake-common-${rawLine.id}`} project={project} part="common" sourceLineId={sourceId} />]
            : []
        }

        const line = lineWithEffectiveColor(project, rawLine, project.timeline.currentDate)
        const lineSegments = segmentsByLineId.get(rawLine.id) ?? []
        const hitPaths = renderHits && onSegmentPointerDown
          ? lineSegments.map(segment => <path
              key={`hit:${segment.id}`}
              d={getSegmentPath(project, segment)}
              className="segment-hit"
              onPointerDown={event => onSegmentPointerDown(event, segment)}
            />)
          : []

        if (rawLine.source?.format === 'aarc') {
          const runs = showArtwork ? compileAarcLineArtworkRuns(project, line, lineSegments) : []
          return [<g key={rawLine.id} data-aarc-continuous-line={rawLine.id}>
            {runs.map(run => <SegmentArtwork
              key={run.id}
              segment={run.segment}
              line={line}
              path={run.path}
              lineWidth={effectiveLineWidth(line, project.settings)}
              renderLegacyStructure={false}
              style={resolveLineStyle(project, line, run.segment)}
            />)}
            {hitPaths}
          </g>]
        }

        return lineSegments.map(segment => {
          const intervals = showArtwork ? getSegmentStyleIntervals(project, segment) : []
          return <g key={segment.id}>
            {intervals.map((interval, index) => {
              const spans = getSegmentSubpathSpans(project, segment, interval.start, interval.end)
              if (!spans.length) return null
              const intervalPath = pathSpansToSvgPath(spans)
              const intervalSegment = { ...segment, structureType: interval.structureType, lineStyleId: interval.lineStyleId }
              return <SegmentArtwork
                key={`${segment.id}:${index}`}
                segment={intervalSegment}
                line={line}
                path={intervalPath}
                lineWidth={effectiveLineWidth(line, project.settings)}
                renderLegacyStructure={false}
                style={resolveLineStyle(project, line, interval.lineStyleId === undefined ? undefined : intervalSegment)}
              />
            })}
            {hitPaths.find(item => item.key === `hit:${segment.id}`)}
          </g>
        })
      })}
    </g>
    <g data-layer={overlay ? 'structure-runs-active-overlay' : 'structure-runs'} data-static-network-layer={overlay ? undefined : 'structure-runs'} pointerEvents={overlay ? 'none' : undefined}>
      {elevatedRuns
        .filter(run => artworkAllowed(run.lineId))
        .map(run => {
          const rawLine = project.lines.find(item => item.id === run.lineId)
          const line = rawLine ? lineWithEffectiveColor(project, rawLine, project.timeline.currentDate) : undefined
          return line
            ? <StructureRunArtwork
                key={run.id}
                run={run}
                line={line}
                lineWidth={effectiveLineWidth(line, project.settings)}
                style={getLineStyle(project, 'elevated')}
              />
            : null
        })}
    </g>
  </>
})
