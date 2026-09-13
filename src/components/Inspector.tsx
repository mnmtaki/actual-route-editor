import type { ActualRouteProject, Selection } from '../data/model'
import type { OpeningPhasePath } from '../data/openingPhases'
import { Inspector as LegacyInspector } from './InspectorLegacy'
import { StyleGeometryInspector } from './StyleGeometryInspector'

export function Inspector(props: {
  project: ActualRouteProject
  selection: Selection
  onChange: (next: ActualRouteProject) => void
  onDelete: () => void
  onAddLineBadge?: (lineId: string) => void
  onPhasePreview: (path: OpeningPhasePath | null) => void
  onStartPhaseDrawing: (phaseId: string, lineId: string, stationId: string | null) => void
  onOpenStationStyles?: () => void
  embedded?: boolean
}) {
  if (props.selection?.type === 'segment' || props.selection?.type === 'waypoint' || props.selection?.type === 'structureNode') {
    return <StyleGeometryInspector project={props.project} selection={props.selection} onChange={props.onChange} onDelete={props.onDelete} embedded={props.embedded} />
  }
  return <LegacyInspector {...props} />
}
