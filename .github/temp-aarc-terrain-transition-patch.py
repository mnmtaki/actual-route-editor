from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}')
    p.write_text(text.replace(old, new), encoding='utf-8')


replace_once(
    'src/data/aarcBasemapGeometry.ts',
    "export interface AarcBasemapFormalPoint extends Coord {\n  free?: boolean\n}",
    "export interface AarcBasemapFormalPoint extends Coord {\n  afterIdxEqv: number\n  free?: boolean\n}",
)
replace_once(
    'src/data/aarcBasemapGeometry.ts',
    "  if (controls.length < 2) return controls.map(point => ({ x: point.x, y: point.y, ...(point.free ? { free: true } : {}) }))",
    "  if (controls.length < 2) return controls.map((point, index) => ({ x: point.x, y: point.y, afterIdxEqv: index, ...(point.free ? { free: true } : {}) }))",
)
replace_once(
    'src/data/aarcBasemapGeometry.ts',
    "  const result: AarcBasemapFormalPoint[] = [{ x: segs[0].a.x, y: segs[0].a.y, ...(segs[0].aFree ? { free: true } : {}) }]\n  for (const seg of segs) {\n    for (const point of seg.itp) result.push({ x: point.x, y: point.y })\n    result.push({ x: seg.b.x, y: seg.b.y, ...(seg.bFree ? { free: true } : {}) })\n  }",
    "  const result: AarcBasemapFormalPoint[] = [{ x: segs[0].a.x, y: segs[0].a.y, afterIdxEqv: 0, ...(segs[0].aFree ? { free: true } : {}) }]\n  for (const [index, seg] of segs.entries()) {\n    for (const point of seg.itp) result.push({ x: point.x, y: point.y, afterIdxEqv: index })\n    result.push({ x: seg.b.x, y: seg.b.y, afterIdxEqv: index + 1, ...(seg.bFree ? { free: true } : {}) })\n  }",
)

replace_once(
    'src/renderer/BasemapPaths.tsx',
    "import { getBasemapPathD, sortedBasemapPaths } from '../data/basemapPaths'\n",
    "import { getBasemapPathD, sortedBasemapPaths } from '../data/basemapPaths'\nimport { buildAarcTerrainTransitionPaths } from '../data/aarcTerrainTransitions'\n",
)
insert_anchor = "export function BasemapPathsLayer({ project, presentation = false, selectedId, hitRadius = 22, onPathPointerDown, onPointPointerDown }: {"
transition_component = """export function AarcTerrainTransitionsArtwork({ project, part }: { project: ActualRouteProject; part: 'carpet' | 'body' }) {
  const transitions = buildAarcTerrainTransitionPaths(project.basemapPaths ?? [])
  if (!transitions.length) return null
  return <g data-aarc-terrain-transitions={part}>{transitions.map(transition => part === 'carpet'
    ? <path key={transition.id} data-aarc-terrain-transition-id={transition.id} d={transition.d} fill=\"none\" stroke={transition.carpetColor} strokeWidth={transition.carpetWidth} strokeLinejoin=\"round\" pointerEvents=\"none\" />
    : <path key={transition.id} data-aarc-terrain-transition-id={transition.id} d={transition.d} fill={transition.color} stroke=\"none\" pointerEvents=\"none\" />
  )}</g>
}

"""
replace_once('src/renderer/BasemapPaths.tsx', insert_anchor, transition_component + insert_anchor)
old_layer = "  return <g data-layer=\"basemap-paths\">{sortedBasemapPaths(project.basemapPaths).filter(path => path.visible).map(path => <BasemapPathArtwork key={path.id} path={path} presentation={presentation} selected={selectedId === path.id} hitRadius={hitRadius} onPathPointerDown={onPathPointerDown} onPointPointerDown={onPointPointerDown} />)}</g>"
new_layer = "  return <g data-layer=\"basemap-paths\"><AarcTerrainTransitionsArtwork project={project} part=\"carpet\" />{sortedBasemapPaths(project.basemapPaths).filter(path => path.visible).map(path => <BasemapPathArtwork key={path.id} path={path} presentation={presentation} selected={selectedId === path.id} hitRadius={hitRadius} onPathPointerDown={onPathPointerDown} onPointPointerDown={onPointPointerDown} />)}<AarcTerrainTransitionsArtwork project={project} part=\"body\" /></g>"
replace_once('src/renderer/BasemapPaths.tsx', old_layer, new_layer)

replace_once(
    'src/renderer/VectorBasemap.tsx',
    "import { BasemapPathArtwork } from './BasemapPaths'\n",
    "import { AarcTerrainTransitionsArtwork, BasemapPathArtwork } from './BasemapPaths'\n",
)
replace_once(
    'src/renderer/VectorBasemap.tsx',
    "  return <g data-layer=\"vector-basemap\">\n    {sortedVectorBasemapObjects(project).map(item => {",
    "  return <g data-layer=\"vector-basemap\">\n    <AarcTerrainTransitionsArtwork project={project} part=\"carpet\" />\n    {sortedVectorBasemapObjects(project).map(item => {",
)
replace_once(
    'src/renderer/VectorBasemap.tsx',
    "    })}\n    {draft && <RoadArtwork",
    "    })}\n    <AarcTerrainTransitionsArtwork project={project} part=\"body\" />\n    {draft && <RoadArtwork",
)
