import type { ActualRouteProject, BasemapPath, Line, Segment, Station, StationLineRelation, Waypoint } from '../data/model'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS } from '../data/model'
import { normalizeISODate } from '../timeline/date'
import { reconstructAarcLineGeometry, type AarcGeometryPoint } from './aarcGeometry'
import { convertAarcVisualStyle } from './aarcVisualStyle'
import { removeRepeatedTerminalPoint } from '../data/basemapPaths'

interface AarcPoint { id?: unknown; pos?: unknown; sta?: unknown; dir?: unknown; name?: unknown; nameS?: unknown; nameP?: unknown }
interface AarcLine { id?: unknown; name?: unknown; color?: unknown; pts?: unknown; type?: unknown; isFake?: unknown; width?: unknown; zIndex?: unknown; isFilled?: unknown; time?: { open?: unknown } }
interface AarcPointLink { pts?: unknown }
interface AarcProject { lines?: unknown; points?: unknown; pointLinks?: unknown; cvsSize?: unknown; config?: unknown }

export interface AarcImportSummary {
  realLineCount: number
  stationCount: number
  segmentCount: number
  waypointCount: number
  explicitWaypointCount: number
  implicitCornerCount: number
  totalWaypointCount: number
  horizontalLegCount: number
  verticalLegCount: number
  diagonalLegCount: number
  roundedImplicitCornerCount: number
  ignoredHelperCount: number
  warningCount: number
  warnings: string[]
}
export interface AarcImportResult { project: ActualRouteProject; summary: AarcImportSummary }

export function parseAarcProject(raw: unknown): AarcProject {
  if (!raw || typeof raw !== 'object') throw new Error('AARC 文件内容不是 JSON 对象')
  const value = raw as AarcProject
  if (!Array.isArray(value.lines) || !Array.isArray(value.points) || !Array.isArray(value.cvsSize)) throw new Error('缺少 lines、points 或 cvsSize，无法识别为 AARC 工程')
  return value
}

export function convertAarcToActualRouteProject(raw: unknown, fileName = 'AARC 工程'): AarcImportResult {
  const source = parseAarcProject(raw)
  const warnings: string[] = []
  const rawPoints = source.points as AarcPoint[]
  const pointMap = new Map<number, AarcPoint>()
  for (const point of rawPoints) {
    const id = finiteId(point?.id)
    if (id === null) { warnings.push('忽略了一个缺少有效 id 的 AARC Point'); continue }
    if (pointMap.has(id)) { warnings.push(`AARC Point ${id} 重复，已使用第一项`); continue }
    pointMap.set(id, point)
  }
  const canonicalPoint = buildPointLinkAliases(source.pointLinks, pointMap, warnings)
  const rawLines = source.lines as AarcLine[]
  const realLines = rawLines.filter(isRealTransitLine)
  const terrainLines = rawLines.filter(isAarcTerrainPath)
  const ignoredHelperCount = rawLines.length - realLines.length - terrainLines.length
  if (!realLines.length) throw new Error('AARC 工程中没有可导入的真实运营线路')

  const basemapPaths: BasemapPath[] = terrainLines.flatMap((rawLine, lineIndex) => {
    const sourceLineId = finiteId(rawLine.id) ?? lineIndex
    const points = (Array.isArray(rawLine.pts) ? rawLine.pts : []).flatMap((rawId, pointIndex) => {
      const pointId = finiteId(rawId)
      if (pointId === null) { warnings.push(`AARC 底图路径 ${sourceLineId} 包含无效 Point id`); return [] }
      const point = pointMap.get(pointId), position = point ? validPosition(point.pos) : null
      if (!point) { warnings.push(`AARC 底图路径 ${sourceLineId} 引用了不存在的 Point ${pointId}`); return [] }
      if (!position) { warnings.push(`AARC 底图路径 ${sourceLineId} 的 Point ${pointId} 缺少有效 pos，已跳过`); return [] }
      return [{ id: `aarc-basemap-point-${sourceLineId}-${pointId}-${pointIndex}`, x: position[0], y: position[1] }]
    })
    if (points.length < 2) { warnings.push(`AARC 底图路径 ${sourceLineId} 少于两个有效路径点，已跳过`); return [] }
    const repeated = points[0].id === points.at(-1)?.id || (points[0].x === points.at(-1)?.x && points[0].y === points.at(-1)?.y)
    const closed = rawLine.isFilled === true || repeated
    const width = Number(rawLine.width)
    const path = removeRepeatedTerminalPoint({ id: `aarc-basemap-${sourceLineId}`, ...(typeof rawLine.name === 'string' && rawLine.name ? { name: rawLine.name } : {}), category: 'other', points, color: validColor(rawLine.color), width: Number.isFinite(width) && width > 0 ? width : 1, opacity: 1, closed, isFilled: rawLine.isFilled === true && closed, zIndex: Number.isFinite(Number(rawLine.zIndex)) ? Number(rawLine.zIndex) : 0, visible: true, locked: false, source: { format: 'aarc', sourceLineId } })
    return [path]
  })
  const stations: Station[] = []
  const lines: Line[] = []
  const relations: StationLineRelation[] = []
  const segments: Segment[] = []
  const stationByPoint = new Map<number, Station>()
  const stationNameFontWeight = resolveAarcStationNameFontWeight(source.config)
  let explicitWaypointCount = 0
  let implicitCornerCount = 0
  let horizontalLegCount = 0
  let verticalLegCount = 0
  let diagonalLegCount = 0

  const ensureStation = (rawPointId: number): Station | null => {
    const pointId = canonicalPoint.get(rawPointId) ?? rawPointId
    const existing = stationByPoint.get(pointId)
    if (existing) return existing
    const point = pointMap.get(pointId)
    if (!point || point.sta !== 1) return null
    const position = validPosition(point.pos)
    if (!position) { warnings.push(`AARC Station Point ${pointId} 缺少有效 pos，已跳过`); return null }
    const nameP = validPair(point.nameP)
    const station: Station = {
      id: `aarc-station-${pointId}`,
      name: text(point.name) || `未命名站 ${pointId}`,
      ...(typeof point.nameS === 'string' && point.nameS.length ? { nameS: point.nameS } : {}),
      x: position[0], y: position[1],
      labelOffsetX: nameP?.[0] ?? 14,
      labelOffsetY: nameP?.[1] ?? -14,
      source: { format: 'aarc', pointId, stationNameFontWeight, ...(nameP ? { nameP, labelAnchorMode: 'aarc-block' as const } : {}) },
    }
    stationByPoint.set(pointId, station); stations.push(station); return station
  }

  realLines.forEach((rawLine, lineOrder) => {
    const sourceLineId = finiteId(rawLine.id) ?? lineOrder
    const lineId = `aarc-line-${sourceLineId}`
    const openedAt = reliableAarcDate(rawLine.time?.open)
    if (rawLine.time?.open != null && !openedAt) warnings.push(`AARC 线路 ${sourceLineId} 的 time.open 无法可靠换算为日期，已保留为空`)
    const line: Line = { id: lineId, name: text(rawLine.name)!, color: validColor(rawLine.color), stationSequence: [], lineOrder, openedAt, closedAt: null, visible: true, locked: false, source: { format: 'aarc', lineId: sourceLineId } }
    lines.push(line)
    const chain = Array.isArray(rawLine.pts) ? rawLine.pts : []
    const geometryPoints: AarcGeometryPoint[] = []
    for (const rawId of chain) {
      const pointId = finiteId(rawId)
      if (pointId === null) { warnings.push(`AARC 线路 ${sourceLineId} 包含无效 Point id`); continue }
      const point = pointMap.get(pointId)
      if (!point) { warnings.push(`AARC 线路 ${sourceLineId} 引用了不存在的 Point ${pointId}`); continue }
      const position = validPosition(point.pos)
      if (!position) { warnings.push(`AARC 线路 ${sourceLineId} 的 Point ${pointId} 缺少有效 pos，已跳过`); continue }
      geometryPoints.push({ id: pointId, x: position[0], y: position[1], dir: point.dir === 1 ? 1 : 0, station: point.sta === 1 })
    }
    const reconstructed = reconstructAarcLineGeometry(geometryPoints)
    implicitCornerCount += reconstructed.stats.implicitCornerCount
    horizontalLegCount += reconstructed.stats.horizontalLegCount
    verticalLegCount += reconstructed.stats.verticalLegCount
    diagonalLegCount += reconstructed.stats.diagonalLegCount

    let previousStation: Station | null = null
    let pendingWaypoints: Waypoint[] = []
    let segmentIndex = 0
    const relationStationIds = new Set<string>()
    reconstructed.nodes.forEach((node, nodeIndex) => {
      const sourcePoint = node.sourcePointIndex === undefined ? null : geometryPoints[node.sourcePointIndex]
      if (sourcePoint?.station) {
        const station = ensureStation(sourcePoint.id)
        if (!station) return
        if (!relationStationIds.has(station.id)) {
          relations.push({ id: `aarc-relation-${sourceLineId}-${station.source?.pointId ?? sourcePoint.id}`, stationId: station.id, lineId, openedAt, closedAt: null })
          relationStationIds.add(station.id)
        }
        if (!line.stationSequence.length || line.stationSequence.at(-1) !== station.id) line.stationSequence.push(station.id)
        if (previousStation && previousStation.id !== station.id) {
          segments.push({ id: `aarc-segment-${sourceLineId}-${segmentIndex}`, lineId, fromStationId: previousStation.id, toStationId: station.id, mode: pendingWaypoints.length ? 'rounded' : 'straight', ...(pendingWaypoints.length ? { cornerRadius: 42 } : {}), structureType: 'underground', structureNodes: [], waypoints: pendingWaypoints, openedAt, closedAt: null })
          segmentIndex += 1
        } else if (pendingWaypoints.length) warnings.push(`AARC 线路 ${sourceLineId} 在首站前的 ${pendingWaypoints.length} 个几何点无法归属区间，已忽略`)
        previousStation = station; pendingWaypoints = []
        return
      }
      if (!previousStation) return
      const explicit = Boolean(sourcePoint)
      pendingWaypoints.push({
        id: explicit
          ? `aarc-waypoint-${sourceLineId}-${sourcePoint!.id}-${explicitWaypointCount}`
          : `aarc-corner-${sourceLineId}-${nodeIndex}-${implicitCornerCount}`,
        x: node.x, y: node.y, type: 'corner',
        source: { format: 'aarc', ...(explicit ? { pointId: sourcePoint!.id } : {}), lineId: sourceLineId, kind: explicit ? 'explicit-control-point' : 'implicit-corner' },
      })
      if (explicit) explicitWaypointCount += 1
    })
    if (pendingWaypoints.length) warnings.push(`AARC 线路 ${sourceLineId} 在末站后的 ${pendingWaypoints.length} 个几何点无法归属区间，已忽略`)
    if (line.stationSequence.length < 2) warnings.push(`AARC 线路 ${sourceLineId} 少于两个有效车站`)
  })

  const visualCalibration = convertAarcVisualStyle(realLines, source.config)
  if (!visualCalibration) warnings.push('AARC 视觉映射缺少有效 line.width 或 config.lineWidthMapped，已使用编辑器默认视觉')
  else if (visualCalibration.multipliers.distinctLineWidths.length > 1) warnings.push(`AARC 真实线路包含多种宽度（${visualCalibration.multipliers.distinctLineWidths.join('、')}），当前全局样式按首个真实线路宽度 ${visualCalibration.multipliers.lineWidth} 标定`)
  const today = new Date().toISOString().slice(0, 10)
  const project: ActualRouteProject = {
    version: 1,
    name: projectName(fileName),
    stations, lines, stationLineRelations: relations, openingPhases: [], geometry: { segments }, mapElements: [], basemapPaths, background: null,
    timeline: { currentDate: today, startDate: today, endDate: today, playing: false },
    presentation: { ...DEFAULT_PRESENTATION_SETTINGS, startDate: today, endDate: today },
    settings: { ...DEFAULT_SETTINGS, ...(visualCalibration?.settings ?? {}) },
  }
  const totalWaypointCount = segments.reduce((count, segment) => count + segment.waypoints.length, 0)
  const summary: AarcImportSummary = {
    realLineCount: lines.length,
    stationCount: stations.length,
    segmentCount: segments.length,
    waypointCount: totalWaypointCount,
    explicitWaypointCount,
    implicitCornerCount,
    totalWaypointCount,
    horizontalLegCount,
    verticalLegCount,
    diagonalLegCount,
    roundedImplicitCornerCount: implicitCornerCount,
    ignoredHelperCount,
    warningCount: warnings.length,
    warnings,
  }
  return { project, summary }
}

function isRealTransitLine(line: AarcLine) {
  return Boolean(line && line.isFake !== true && line.type !== 1 && text(line.name) && Array.isArray(line.pts) && line.pts.length >= 2)
}
function isAarcTerrainPath(line: AarcLine) {
  return Boolean(line && line.isFake !== true && line.type === 1 && Array.isArray(line.pts) && line.pts.length >= 2)
}
function buildPointLinkAliases(raw: unknown, points: Map<number, AarcPoint>, warnings: string[]) {
  const parent = new Map<number, number>()
  const find = (id: number): number => { const current = parent.get(id) ?? id; if (current === id) return id; const root = find(current); parent.set(id, root); return root }
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb)) }
  for (const link of Array.isArray(raw) ? raw as AarcPointLink[] : []) {
    const ids = Array.isArray(link?.pts) ? link.pts.map(finiteId).filter((id): id is number => id !== null && points.has(id)) : []
    for (let index = 1; index < ids.length; index += 1) union(ids[0], ids[index])
  }
  const groups = new Map<number, number[]>()
  for (const id of parent.keys()) { const root = find(id); groups.set(root, [...(groups.get(root) ?? []), id]) }
  const aliases = new Map<number, number>()
  for (const ids of groups.values()) {
    const stationIds = ids.filter(id => points.get(id)?.sta === 1)
    const named = stationIds.filter(id => Boolean(text(points.get(id)?.name)))
    const names = new Set(named.map(id => text(points.get(id)?.name)!))
    if (names.size > 1) { warnings.push(`AARC pointLinks 连接了多个不同站名（${[...names].join('、')}），未自动合并`); continue }
    const canonical = named[0] ?? stationIds[0]
    if (canonical !== undefined) stationIds.forEach(id => aliases.set(id, canonical))
  }
  return aliases
}
function reliableAarcDate(value: unknown): string | null {
  const normalized = normalizeISODate(value)
  if (normalized) return normalized
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const date = new Date(value)
  const year = date.getUTCFullYear()
  return year >= 1800 && year <= 2500 ? date.toISOString().slice(0, 10) : null
}
function finiteId(value: unknown): number | null { const number = typeof value === 'number' ? value : Number(value); return Number.isFinite(number) ? number : null }
function validPosition(value: unknown): [number, number] | null { const pair = validPair(value); return pair ? [pair[0], pair[1]] : null }
function validPair(value: unknown): [number, number] | null { return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1])) ? [Number(value[0]), Number(value[1])] : null }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function validColor(value: unknown) { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#64748b' }
function resolveAarcStationNameFontWeight(config: unknown): 'normal' | 'bold' | number {
  if (!config || typeof config !== 'object') return 'normal'
  const value = (config as { staNameFontWeight?: unknown }).staNameFontWeight
  if (value === 'bold' || value === 'normal') return value
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= 100 && number <= 900 ? number : 'normal'
}
function projectName(fileName: string) { return fileName.replace(/\.aarc\.json$/i, '').replace(/\.json$/i, '').trim() || 'AARC 工程' }
