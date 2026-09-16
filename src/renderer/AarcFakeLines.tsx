import { memo } from 'react'
import type { ActualRouteProject } from '../data/model'
import { reconstructAarcLineGeometry, type AarcGeometryPoint } from '../import-export/aarcGeometry'
import { resolveAarcLayerGeometry, resolveAarcStyle, resolveAarcStyleLayers } from '../import-export/aarcStyle'
import { resolveAarcLineMetrics } from '../import-export/aarcNormalize'
import { buildRoundedPolylineSpans, pathSpansToSvgPath } from '../geometry/path'

interface RawAarcLine extends Record<string, unknown> {
  id?: unknown
  pts?: unknown
  name?: unknown
  nameSub?: unknown
  color?: unknown
  type?: unknown
  isFake?: unknown
  width?: unknown
  style?: unknown
  parent?: unknown
  zIndex?: unknown
  removeCarpet?: unknown
  isFilled?: unknown
  cap?: unknown
}
interface RawAarcPoint extends Record<string, unknown> {
  id?: unknown
  pos?: unknown
  dir?: unknown
  sta?: unknown
  name?: unknown
  nameS?: unknown
  nameP?: unknown
  nameSize?: unknown
  anchorX?: unknown
  anchorY?: unknown
  noLeader?: unknown
  free?: unknown
}

const numberValue = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}
const idValue = (value: unknown): number | undefined => numberValue(value)
const pairValue = (value: unknown): [number, number] | undefined => Array.isArray(value) && value.length >= 2 && numberValue(value[0]) !== undefined && numberValue(value[1]) !== undefined ? [numberValue(value[0])!, numberValue(value[1])!] : undefined
const textValue = (value: unknown): string => typeof value === 'string' ? value : ''
const colorValue = (value: unknown, fallback = '#64748b') => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback

function sourceSave(project: ActualRouteProject): Record<string, unknown> {
  return project.aarc?.raw && typeof project.aarc.raw === 'object' ? project.aarc.raw : {}
}
function sourceLines(project: ActualRouteProject): RawAarcLine[] {
  const raw = sourceSave(project).lines
  if (Array.isArray(raw)) return raw.filter((item): item is RawAarcLine => Boolean(item && typeof item === 'object'))
  return (project.aarc?.fakeLines ?? []).filter((item): item is RawAarcLine => Boolean(item && typeof item === 'object'))
}
function sourcePoints(project: ActualRouteProject): RawAarcPoint[] {
  const raw = sourceSave(project).points
  return Array.isArray(raw) ? raw.filter((item): item is RawAarcPoint => Boolean(item && typeof item === 'object')) : []
}
function nativeLineForSource(project: ActualRouteProject, sourceId: number | undefined) {
  if (sourceId === undefined) return undefined
  return project.lines.find(line => Number(line.source?.sourceLineId ?? line.source?.lineId) === sourceId)
}

/** Only explicit upstream isFake=true lines belong in this visual-only layer.
 * project.aarc.fakeLines also contains some non-passenger helper lines kept for
 * provenance, so it is intentionally not treated as synonymous with isFake.
 */
export function getAarcFakeSourceLines(project: ActualRouteProject): RawAarcLine[] {
  return sourceLines(project)
    .filter(line => line.isFake === true && Array.isArray(line.pts) && line.pts.length >= 2)
    .sort((a, b) => (numberValue(a.zIndex) ?? 0) - (numberValue(b.zIndex) ?? 0))
}

export function getAarcFakeLineBySourceId(project: ActualRouteProject, sourceId: number | undefined): RawAarcLine | undefined {
  if (sourceId === undefined) return undefined
  return getAarcFakeSourceLines(project).find(line => idValue(line.id) === sourceId)
}

function geometryForLine(line: RawAarcLine, pointsById: Map<number, RawAarcPoint>): AarcGeometryPoint[] {
  return (Array.isArray(line.pts) ? line.pts : []).flatMap(value => {
    const id = idValue(value), raw = id === undefined ? undefined : pointsById.get(id), pos = raw ? pairValue(raw.pos) : undefined
    if (id === undefined || !raw || !pos) return []
    return [{ id, x: pos[0], y: pos[1], dir: numberValue(raw.dir) === 1 ? 1 as const : 0 as const, station: numberValue(raw.sta) === 1, ...(raw.free === true ? { free: true } : {}) }]
  })
}

export function buildAarcFakeLinePath(project: ActualRouteProject, line: RawAarcLine): string {
  const pointsById = new Map(sourcePoints(project).flatMap(point => {
    const id = idValue(point.id)
    return id === undefined ? [] : [[id, point] as const]
  }))
  const geometry = geometryForLine(line, pointsById)
  if (geometry.length < 2) return ''
  const nodes = reconstructAarcLineGeometry(geometry).nodes.map(node => ({ x: node.x, y: node.y }))
  const config = project.aarc?.config ?? {}
  const radius = Math.max(0, numberValue(config.lineTurnAreaRadius) ?? 30)
  return pathSpansToSvgPath(buildRoundedPolylineSpans(nodes, radius))
}

function resolveSourceStyleId(line: RawAarcLine, lines: RawAarcLine[], seen = new Set<number>()): number | undefined {
  const own = numberValue(line.style)
  if (own !== undefined && own !== -1) return own
  const lineId = idValue(line.id), parentId = idValue(line.parent)
  if (lineId !== undefined) {
    if (seen.has(lineId)) return undefined
    seen.add(lineId)
  }
  const parent = parentId === undefined ? undefined : lines.find(item => idValue(item.id) === parentId)
  return parent ? resolveSourceStyleId(parent, lines, seen) : undefined
}

function FakeLineArtwork({ project, line }: { project: ActualRouteProject; line: RawAarcLine }) {
  const sourceId = idValue(line.id)
  const native = nativeLineForSource(project, sourceId)
  if (native && !native.visible) return null
  const path = buildAarcFakeLinePath(project, line)
  if (!path) return null
  const config = project.aarc?.config ?? {}
  const bodyWidth = Math.max(0.01, (numberValue(config.lineWidth) ?? 14) * Math.max(0.01, numberValue(line.width) ?? 1))
  const carpetWiden = Math.max(0, numberValue(config.lineCarpetWiden) ?? 7)
  const bg = colorValue(config.bgColor, '#ffffff')
  const color = colorValue(native?.color ?? line.color)
  const isTerrain = numberValue(line.type) === 1
  const lineCap = line.cap === 'round' || line.cap === 'square' || line.cap === 'butt' ? line.cap : isTerrain ? 'round' : 'butt'
  const allLines = sourceLines(project)
  const sourceStyleId = resolveSourceStyleId(line, allLines)
  const style = resolveAarcStyle(sourceStyleId, project.aarc?.lineStyles)
  const styleLayers = resolveAarcStyleLayers(sourceStyleId, project.aarc?.lineStyles)

  if (isTerrain) {
    const closed = line.isFilled === true || (Array.isArray(line.pts) && line.pts.length > 2 && line.pts[0] === line.pts.at(-1))
    return <g data-aarc-fake-line-id={sourceId ?? ''} data-aarc-fake-line-type="terrain" pointerEvents="none">
      {!line.removeCarpet && <path d={path} fill="none" stroke={bg} strokeWidth={bodyWidth + carpetWiden} strokeLinecap={lineCap} strokeLinejoin="round" data-aarc-fake-line-carpet="true" />}
      <path d={path} fill={closed && line.isFilled === true ? color : 'none'} stroke={color} strokeWidth={bodyWidth} strokeLinecap={lineCap} strokeLinejoin="round" data-aarc-fake-line-body="true" />
    </g>
  }

  return <g data-aarc-fake-line-id={sourceId ?? ''} data-aarc-fake-line-type="common" pointerEvents="none">
    {line.removeCarpet !== true && <path d={path} fill="none" stroke={bg} strokeWidth={bodyWidth + carpetWiden} strokeLinecap={lineCap} strokeLinejoin="round" data-aarc-fake-line-carpet="true" />}
    {style?.noBase !== true && <path d={path} fill="none" stroke={color} strokeWidth={bodyWidth} strokeLinecap={lineCap} strokeLinejoin="round" data-aarc-fake-line-body="true" />}
    {styleLayers.map((layer, index) => {
      const geometry = resolveAarcLayerGeometry(layer, bodyWidth)
      const stroke = layer.colorMode === 'line' ? color : colorValue(geometry.color, color)
      return <path key={`${sourceId ?? 'fake'}-style-${index}`} d={path} fill="none" stroke={stroke} strokeWidth={geometry.width} strokeOpacity={geometry.opacity ?? 1} strokeDasharray={geometry.dash?.join(' ')} strokeLinecap={geometry.cap === 'butt' || geometry.cap === 'square' ? geometry.cap : 'round'} strokeLinejoin={geometry.join === 'miter' || geometry.join === 'bevel' ? geometry.join : 'round'} data-aarc-fake-line-style-layer={index} />
    })}
  </g>
}

function fakeOnlyStationIds(project: ActualRouteProject): Set<number> {
  const lines = sourceLines(project)
  const memberships = new Map<number, RawAarcLine[]>()
  for (const line of lines) for (const value of Array.isArray(line.pts) ? line.pts : []) {
    const pointId = idValue(value)
    if (pointId === undefined) continue
    const list = memberships.get(pointId) ?? []
    list.push(line)
    memberships.set(pointId, list)
  }
  return new Set([...memberships.entries()].filter(([, list]) => list.length > 0 && list.every(line => line.isFake === true)).map(([id]) => id))
}

function FakeOnlyStations({ project }: { project: ActualRouteProject }) {
  const onlyFake = fakeOnlyStationIds(project)
  if (!onlyFake.size) return null
  const lines = sourceLines(project)
  const config = project.aarc?.config ?? {}
  const baseRadius = Math.max(1, numberValue(config.ptStaSize) ?? 10)
  const border = Math.max(0, numberValue(config.ptStaLineWidth) ?? 4)
  const fill = colorValue(config.ptStaFillColor, '#ffffff')
  const stroke = colorValue(config.ptStaExchangeLineColor, '#999999')
  const nameColor = colorValue(config.staNameColor, '#202526')
  const subColor = colorValue(config.staNameSubColor, '#999999')
  const fontSizeBase = Math.max(4, numberValue(config.staNameFontSize) ?? 26)
  const subSizeBase = Math.max(4, numberValue(config.staNameSubFontSize) ?? 16)
  return <g data-aarc-fake-only-stations="true" pointerEvents="none">{sourcePoints(project).flatMap(point => {
    const pointId = idValue(point.id), pos = pairValue(point.pos)
    if (pointId === undefined || !onlyFake.has(pointId) || numberValue(point.sta) !== 1 || !pos) return []
    const memberships = lines.filter(line => Array.isArray(line.pts) && line.pts.some(value => idValue(value) === pointId))
    if (memberships.length && memberships.every(line => nativeLineForSource(project, idValue(line.id))?.visible === false)) return []
    const sizeRatio = memberships.length ? Math.max(...memberships.map(line => resolveAarcLineMetrics(line, config).ptSize)) : 1
    const radius = baseRadius * sizeRatio
    const nameP = pairValue(point.nameP), primary = textValue(point.name), secondary = textValue(point.nameS)
    const nameRatio = numberValue(point.nameSize) || (memberships.length ? Math.max(...memberships.map(line => resolveAarcLineMetrics(line, config).ptNameSize)) : 1)
    const labelX = nameP ? pos[0] + nameP[0] : pos[0], labelY = nameP ? pos[1] + nameP[1] : pos[1]
    const ax = numberValue(point.anchorX) ?? (nameP ? Math.sign(nameP[0]) : 0), ay = numberValue(point.anchorY) ?? (nameP ? Math.sign(nameP[1]) : 0)
    const textAnchor = ax < 0 ? 'end' : ax > 0 ? 'start' : 'middle'
    const leader = Boolean(nameP && point.noLeader !== true && (point.noLeader === false || Math.hypot(nameP[0], nameP[1]) > radius * 2.5))
    return [<g key={`fake-station-${pointId}`} data-aarc-fake-only-station-id={pointId}>
      <circle cx={pos[0]} cy={pos[1]} r={radius} fill={fill} stroke={stroke} strokeWidth={border * sizeRatio} />
      {leader && <line x1={pos[0]} y1={pos[1]} x2={labelX} y2={labelY} stroke="#999999" strokeWidth={Math.max(1, nameRatio * 2)} />}
      {nameP && primary && <text x={labelX} y={labelY + (ay < 0 ? -2 : fontSizeBase * nameRatio)} textAnchor={textAnchor} fontFamily={textValue(config.staNameFont) || 'sans-serif'} fontSize={fontSizeBase * nameRatio} fontWeight={textValue(config.staNameFontWeight) || 'normal'} fill={nameColor} data-aarc-fake-station-name="true">{primary}{secondary && <tspan x={labelX} dy={subSizeBase * nameRatio * 1.25} fontFamily={textValue(config.staNameSubFont) || 'sans-serif'} fontSize={subSizeBase * nameRatio} fill={subColor}>{secondary}</tspan>}</text>}
    </g>]
  })}</g>
}

export const AarcFakeLinesLayer = memo(function AarcFakeLinesLayer({ project }: { project: ActualRouteProject }) {
  const fakeLines = getAarcFakeSourceLines(project)
  if (!fakeLines.length) return null
  return <g data-layer="aarc-fake-lines" pointerEvents="none">
    {fakeLines.filter(line => numberValue(line.type) === 1).map((line, index) => <FakeLineArtwork key={`fake-terrain-${idValue(line.id) ?? index}`} project={project} line={line} />)}
    {fakeLines.filter(line => numberValue(line.type) !== 1).map((line, index) => <FakeLineArtwork key={`fake-common-${idValue(line.id) ?? index}`} project={project} line={line} />)}
    <FakeOnlyStations project={project} />
  </g>
})
