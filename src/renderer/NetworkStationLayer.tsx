import { memo, useMemo } from 'react'
import type { ActualRouteProject, Selection, Station } from '../data/model'
import { StationMarker } from './StationMarker'
import { compileNetworkStationScene } from './scene/networkScene'

export interface NetworkStationLayerProps {
  project: ActualRouteProject
  selection: Selection
  selectedStationIds: readonly string[]
  hitRadius: number
  includeStationIds?: ReadonlySet<string>
  excludeMarkerStationIds?: ReadonlySet<string>
  excludeLabelStationIds?: ReadonlySet<string>
  renderMarkers?: boolean
  renderLabels?: boolean
  overlay?: boolean
  onStationPointerDown?: (event: React.PointerEvent, station: Station) => void
  onLabelPointerDown?: (event: React.PointerEvent, station: Station) => void
}

/**
 * SVG adapter for station scene membership. Station visibility and selection
 * are compiled outside JSX so the same scene can later feed Canvas rendering.
 */
export const NetworkStationLayer = memo(function NetworkStationLayer({
  project,
  selection,
  selectedStationIds,
  hitRadius,
  includeStationIds,
  excludeMarkerStationIds,
  excludeLabelStationIds,
  renderMarkers = true,
  renderLabels = true,
  overlay = false,
  onStationPointerDown,
  onLabelPointerDown,
}: NetworkStationLayerProps) {
  const scene = useMemo(
    () => compileNetworkStationScene(
      project,
      selection,
      selectedStationIds,
      includeStationIds,
      excludeMarkerStationIds,
      excludeLabelStationIds,
    ),
    [project, selection, selectedStationIds, includeStationIds, excludeMarkerStationIds, excludeLabelStationIds],
  )

  return <>
    {renderMarkers && <g
      data-layer={overlay ? 'stations-active-overlay' : 'stations'}
      data-static-network-layer={overlay ? undefined : 'stations'}
      pointerEvents={overlay ? 'none' : undefined}
    >
      {scene.markers.map(({ station, selected }) => <StationMarker
        key={station.id}
        part="marker"
        project={project}
        station={station}
        time={project.timeline.currentDate}
        selected={selected}
        hitRadius={hitRadius}
        onPointerDown={event => onStationPointerDown?.(event, station)}
        onLabelPointerDown={event => onLabelPointerDown?.(event, station)}
      />)}
    </g>}
    {renderLabels && <g
      data-layer={overlay ? 'station-labels-active-overlay' : 'station-labels'}
      data-static-network-layer={overlay ? undefined : 'station-labels'}
      pointerEvents={overlay ? 'none' : undefined}
    >
      {scene.labels.map(station => <StationMarker
        key={station.id}
        part="label"
        project={project}
        station={station}
        time={project.timeline.currentDate}
        selected={false}
        hitRadius={hitRadius}
        onPointerDown={() => {}}
        onLabelPointerDown={event => onLabelPointerDown?.(event, station)}
      />)}
    </g>}
  </>
})
