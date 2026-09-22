import type { ActualRouteProject, BasemapPath } from '../data/model'
import { getBasemapPathD, sortedBasemapPaths } from '../data/basemapPaths'
import { buildAarcTerrainTransitionPaths } from '../data/aarcTerrainTransitions'

export function BasemapPathArtwork({ path, presentation, selected, hitRadius, onPathPointerDown, onPointPointerDown }: {
  path: BasemapPath
  presentation: boolean
  selected: boolean
  hitRadius: number
  onPathPointerDown?: (event: React.PointerEvent<SVGPathElement>, path: BasemapPath) => void
  onPointPointerDown?: (event: React.PointerEvent<SVGCircleElement>, path: BasemapPath, pointId: string) => void
}) {
    const d = getBasemapPathD(path)
    if (!d) return null
    const suppressFilledStroke = path.isFilled && path.source?.format === 'aarc'
    const aarcGeometry = path.geometry?.kind === 'aarc' ? path.geometry : undefined
    const carpetWidth = aarcGeometry ? path.isFilled ? aarcGeometry.lineWidthBase * .5 : path.width + aarcGeometry.lineCarpetWiden : 0
    const showCarpet = Boolean(aarcGeometry && !aarcGeometry.removeCarpet && carpetWidth > 0)
    return <g data-basemap-path-id={path.id} data-z-index={path.zIndex} className={`basemap-path ${selected ? 'selected' : ''}`}>
      {showCarpet && <path data-aarc-terrain-carpet="true" d={d} fill="none" stroke={aarcGeometry!.backgroundColor} strokeWidth={carpetWidth} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
      <path d={d} fill={path.isFilled ? path.color : 'none'} fillOpacity={path.isFilled ? path.opacity : 0} stroke={suppressFilledStroke ? 'none' : path.color} strokeWidth={suppressFilledStroke ? 0 : path.width} strokeOpacity={suppressFilledStroke ? 0 : path.opacity} strokeLinecap={path.lineCap ?? 'round'} strokeLinejoin="round" pointerEvents="none" />
      {!presentation && !path.locked && <path data-editor="true" d={d} fill={path.isFilled ? 'transparent' : 'none'} stroke="transparent" strokeWidth={Math.max(path.width, 1) + hitRadius * 2} pointerEvents={path.isFilled ? 'all' : 'stroke'} onPointerDown={event => onPathPointerDown?.(event, path)} />}
      {!presentation && selected && !path.locked && <g data-editor="true" className="basemap-path-points">{path.points.map(point => <g key={point.id} data-basemap-point-id={point.id} transform={`translate(${point.x} ${point.y})`}>
        <circle className="basemap-point-hit" r={hitRadius} fill="transparent" pointerEvents="all" onPointerDown={event => onPointPointerDown?.(event, path, point.id)} />
        <circle className="basemap-point-marker" r={Math.max(3, Math.min(7, path.width * .8))} fill="#fffdf8" stroke={path.color} strokeWidth="1.5" pointerEvents="none" />
      </g>)}</g>}
    </g>
}

export function AarcTerrainTransitionsArtwork({ project, part }: { project: ActualRouteProject; part: 'carpet' | 'body' }) {
  const transitions = buildAarcTerrainTransitionPaths(project.basemapPaths ?? [])
  if (!transitions.length) return null
  return <g data-aarc-terrain-transitions={part}>{transitions.map(transition => part === 'carpet'
    ? <path key={transition.id} data-aarc-terrain-transition-id={transition.id} d={transition.d} fill="none" stroke={transition.carpetColor} strokeWidth={transition.carpetWidth} strokeLinejoin="round" pointerEvents="none" />
    : <path key={transition.id} data-aarc-terrain-transition-id={transition.id} d={transition.d} fill={transition.color} stroke="none" pointerEvents="none" />
  )}</g>
}

export function BasemapPathsLayer({ project, presentation = false, selectedId, hitRadius = 22, onPathPointerDown, onPointPointerDown }: {
  project: ActualRouteProject
  presentation?: boolean
  selectedId?: string
  hitRadius?: number
  onPathPointerDown?: (event: React.PointerEvent<SVGPathElement>, path: BasemapPath) => void
  onPointPointerDown?: (event: React.PointerEvent<SVGCircleElement>, path: BasemapPath, pointId: string) => void
}) {
  return <g data-layer="basemap-paths"><AarcTerrainTransitionsArtwork project={project} part="carpet" />{sortedBasemapPaths(project.basemapPaths).filter(path => path.visible).map(path => <BasemapPathArtwork key={path.id} path={path} presentation={presentation} selected={selectedId === path.id} hitRadius={hitRadius} onPathPointerDown={onPathPointerDown} onPointPointerDown={onPointPointerDown} />)}<AarcTerrainTransitionsArtwork project={project} part="body" /></g>
}
