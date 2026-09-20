import { memo } from 'react'
import type { ActualRouteProject, Road } from '../data/model'
import { sortedVectorBasemapObjects } from '../data/roads'
import { AarcTerrainTransitionsArtwork, BasemapPathArtwork } from './BasemapPaths'
import { RoadArtwork } from './Roads'
import { AarcTextTagsLayer } from './AarcTextTags'
import { AarcFakeLinesLayer } from './AarcFakeLines'

export const VectorBasemapLayer = memo(function VectorBasemapLayer({
  project,
  presentation = false,
  visibleLineIds,
  selectedId,
  hitRadius = 22,
  draft,
  onPathPointerDown,
  onPointPointerDown,
  onRoadPointerDown,
  onRoadPointPointerDown,
  includeObjectIds,
  excludeObjectIds,
  overlay = false,
}: {
  project: ActualRouteProject
  presentation?: boolean
  visibleLineIds?: Set<string>
  selectedId?: string
  hitRadius?: number
  draft?: Road | null
  onPathPointerDown?: React.ComponentProps<typeof BasemapPathArtwork>['onPathPointerDown']
  onPointPointerDown?: React.ComponentProps<typeof BasemapPathArtwork>['onPointPointerDown']
  onRoadPointerDown?: React.ComponentProps<typeof RoadArtwork>['onPointerDown']
  onRoadPointPointerDown?: React.ComponentProps<typeof RoadArtwork>['onPointPointerDown']
  includeObjectIds?: ReadonlySet<string>
  excludeObjectIds?: ReadonlySet<string>
  overlay?: boolean
}) {
  const objectVisible = (id: string) => (!includeObjectIds || includeObjectIds.has(id)) && !excludeObjectIds?.has(id)
  return <g data-layer={overlay ? "vector-basemap-active-overlay" : "vector-basemap"} pointerEvents={overlay ? "none" : undefined}>
    {!overlay && <AarcTerrainTransitionsArtwork project={project} part="carpet" />}
    {sortedVectorBasemapObjects(project).filter(item => objectVisible(item.object.id)).map(item => {
      if (item.kind === 'basemap') {
        const path = item.object as import('../data/model').BasemapPath
        if (!path.visible) return null
        return <BasemapPathArtwork key={`basemap-${path.id}`} path={path} presentation={presentation} selected={selectedId === path.id} hitRadius={hitRadius} onPathPointerDown={onPathPointerDown} onPointPointerDown={onPointPointerDown} />
      }
      const road = item.object as Road
      if (!road.visible) return null
      return <RoadArtwork key={`road-${road.id}`} road={road} project={project} presentation={presentation} selected={selectedId === road.id} hitRadius={hitRadius} onPointerDown={onRoadPointerDown} onPointPointerDown={onRoadPointPointerDown} />
    })}
    {!overlay && <AarcTerrainTransitionsArtwork project={project} part="body" />}
    {!overlay && <AarcFakeLinesLayer project={project} part="terrain" />}
    {!overlay && <AarcTextTagsLayer project={project} presentation={presentation} visibleLineIds={visibleLineIds} mode="sunken" />}
    {!overlay && draft && <RoadArtwork road={draft} project={project} presentation={false} selected hitRadius={hitRadius} onPointerDown={onRoadPointerDown} onPointPointerDown={onRoadPointPointerDown} />}
  </g>
})
