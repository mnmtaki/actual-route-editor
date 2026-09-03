import type { ActualRouteProject, BasemapPath, BasemapPathCategory, BasemapPathPoint } from './model'
import { uid } from './model'

export type DrawingMode = { kind: 'line'; lineId: string; anchorStationId: string | null; phaseId?: string } | { kind: 'basemap'; pathId: string } | { kind: 'road'; roadId: string; styleId: string } | { kind?: 'line'; lineId: string; anchorStationId: string | null; phaseId?: string }

export const DEFAULT_BASEMAP_COLORS: Record<BasemapPathCategory, string> = { water: '#9ecbd3', terrain: '#b8c89b', other: '#d2c5a5' }

export function normalizeBasemapPaths(value: unknown): BasemapPath[] | undefined {
  if (!Array.isArray(value)) return undefined
  const paths = value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const id = typeof raw.id === 'string' && raw.id ? raw.id : ''
    if (!id) return []
    const points = Array.isArray(raw.points) ? raw.points.flatMap(point => {
      if (!point || typeof point !== 'object') return []
      const p = point as Record<string, unknown>, pid = typeof p.id === 'string' && p.id ? p.id : ''
      const x = Number(p.x), y = Number(p.y)
      return pid && Number.isFinite(x) && Number.isFinite(y) ? [{ id: pid, x, y } satisfies BasemapPathPoint] : []
    }) : []
    const category = raw.category === 'water' || raw.category === 'terrain' ? raw.category : 'other'
    const color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : DEFAULT_BASEMAP_COLORS[category]
    const width = finitePositive(raw.width, 3), opacity = clamp(Number(raw.opacity), 0, 1, 1), closed = raw.closed === true || raw.isFilled === true
    const isFilled = raw.isFilled === true && closed
    const zIndex = Number.isFinite(Number(raw.zIndex)) ? Number(raw.zIndex) : 0
    const sourceLineId = raw.source && typeof raw.source === 'object' ? (raw.source as Record<string, unknown>).sourceLineId : undefined
    const normalized: BasemapPath = { id, ...(typeof raw.name === 'string' && raw.name ? { name: raw.name } : {}), category, points, color, width, opacity, closed, isFilled, zIndex, visible: raw.visible !== false, locked: raw.locked === true, ...(raw.source && typeof raw.source === 'object' && (typeof sourceLineId === 'string' || Number.isFinite(Number(sourceLineId))) ? { source: { format: 'aarc' as const, sourceLineId: typeof sourceLineId === 'string' ? sourceLineId : Number(sourceLineId) } } : {}) }
    return [removeRepeatedTerminalPoint(normalized)]
  })
  return paths
}

export function sortedBasemapPaths(paths: BasemapPath[] | undefined): BasemapPath[] {
  return (paths ?? []).map((path, index) => ({ path, index })).sort((a, b) => a.path.zIndex - b.path.zIndex || a.index - b.index || a.path.id.localeCompare(b.path.id)).map(item => item.path)
}

export function getBasemapPathD(path: BasemapPath): string {
  if (!path.points.length) return ''
  const first = path.points[0]
  const commands = [`M ${first.x} ${first.y}`]
  for (const point of path.points.slice(1)) commands.push(`L ${point.x} ${point.y}`)
  if (path.closed && path.points.length > 1) commands.push('Z')
  return commands.join(' ')
}

export function createBasemapPath(project: ActualRouteProject, category: BasemapPathCategory, center = { x: 0, y: 0 }): { project: ActualRouteProject; pathId: string } {
  const next = structuredClone(project), pathId = uid('basemap')
  next.basemapPaths ??= []
  next.basemapPaths.push({ id: pathId, name: category === 'water' ? '水体' : category === 'terrain' ? '地形' : '底图路径', category, points: [{ id: uid('basemap-point'), x: center.x, y: center.y }], color: DEFAULT_BASEMAP_COLORS[category], width: 3, opacity: 1, closed: false, isFilled: false, zIndex: 0, visible: true, locked: false })
  return { project: next, pathId }
}

export function appendBasemapPoint(project: ActualRouteProject, pathId: string, point: { x: number; y: number }): ActualRouteProject {
  const next = structuredClone(project), path = next.basemapPaths?.find(item => item.id === pathId)
  if (path) path.points.push({ id: uid('basemap-point'), x: point.x, y: point.y })
  return next
}

export function updateBasemapPoint(project: ActualRouteProject, pathId: string, pointId: string, point: { x: number; y: number }): ActualRouteProject {
  const next = structuredClone(project), target = next.basemapPaths?.find(path => path.id === pathId)?.points.find(item => item.id === pointId)
  if (target) { target.x = point.x; target.y = point.y }
  return next
}

export function moveBasemapPath(project: ActualRouteProject, pathId: string, dx: number, dy: number): ActualRouteProject {
  const next = structuredClone(project), path = next.basemapPaths?.find(item => item.id === pathId)
  if (path) path.points.forEach(point => { point.x += dx; point.y += dy })
  return next
}

export function deleteBasemapPath(project: ActualRouteProject, pathId: string): ActualRouteProject {
  const next = structuredClone(project)
  next.basemapPaths = (next.basemapPaths ?? []).filter(path => path.id !== pathId)
  return next
}

export function removeRepeatedTerminalPoint(path: BasemapPath): BasemapPath {
  if (!path.closed || path.points.length < 2) return path
  const first = path.points[0], last = path.points[path.points.length - 1]
  if (first.id === last.id || (first.x === last.x && first.y === last.y)) return { ...path, points: path.points.slice(0, -1) }
  return path
}

export function insertBasemapPoint(project: ActualRouteProject, pathId: string, point: { x: number; y: number }): ActualRouteProject {
  const next = structuredClone(project), path = next.basemapPaths?.find(item => item.id === pathId)
  if (!path || path.points.length < 2) { path?.points.push({ id: uid('basemap-point'), x: point.x, y: point.y }); return next }
  let bestIndex = 0, bestDistance = Infinity
  const count = path.closed ? path.points.length : path.points.length - 1
  for (let index = 0; index < count; index += 1) {
    const a = path.points[index], b = path.points[(index + 1) % path.points.length], projection = projectToLine(point, a, b)
    if (projection.distance < bestDistance) { bestDistance = projection.distance; bestIndex = index }
  }
  path.points.splice(bestIndex + 1, 0, { id: uid('basemap-point'), x: point.x, y: point.y })
  return next
}

function projectToLine(point: { x: number; y: number }, a: BasemapPathPoint, b: BasemapPathPoint) {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy, t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0
  return { distance: Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)), t }
}

function finitePositive(value: unknown, fallback: number) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback }
function clamp(value: number, min: number, max: number, fallback: number) { return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback }
