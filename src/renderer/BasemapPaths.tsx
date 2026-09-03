import type { ActualRouteProject, BasemapPath } from '../data/model'
import { getBasemapPathD, sortedBasemapPaths } from '../data/basemapPaths'

export function BasemapPathsLayer({ project, presentation = false, selectedId, hitRadius = 22, onPathPointerDown, onPointPointerDown }: {
  project: ActualRouteProject
  presentation?: boolean
  selectedId?: string
  hitRadius?: number
  onPathPointerDown?: (event: React.PointerEvent<SVGPathElement>, path: BasemapPath) => void
  onPointPointerDown?: (event: React.PointerEvent<SVGCircleElement>, path: BasemapPath, pointId: string) => void
}) {
  return <g data-layer="basemap-paths">{sortedBasemapPaths(project.basemapPaths).filter(path => path.visible).map(path => {
    const d = getBasemapPathD(path)
    if (!d) return null
    const selected = selectedId === path.id
    return <g key={path.id} data-basemap-path-id={path.id} className={`basemap-path ${selected ? 'selected' : ''}`}>
      <path d={d} fill={path.isFilled ? path.color : 'none'} fillOpacity={path.isFilled ? path.opacity : 0} stroke={path.color} strokeWidth={path.width} strokeOpacity={path.opacity} strokeLinecap="round" strokeLinejoin="round" pointerEvents={presentation || path.locked ? 'none' : path.isFilled ? 'all' : 'stroke'} onPointerDown={event => onPathPointerDown?.(event, path)} />
      {!presentation && selected && !path.locked && <g data-editor="true" className="basemap-path-points">{path.points.map(point => <g key={point.id} data-basemap-point-id={point.id} transform={`translate(${point.x} ${point.y})`}>
        <circle className="basemap-point-hit" r={hitRadius} fill="transparent" pointerEvents="all" onPointerDown={event => onPointPointerDown?.(event, path, point.id)} />
        <circle className="basemap-point-marker" r={Math.max(3, Math.min(7, path.width * .8))} fill="#fffdf8" stroke={path.color} strokeWidth="1.5" pointerEvents="none" />
      </g>)}</g>}
    </g>
  })}</g>
}
