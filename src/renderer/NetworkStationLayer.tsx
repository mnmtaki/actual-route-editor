import { memo, useMemo } from 'react'
import type { ActualRouteProject, Selection, Station } from '../data/model'
import { getEditorVisibleStationsAtTime } from '../timeline/active'
import { getCompoundStationCanonical } from '../data/compoundStation'
import { StationMarker } from './StationMarker'

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
 * Heavy station/label subtree kept separate from drag preview state. During a
 * station or label drag the stable base layer stays memoized and a tiny active
 * overlay redraws only the moving station, like AARC's active canvas.
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
  const stations = useMemo(
    () => getEditorVisibleStationsAtTime(project, project.timeline.currentDate),
    [project],
  )
  const visible = includeStationIds ? stations.filter(station => includeStationIds.has(station.id)) : stations
  const selectedIds = useMemo(() => new Set(selectedStationIds), [selectedStationIds])

  return <>
    {renderMarkers && <g
      data-layer={overlay ? 'stations-active-overlay' : 'stations'}
      data-static-network-layer={overlay ? undefined : 'stations'}
      pointerEvents={overlay ? 'none' : undefined}
    >
      {visible
        .filter(station => !excludeMarkerStationIds?.has(station.id))
        .map(station => <StationMarker
          key={station.id}
          part="marker"
          project={project}
          station={station}
          time={project.timeline.currentDate}
          selected={(selection?.type === 'station' && (selection.id === station.id || getCompoundStationCanonical(project, selection.id)?.id === station.id)) || selectedIds.has(station.id)}
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
      {visible
        .filter(station => !excludeLabelStationIds?.has(station.id))
        .map(station => <StationMarker
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
