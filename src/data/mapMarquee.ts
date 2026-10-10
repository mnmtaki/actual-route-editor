import type { ActualRouteProject, Selection } from '../data/model'
import { getSegmentCurveSamples } from '../geometry/path'
import { getStructureNodePoint } from '../data/structure'
import { getLineLegendLayout } from '../data/lineLegend'

export type MapItemSelection = Exclude<Selection, null>
export type MapRect = { left: number; top: number; right: number; bottom: number }
type Point = { x: number; y: number }
const inside = (point: Point, rect: MapRect) => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
const bounds = (a: Point, b: Point): MapRect => ({ left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) })
const intersects = (a: MapRect, b: MapRect) => a.right >= b.left && a.left <= b.right && a.bottom >= b.top && a.top <= b.bottom
const segmentTouchesRect = (a: Point, b: Point, rect: MapRect): boolean => {
  if (inside(a, rect) || inside(b, rect)) return true
  if (!intersects(bounds(a, b), rect)) return false
  // Liang–Barsky clipping handles a long path that crosses a thin selection.
  const dx = b.x - a.x, dy = b.y - a.y
  let lo = 0, hi = 1
  for (const [p, q] of [[-dx, a.x - rect.left], [dx, rect.right - a.x], [-dy, a.y - rect.top], [dy, rect.bottom - a.y]]) {
    if (!p) { if (q < 0) return false; continue }
    const t = q / p
    if (p < 0) lo = Math.max(lo, t)
    else hi = Math.min(hi, t)
    if (lo > hi) return false
  }
  return true
}
const polylineTouches = (points: Point[], rect: MapRect) => points.some((point, index) => inside(point, rect) || (index > 0 && segmentTouchesRect(points[index - 1], point, rect)))
const visibleLine = (project: ActualRouteProject, lineId: string) => project.lines.find(line => line.id === lineId)?.visible !== false
export const selectionIdentity = (item: MapItemSelection): string => item.type + ':' + (item.type === 'background' ? 'background' : 'id' in item ? item.id : '') + (item.type === 'lineLabel' ? ':' + item.source : '')

export function hitMapObjects(project: ActualRouteProject, rect: MapRect): MapItemSelection[] {
  const hits: MapItemSelection[] = []
  const push = (item: MapItemSelection) => hits.push(item)
  for (const station of project.stations) {
    if (project.stationLineRelations.some(relation => relation.stationId === station.id && visibleLine(project, relation.lineId)) && inside(station, rect)) push({ type: 'station', id: station.id })
  }
  for (const segment of project.geometry.segments) {
    if (!visibleLine(project, segment.lineId)) continue
    const points = getSegmentCurveSamples(project, segment, 16)
    if (polylineTouches(points, rect)) {
      // A box crossing one segment must not implicitly select and delete the whole line.
      push({ type: 'segment', id: segment.id })
    }
    for (const waypoint of segment.waypoints) if (inside(waypoint, rect)) push({ type: 'waypoint', id: waypoint.id, segmentId: segment.id })
    for (const node of segment.structureNodes ?? []) {
      const point = getStructureNodePoint(project, segment, node)
      if (point && inside(point, rect)) push({ type: 'structureNode', id: node.id, segmentId: segment.id })
    }
  }
  // Imported AARC fake lines render directly from source paths and have no
  // ordinary native Segments, so handle their retained source points.
  const rawSource = project.aarc?.raw
  const rawLines = Array.isArray(rawSource?.lines) ? rawSource.lines as Array<Record<string, unknown>> : []
  const rawPoints = Array.isArray(rawSource?.points) ? rawSource.points as Array<Record<string, unknown>> : []
  const sourcePointPositions = new Map(rawPoints.flatMap(item => {
    const pos = item.pos
    if (!Array.isArray(pos) || pos.length < 2) return []
    const x = Number(pos[0]), y = Number(pos[1])
    return Number.isFinite(x) && Number.isFinite(y) ? [[Number(item.id), { x, y }] as const] : []
  }))
  for (const line of project.lines) {
    if (!line.visible || !line.isFake || line.source?.format !== 'aarc') continue
    const sourceId = Number(line.source.sourceLineId ?? line.source.lineId)
    const raw = rawLines.find(item => Number(item.id) === sourceId)
    const pts = Array.isArray(raw?.pts) ? raw.pts.map(id => sourcePointPositions.get(Number(id))).filter((point): point is Point => Boolean(point)) : []
    if (polylineTouches(pts, rect)) push({ type: 'line', id: line.id })
  }
  for (const line of project.lines) if (line.visible) for (const badge of line.lineBadges ?? []) {
    if (badge.visible && intersects(rect, { left: badge.x - badge.size / 2, right: badge.x + badge.size / 2, top: badge.y - badge.size / 2, bottom: badge.y + badge.size / 2 })) push({ type: 'lineLabel', id: badge.id, lineId: line.id, source: 'native' })
  }
  for (const tag of project.textTags ?? []) if (tag.lineId && visibleLine(project, tag.lineId) && inside(tag, rect)) push({ type: 'lineLabel', id: tag.id, lineId: tag.lineId, source: 'aarc' })
  for (const element of project.mapElements ?? []) if (element.visible && inside(element, rect)) push({ type: 'mapElement', id: element.id })
  for (const road of project.roads ?? []) if (road.visible && polylineTouches(road.points, rect)) {
    push({ type: 'road', id: road.id })
    for (const point of road.points) if (inside(point, rect)) push({ type: 'roadPoint', id: point.id, roadId: road.id })
  }
  for (const path of project.basemapPaths ?? []) if (path.visible && polylineTouches(path.points, rect)) push({ type: 'basemapPath', id: path.id })
  if (project.lineLegend?.visible) {
    const legend = project.lineLegend, layout = getLineLegendLayout(project, legend)
    if (intersects(rect, { left: legend.x, top: legend.y, right: legend.x + layout.width * legend.scale, bottom: legend.y + layout.height * legend.scale })) push({ type: 'lineLegend', id: legend.id })
  }
  // The background is often bigger than the whole viewport. Require it to be
  // fully enclosed; otherwise every small marquee would select it.
  if (project.background?.visible) {
    const bg = project.background
    if (rect.left <= bg.x && rect.top <= bg.y && rect.right >= bg.x + bg.width && rect.bottom >= bg.y + bg.height) push({ type: 'background' })
  }
  return [...new Map(hits.map(item => [selectionIdentity(item), item])).values()]
}

export function mergeMapSelections(previous: readonly MapItemSelection[], hits: readonly MapItemSelection[], additive: boolean): MapItemSelection[] {
  if (!additive) return [...hits]
  const result = new Map(previous.map(item => [selectionIdentity(item), item]))
  for (const item of hits) result.set(selectionIdentity(item), item)
  return [...result.values()]
}
