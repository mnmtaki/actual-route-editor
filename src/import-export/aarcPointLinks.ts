import type { ActualRouteProject } from '../data/model'
import { aggregateAarcPointMetrics } from './aarcNormalize'
import { buildAarcStationComponents, createAarcFreeSnapCandidateResolver, type AarcStationPointInput } from './aarcStationClustering'

export type AarcVisualPointLinkType = 0 | 1 | 2 | 3
export interface AarcPointLinkPoint { x: number; y: number }
export interface AarcPointLinkArtwork {
  id: string
  type: AarcVisualPointLinkType
  start: AarcPointLinkPoint
  end: AarcPointLinkPoint
  sizeRatio: number
  carpetWidth: number
  bodyWidth: number
  coreWidth?: number
  dash?: [number, number]
}
export interface AarcPointLinkCover {
  pointId: number
  x: number
  y: number
  sizeRatio: number
}
export interface AarcPointLinksArtwork {
  links: AarcPointLinkArtwork[]
  covers: AarcPointLinkCover[]
  colors: { background: string; exchange: string; fill: string }
  stationSize: number
  stationLineWidth: number
}

const finite = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const position = (value: unknown): AarcPointLinkPoint | undefined => {
  const pair = array(value), x = finite(pair[0]), y = finite(pair[1])
  return x === undefined || y === undefined ? undefined : { x, y }
}
const color = (value: unknown, fallback: string) => typeof value === 'string' && value ? value : fallback

function shrinkTowards(point: AarcPointLinkPoint, target: AarcPointLinkPoint, amount: number): AarcPointLinkPoint {
  const dx = target.x - point.x, dy = target.y - point.y, length = Math.hypot(dx, dy)
  return length > 0 ? { x: point.x + dx * amount / length, y: point.y + dy * amount / length } : point
}

/** Mirrors AARC autoDash so both ends of a dot link finish on a solid dash. */
export function resolveAarcPointLinkDash(start: AarcPointLinkPoint, end: AarcPointLinkPoint, dashSize: number, dashGap: number): [number, number] {
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  if (distance <= dashSize) return [dashSize, dashGap]
  const dashCount = Math.max(1, Math.round((distance + dashGap) / (dashSize + dashGap)))
  const ratio = (distance + dashGap) / (dashCount * (dashSize + dashGap))
  return [dashSize * ratio, dashGap * ratio]
}

/**
 * Resolve source-faithful, visual-only AARC point links. Types 0-3 are kept
 * outside ActualRoute's station/relation model; type 4 is deliberately absent.
 */
export function resolveAarcPointLinksArtwork(project: ActualRouteProject): AarcPointLinksArtwork {
  const raw = record(project.aarc?.raw)
  const config = record(project.aarc?.config ?? raw.config)
  const rawPoints = array(raw.points).map(record)
  const rawLines = array(raw.lines).map(record)
  const rawLinks = array(project.aarc?.pointLinks ?? raw.pointLinks).map(record)
  const stationSize = finite(config.ptStaSize) ?? 10
  const stationLineWidth = finite(config.ptStaLineWidth) ?? 4
  const colors = {
    background: color(config.bgColor, '#ffffff'),
    exchange: color(config.ptStaExchangeLineColor, '#999999'),
    fill: color(config.ptStaFillColor, '#ffffff'),
  }

  const points = new Map<number, Record<string, unknown>>()
  const pointPositions = new Map<number, { x: number; y: number }>()
  for (const point of rawPoints) {
    const id = finite(point.id), pos = position(point.pos)
    if (id === undefined || !pos || points.has(id)) continue
    points.set(id, point)
    pointPositions.set(id, pos)
  }
  const memberships = new Map<number, number[]>()
  rawLines.forEach((line, index) => {
    const lineId = finite(line.id) ?? index
    for (const value of array(line.pts)) {
      const pointId = finite(value)
      if (pointId === undefined) continue
      const current = memberships.get(pointId) ?? []
      if (!current.includes(lineId)) current.push(lineId)
      memberships.set(pointId, current)
    }
  })
  const stationPoints: AarcStationPointInput[] = [...points.entries()].flatMap(([id, point], sourceOrder) => {
    const pos = pointPositions.get(id)
    if (finite(point.sta) !== 1 || !pos) return []
    return [{ id, x: pos.x, y: pos.y, sourceOrder, ...(point.free === true ? { free: true } : {}) }]
  })
  const metricsByPoint = new Map<number, ReturnType<typeof aggregateAarcPointMetrics>>()
  const pointMetrics = (id: number) => {
    const cached = metricsByPoint.get(id)
    if (cached) return cached
    const resolved = aggregateAarcPointMetrics(id, rawLines, memberships, config)
    metricsByPoint.set(id, resolved)
    return resolved
  }
  const pointSize = (id: number) => pointMetrics(id).ptSize
  const snapSize = (id: number) => pointMetrics(id).ptSnapSize
  const snapDistance = finite(config.snapOctaClingPtPtDist) ?? 25
  const lineChains = rawLines.map(line => ({ pts: array(line.pts).map(finite).filter((id): id is number => id !== undefined) }))
  const snapCandidates = createAarcFreeSnapCandidateResolver(pointPositions, lineChains, id => snapSize(id) * snapDistance)
  const clustering = buildAarcStationComponents(stationPoints, memberships, {
    configClingingDist: snapDistance,
    getSnapSize: snapSize,
    getSnapCandidates: snapCandidates,
  })
  const componentByPoint = new Map<number, (typeof clustering.components)[number]>()
  for (const component of clustering.components) for (const id of component.pointIds) componentByPoint.set(id, component)
  const clusterSize = (id: number) => {
    const component = componentByPoint.get(id)
    return component?.pointIds.length ? Math.max(...component.pointIds.map(pointSize)) : pointSize(id)
  }

  const links: AarcPointLinkArtwork[] = []
  const coverIds = new Set<number>()
  rawLinks.forEach((link, index) => {
    const type = finite(link.type)
    if (type !== 0 && type !== 1 && type !== 2 && type !== 3) return
    const ids = array(link.pts).map(finite).filter((id): id is number => id !== undefined)
    const a = ids[0], b = ids[1], startRaw = pointPositions.get(a), endRaw = pointPositions.get(b)
    if (a === undefined || b === undefined || a === b || !startRaw || !endRaw) return
    const startSize = clusterSize(a), endSize = clusterSize(b), sizeRatio = Math.min(startSize, endSize)
    if (type !== 2) {
      for (const id of [a, b]) {
        const point = points.get(id), component = componentByPoint.get(id)
        if (finite(point?.sta) === 1 && (!component || component.pointIds.length <= 1)) coverIds.add(id)
      }
    }
    if (type === 0) {
      const bodyWidth = stationLineWidth * 3.5 * sizeRatio
      links.push({ id: `aarc-point-link-${index}`, type, start: startRaw, end: endRaw, sizeRatio, carpetWidth: (stationLineWidth * 4.5) * sizeRatio, bodyWidth, coreWidth: Math.max(0, stationLineWidth * 1.5 * sizeRatio) })
      return
    }
    const bodyWidth = stationLineWidth * sizeRatio, carpetWidth = bodyWidth * 2
    let start = startRaw, end = endRaw
    if (type === 2 || type === 3) {
      const shrinkUnit = stationSize + stationLineWidth * .5
      const startStationSize = finite(points.get(a)?.sta) === 1 ? startSize : 0
      const endStationSize = finite(points.get(b)?.sta) === 1 ? endSize : 0
      start = shrinkTowards(startRaw, endRaw, startStationSize * shrinkUnit + carpetWidth * .5)
      end = shrinkTowards(endRaw, startRaw, endStationSize * shrinkUnit + carpetWidth * .5)
    }
    links.push({ id: `aarc-point-link-${index}`, type, start, end, sizeRatio, carpetWidth, bodyWidth, ...((type === 2 || type === 3) ? { dash: resolveAarcPointLinkDash(start, end, bodyWidth, bodyWidth * 2) } : {}) })
  })

  const covers = [...coverIds].flatMap(pointId => {
    const pos = pointPositions.get(pointId)
    return pos ? [{ pointId, ...pos, sizeRatio: clusterSize(pointId) }] : []
  })
  return { links, covers, colors, stationSize, stationLineWidth }
}
