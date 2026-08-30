import type { ActualRouteProject, Station } from '../data/model'
import { getActiveLinesAtStation } from '../timeline/active'
import { getTransferMarkerRotation } from '../geometry/tangent'
import { getStationStyle } from './stationStyles'
import { StationLabel } from './StationLabel'

export function StationMarker({ project, station, time, selected, hitRadius = 24, onPointerDown, onLabelPointerDown }: {
  project: ActualRouteProject; station: Station; time: string; selected: boolean; hitRadius?: number
  onPointerDown: (event: React.PointerEvent) => void; onLabelPointerDown: (event: React.PointerEvent) => void
}) {
  const lines = getActiveLinesAtStation(project, station.id, time)
  const { stationSize, transferMinorAxis, transferDotGap, transferEndPadding } = project.settings
  const { stationStyleId } = project.settings
  const style = getStationStyle(stationStyleId)
  const selectionColor = lines[0]?.color ?? '#596161'
  const marker = lines.length > 1
    ? style.renderTransfer({ station, lines, size: stationSize, minorAxis: transferMinorAxis, dotGap: transferDotGap, endPadding: transferEndPadding, rotation: getTransferMarkerRotation(project, station.id, time) })
    : style.renderOrdinary({ station, size: stationSize })
  const selectionRadius = stationSize / 2 + 4
  return <g>
    <g onPointerDown={onPointerDown} className="station-hit" data-station-id={station.id} data-station-style={style.id} style={{ pointerEvents: 'all' }}>
      {marker}
      {selected && <circle className="station-selection-ring" cx={station.x} cy={station.y} r={selectionRadius} fill="none" stroke={selectionColor} strokeWidth={1.5} opacity={.58} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
      <circle className="station-hit-target" cx={station.x} cy={station.y} r={hitRadius} fill="transparent" pointerEvents="all" />
    </g>
    {project.settings.labelsVisible && !station.labelHidden && <StationLabel station={station} settings={project.settings} showForeign={project.settings.showForeignStationNames} onPointerDown={onLabelPointerDown} />}
  </g>
}
