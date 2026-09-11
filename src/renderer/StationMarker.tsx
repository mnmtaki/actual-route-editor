import type { ActualRouteProject, Station } from '../data/model'
import { getPassengerLinesAtStation, getPassengerVisibleRelationIds } from '../timeline/active'
import { getTransferMarkerLayout } from '../geometry/tangent'
import { sortTransferLinesForSpatialOrder } from '../geometry/transferOrdering'
import { getStationStyle } from './stationStyles'
import { resolveStationStyle } from '../data/stationStyles'
import { StationLabel } from './StationLabel'
import { effectiveStationStyle } from '../data/style'
import { lineWithEffectiveColor } from '../data/lineIdentity'
import { getCompoundStationCanonical, isCompoundStationCanonical } from '../data/compoundStation'

export function StationMarker({ project, station, time, selected, hitRadius = 24, onPointerDown, onLabelPointerDown }: {
  project: ActualRouteProject; station: Station; time: string; selected: boolean; hitRadius?: number
  onPointerDown: (event: React.PointerEvent) => void; onLabelPointerDown: (event: React.PointerEvent) => void
}) {
  const canonical = getCompoundStationCanonical(project, station)
  if (canonical && !isCompoundStationCanonical(project, station)) return <g className="compound-station-member-hit" data-compound-member-id={station.id} onPointerDown={onPointerDown}>
    <circle className="station-hit-target" cx={station.x} cy={station.y} r={hitRadius} fill="transparent" pointerEvents="all" />
  </g>
  const renderStation = canonical ?? station
  const lines = getPassengerLinesAtStation(project, renderStation.id, time)
  const renderLines = lines.length > 1
    ? sortTransferLinesForSpatialOrder(project, renderStation.id, lines, time).map(line => lineWithEffectiveColor(project, line))
    : lines.map(line => lineWithEffectiveColor(project, line))
  const { stationSize, transferMinorAxis, transferDotGap, transferEndPadding } = effectiveStationStyle(renderStation, project.settings)
  // Transfer stations keep the established capsule renderer. Ordinary stations
  // resolve their project/station style through the shared style registry.
  const transferStyle = getStationStyle('default')
  const stationStyle = resolveStationStyle(project, renderStation)
  const selectionColor = renderLines[0]?.color ?? '#596161'
  const visibleRelationIds = lines.length > 1 ? getPassengerVisibleRelationIds(project, renderStation.id, time, lines.map(line => line.id)) : undefined
  const transferLayout = lines.length > 1 ? getTransferMarkerLayout(project, renderStation.id, time, visibleRelationIds, transferEndPadding) : null
  const marker = lines.length > 1
    ? transferStyle.renderTransfer({ station: renderStation, lines: renderLines, size: stationSize, minorAxis: transferMinorAxis, dotGap: transferDotGap, endPadding: transferEndPadding, rotation: transferLayout?.rotation ?? 0, centerX: transferLayout?.centerX, centerY: transferLayout?.centerY, minMajorAxis: transferLayout?.anchorSpan })
    : transferStyle.renderOrdinary({ station: renderStation, size: stationStyle.width, style: stationStyle, lineColor: selectionColor })
  const selectionRadius = (lines.length > 1 ? stationSize : Math.max(stationStyle.width, stationStyle.height)) / 2 + 4
  return <g>
    <g onPointerDown={onPointerDown} className="station-hit" data-station-id={station.id} data-station-style={lines.length > 1 ? transferStyle.id : stationStyle.id} style={{ pointerEvents: 'all' }}>
      {marker}
      {selected && <circle className="station-selection-ring" cx={station.x} cy={station.y} r={selectionRadius} fill="none" stroke={selectionColor} strokeWidth={1.5} opacity={.58} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
      <circle className="station-hit-target" cx={station.x} cy={station.y} r={hitRadius} fill="transparent" pointerEvents="all" />
    </g>
    {project.settings.labelsVisible && !renderStation.labelHidden && <StationLabel station={renderStation} settings={project.settings} showForeign={project.settings.showForeignStationNames} onPointerDown={onLabelPointerDown} />}
  </g>
}
