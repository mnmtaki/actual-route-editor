import type { ActualRouteProject, Road } from '../data/model'
import { sortedVectorBasemapObjects } from '../data/roads'
import { BasemapPathArtwork } from './BasemapPaths'
import { RoadArtwork } from './Roads'

export function VectorBasemapLayer({
  project,
  presentation = false,
  selectedId,
  hitRadius = 22,
  draft,
  onPathPointerDown,
  onPointPointerDown,
  onRoadPointerDown,
  onRoadPointPointerDown,
}: {
  project: ActualRouteProject
  presentation?: boolean
  selectedId?: string
  hitRadius?: number
  draft?: Road | null
  onPathPointerDown?: React.ComponentProps<typeof BasemapPathArtwork>['onPathPointerDown']
  onPointPointerDown?: React.ComponentProps<typeof BasemapPathArtwork>['onPointPointerDown']
  onRoadPointerDown?: React.ComponentProps<typeof RoadArtwork>['onPointerDown']
  onRoadPointPointerDown?: React.ComponentProps<typeof RoadArtwork>['onPointPointerDown']
}) {
  return <g data-layer="vector-basemap">
    {sortedVectorBasemapObjects(project).map(item => {
      if (item.kind === 'basemap') {
        const path = item.object as import('../data/model').BasemapPath
        if (!path.visible) return null
        return <BasemapPathArtwork key={`basemap-${path.id}`} path={path} presentation={presentation} selected={selectedId === path.id} hitRadius={hitRadius} onPathPointerDown={onPathPointerDown} onPointPointerDown={onPointPointerDown} />
      }
      const road = item.object as Road
      if (!road.visible) return null
      return <RoadArtwork key={`road-${road.id}`} road={road} project={project} presentation={presentation} selected={selectedId === road.id} hitRadius={hitRadius} onPointerDown={onRoadPointerDown} onPointPointerDown={onRoadPointPointerDown} />
    })}
    {draft && <RoadArtwork road={draft} project={project} presentation={false} selected hitRadius={hitRadius} onPointerDown={onRoadPointerDown} onPointPointerDown={onRoadPointPointerDown} />}
  </g>
}
