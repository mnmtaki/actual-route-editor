import type { ActualRouteProject, Line, Station, TransferStyle } from '../data/model'
import { getCompoundStationMembers } from '../data/compoundStation'
import { getStationAnchorForLine } from '../data/stationAnchor'
import { getStationLineTangent } from '../geometry/tangent'
import { sampleSegmentNearStation } from '../geometry/path'
import { dotX, getDefaultTransferMetrics } from './stationStyles'
import { getGuangzhouStationPillMetrics, GuangzhouStationPill } from './guangzhouArtwork'

export interface TransferArtworkProps {
  project: ActualRouteProject
  station: Station
  lines: Line[]
  style: TransferStyle
  size: number
  minorAxis: number
  dotGap: number
  endPadding: number
  rotation?: number
  centerX?: number
  centerY?: number
  minMajorAxis?: number
}

export function getLineDisplayCode(line: Line): string {
  const explicit = line.displayCode ?? line.number ?? line.code ?? line.shortName
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  const match = /^\s*(\d{1,3})/.exec(line.name)
  return match?.[1] ?? line.name.trim().slice(0, 4)
}

export function getStationCodeForLine(project: ActualRouteProject, stationId: string, lineId: string): string {
  const memberIds = new Set(getCompoundStationMembers(project, stationId).map(item => item.id))
  return project.stationLineRelations.find(relation => memberIds.has(relation.stationId) && relation.lineId === lineId && typeof relation.stationCode === 'string' && relation.stationCode.trim())?.stationCode?.trim() ?? ''
}

function serviceCodePairs(project: ActualRouteProject, station: Station, lines: Line[]) {
  return lines.map(line => ({ line, lineCode: getLineDisplayCode(line), stationCode: getStationCodeForLine(project, station.id, line.id) }))
}

function shell({ x, y, width, height, style, className = 'transfer-shell' }: { x: number; y: number; width: number; height: number; style: TransferStyle; className?: string }) {
  return <rect className={className} x={x - width / 2} y={y - height / 2} width={width} height={height} rx={height / 2} fill={style.shellFill} stroke={style.shellStroke} strokeWidth={style.shellStrokeWidth} vectorEffect="non-scaling-stroke" />
}

function defaultTransfer({ x, y, lines, size, minorAxis, dotGap, endPadding, minMajorAxis, style, stationId }: Omit<TransferArtworkProps, 'project' | 'station'> & { x: number; y: number; stationId?: string }) {
  const metrics = getDefaultTransferMetrics(size, lines.length, dotGap, endPadding, minorAxis, minMajorAxis)
  return <g data-testid={stationId ? `transfer-${stationId}` : undefined} data-transfer-template="default" data-service-count={lines.length}>
    <rect x={x - metrics.width / 2} y={y - metrics.height / 2} width={metrics.width} height={metrics.height} rx={metrics.height / 2} fill={style.shellFill} stroke={style.shellStroke} strokeWidth={style.shellStrokeWidth} vectorEffect="non-scaling-stroke" />
    {style.dotsVisible && lines.map((line, index) => <circle key={line.id} data-transfer-dot="true" cx={dotX(x, metrics, index)} cy={y} r={metrics.dotDiameter / 2} fill={line.color} stroke="none" />)}
  </g>
}

function adaptiveCapsule({ x, y, lines, size, minorAxis, dotGap, endPadding, minMajorAxis, style, template }: Omit<TransferArtworkProps, 'project' | 'station'> & { x: number; y: number; template: string }) {
  const natural = Math.max(size * 1.6, endPadding * 2 + Math.max(1, lines.length) * size * .58 + Math.max(0, lines.length - 1) * dotGap)
  const width = Math.max(natural, minMajorAxis ?? 0)
  const height = Math.max(minorAxis, size * .82)
  return <g data-transfer-template={template} data-service-count={lines.length} data-dots-visible="false">{shell({ x, y, width, height, style })}</g>
}

function transferArrow(from: { x: number; y: number }, to: { x: number; y: number }, color: string, index: number, curvature = 8) {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1
  const nx = -dy / length, ny = dx / length, mx = (from.x + to.x) / 2 + nx * curvature, my = (from.y + to.y) / 2 + ny * curvature
  const tx = to.x - dx / length * 5, ty = to.y - dy / length * 5
  const angle = Math.atan2(dy, dx) * 180 / Math.PI
  return <g key={index} data-transfer-arrow="true" data-arrow-index={index} fill={color}>
    <path d={`M ${from.x} ${from.y} Q ${mx} ${my} ${tx} ${ty}`} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
    <path d="M -4 -3 L 4 0 L -4 3 Z" transform={`translate(${to.x} ${to.y}) rotate(${angle})`} />
  </g>
}

type GuangzhouServicePair = ReturnType<typeof serviceCodePairs>[number]
interface GuangzhouPillPosition { pair: GuangzhouServicePair; x: number; y: number; width: number; height: number; angle: number }

const GUANGZHOU_PILL_HEIGHT = 18
const GUANGZHOU_PILL_GAP = 24
const GUANGZHOU_SHELL_PADDING = 9
const GUANGZHOU_MIN_ANGLE = Math.PI / 9
const GUANGZHOU_MIN_CENTER_GAP = 12

function pillMetrics(pair: GuangzhouServicePair) {
  return getGuangzhouStationPillMetrics(pair.lineCode, pair.stationCode, undefined, GUANGZHOU_PILL_HEIGHT)
}

function renderGuangzhouPill(item: GuangzhouPillPosition) {
  return <g key={item.pair.line.id} data-transfer-cell="true" data-line-id={item.pair.line.id} data-guangzhou-pill-position-x={item.x} data-guangzhou-pill-position-y={item.y}>
    <GuangzhouStationPill x={item.x} y={item.y} lineCode={item.pair.lineCode} stationCode={item.pair.stationCode} serviceColor={item.pair.line.color} lineId={item.pair.line.id} width={item.width} height={item.height} />
  </g>
}

function classicPillPositions(x: number, y: number, pairs: GuangzhouServicePair[]): GuangzhouPillPosition[] {
  const metrics = pairs.map(pillMetrics)
  if (pairs.length === 2) {
    const separation = (metrics[0].width + metrics[1].width) / 2 + GUANGZHOU_PILL_GAP
    return [{ pair: pairs[0], x: x - separation / 2, y, width: metrics[0].width, height: metrics[0].height, angle: 0 }, { pair: pairs[1], x: x + separation / 2, y, width: metrics[1].width, height: metrics[1].height, angle: 0 }]
  }
  if (pairs.length === 3) {
    const radius = Math.max(38, ...metrics.map(item => item.width / 2 + GUANGZHOU_PILL_GAP / 2))
    return metrics.map((item, index) => { const angle = -Math.PI / 2 + index * 2 * Math.PI / 3; return { pair: pairs[index], x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius, width: item.width, height: item.height, angle } })
  }
  const half = Math.max(29, ...metrics.map(item => item.width / 2 + GUANGZHOU_PILL_GAP / 2))
  return metrics.map((item, index) => { const col = index % 2, row = Math.floor(index / 2); return { pair: pairs[index], x: x + (col ? half : -half), y: y + (row ? half : -half), width: item.width, height: item.height, angle: Math.atan2(row ? 1 : -1, col ? 1 : -1) } })
}

function directionAngle(project: ActualRouteProject, station: Station, pair: GuangzhouServicePair, index: number, count: number): number {
  const anchor = getStationAnchorForLine(project, station.id, pair.line.id)
  if (anchor) {
    const dx = anchor.x - station.x, dy = anchor.y - station.y
    if (Math.hypot(dx, dy) > 1e-7) return Math.atan2(dy, dx)
  }
  const connected = project.geometry.segments
    .filter(segment => segment.lineId === pair.line.id && (segment.fromStationId === station.id || segment.toStationId === station.id))
    .sort((left, right) => left.id.localeCompare(right.id))
  const sample = connected.map(segment => sampleSegmentNearStation(project, segment, station.id, .08, pair.line.id)).find((point): point is { x: number; y: number } => Boolean(point))
  if (sample) {
    const dx = sample.x - station.x, dy = sample.y - station.y
    if (Math.hypot(dx, dy) > 1e-7) return Math.atan2(dy, dx)
  }
  const tangent = getStationLineTangent(project, station.id, pair.line.id)
  if (Number.isFinite(tangent)) return tangent * Math.PI / 180
  return -Math.PI / 2 + index * 2 * Math.PI / Math.max(1, count)
}

function angularDistance(left: number, right: number): number {
  const delta = Math.abs(left - right) % (2 * Math.PI)
  return Math.min(delta, 2 * Math.PI - delta)
}

function spatialPillPositions(project: ActualRouteProject, station: Station, x: number, y: number, pairs: GuangzhouServicePair[]): GuangzhouPillPosition[] {
  const angles = pairs.map((pair, index) => directionAngle(project, station, pair, index, pairs.length))
  for (let index = 0; index < angles.length; index += 1) {
    while (angles.some((other, otherIndex) => otherIndex !== index && angularDistance(angles[index], other) < GUANGZHOU_MIN_ANGLE)) angles[index] += GUANGZHOU_MIN_ANGLE
  }
  const metrics = pairs.map(pillMetrics)
  let radius = 34
  for (let first = 0; first < metrics.length; first += 1) for (let second = first + 1; second < metrics.length; second += 1) {
    const sine = Math.abs(Math.sin((angles[second] - angles[first]) / 2))
    const required = (metrics[first].width + metrics[second].width) / 2 + GUANGZHOU_MIN_CENTER_GAP
    radius = Math.max(radius, sine > 1e-4 ? required / (2 * sine) : required + 18 + first + second)
  }
  return metrics.map((item, index) => ({ pair: pairs[index], x: x + Math.cos(angles[index]) * radius, y: y + Math.sin(angles[index]) * radius, width: item.width, height: item.height, angle: angles[index] }))
}

function guangzhouArrow(from: GuangzhouPillPosition, to: GuangzhouPillPosition, color: string, index: number, curvature: number) {
  const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy) || 1
  const ux = dx / distance, uy = dy / distance, nx = -uy, ny = ux
  const startDistance = from.width / 2 + 4, tipDistance = to.width / 2 + 6
  const start = { x: from.x + ux * startDistance, y: from.y + uy * startDistance }
  const tip = { x: to.x - ux * tipDistance, y: to.y - uy * tipDistance }
  const base = { x: tip.x - ux * 6, y: tip.y - uy * 6 }
  const control = { x: (start.x + base.x) / 2 + nx * curvature, y: (start.y + base.y) / 2 + ny * curvature }
  const angle = Math.atan2(uy, ux) * 180 / Math.PI
  return <g key={index} data-transfer-arrow="true" data-arrow-index={index} data-guangzhou-arrow="true" fill={color}>
    <path d={`M ${start.x} ${start.y} Q ${control.x} ${control.y} ${base.x} ${base.y}`} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
    <path d="M -5 -3 L 1 0 L -5 3 Z" transform={`translate(${tip.x} ${tip.y}) rotate(${angle})`} />
  </g>
}

function guangzhouClassic({ x, y, pairs, style }: { x: number; y: number; pairs: GuangzhouServicePair[]; style: TransferStyle }) {
  const count = pairs.length
  if (count < 2 || count > 4) return <g data-transfer-template="guangzhouClassic" data-transfer-incompatible="true">{shell({ x, y, width: 42, height: 20, style })}</g>
  const positions = classicPillPositions(x, y, pairs)
  const arrows = positions.map((from, index) => guangzhouArrow(from, positions[(index + 1) % positions.length], pairs[index].line.color, index, count === 2 ? -14 : 8))
  return <g data-transfer-template="guangzhouClassic" data-service-count={count} data-guangzhou-pill-count={count}>{arrows}{positions.map(renderGuangzhouPill)}</g>
}

function guangzhou2024({ project, station, x, y, pairs, style }: { project: ActualRouteProject; station: Station; x: number; y: number; pairs: GuangzhouServicePair[]; style: TransferStyle }) {
  const positions = spatialPillPositions(project, station, x, y, pairs)
  const minX = Math.min(...positions.map(item => item.x - item.width / 2)), maxX = Math.max(...positions.map(item => item.x + item.width / 2))
  const minY = Math.min(...positions.map(item => item.y - item.height / 2)), maxY = Math.max(...positions.map(item => item.y + item.height / 2))
  const shellX = (minX + maxX) / 2, shellY = (minY + maxY) / 2, shellWidth = maxX - minX + GUANGZHOU_SHELL_PADDING * 2, shellHeight = maxY - minY + GUANGZHOU_SHELL_PADDING * 2
  return <g data-transfer-template="guangzhou2024" data-service-count={pairs.length} data-guangzhou-pill-count={pairs.length} data-guangzhou-layout="spatial">
    <rect data-guangzhou-shell="true" x={shellX - shellWidth / 2} y={shellY - shellHeight / 2} width={shellWidth} height={shellHeight} rx={Math.min(12, shellHeight / 2)} fill={style.shellFill || 'white'} stroke="#8f9599" strokeWidth={Math.max(1.25, style.shellStrokeWidth)} vectorEffect="non-scaling-stroke" />
    {positions.map(renderGuangzhouPill)}
  </g>
}

function beijing({ x, y, pairs, style, size }: { x: number; y: number; pairs: ReturnType<typeof serviceCodePairs>; style: TransferStyle; size: number }) {
  const radius = Math.max(size * 1.15, 18), point = (angle: number, r = radius * .68) => ({ x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r })
  const arc = (start: number, end: number, color: string, index: number) => { const from = point(start), to = point(end); const large = Math.abs(end - start) > Math.PI ? 1 : 0; return <g key={index} data-transfer-arrow="true" data-arrow-index={index}><path d={`M ${from.x} ${from.y} A ${radius * .68} ${radius * .68} 0 ${large} 1 ${to.x} ${to.y}`} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" /><path d="M -4 -3 L 4 0 L -4 3 Z" transform={`translate(${to.x} ${to.y}) rotate(${end * 180 / Math.PI + 90})`} fill={color}/></g> }
  return <g data-transfer-template="beijing" data-service-count={pairs.length}><circle cx={x} cy={y} r={radius} fill={style.shellFill} stroke={style.shellStroke} strokeWidth={style.shellStrokeWidth} vectorEffect="non-scaling-stroke" />{arc(-Math.PI * .78, Math.PI * .12, pairs[0]?.line.color ?? '#64748b', 0)}{arc(Math.PI * .22, Math.PI * 1.12, pairs[1]?.line.color ?? pairs[0]?.line.color ?? '#64748b', 1)}</g>
}

function kunming({ x, y, pairs, style, size, minorAxis, minMajorAxis }: { x: number; y: number; pairs: ReturnType<typeof serviceCodePairs>; style: TransferStyle; size: number; minorAxis: number; minMajorAxis?: number }) {
  if (pairs.length === 2) {
    const width = Math.max(size * 4.2, minMajorAxis ?? 0), height = Math.max(minorAxis, size * 1.25)
    return <g data-transfer-template="kunming" data-service-count="2" data-kunming-shape="capsule">{shell({ x, y, width, height, style })}{transferArrow({ x: x - width * .28, y: y - height * .12 }, { x: x + width * .28, y: y - height * .12 }, pairs[0].line.color, 0, 9)}{transferArrow({ x: x + width * .28, y: y + height * .12 }, { x: x - width * .28, y: y + height * .12 }, pairs[1].line.color, 1, -9)}</g>
  }
  const radius = Math.max(size * 1.8, minorAxis / 2), arrowRadius = radius * .62
  const arrows = pairs.map((pair, index) => { const start = -Math.PI / 2 + index * 2 * Math.PI / pairs.length, end = start + Math.PI * 1.18; const from = { x: x + Math.cos(start) * arrowRadius, y: y + Math.sin(start) * arrowRadius }, to = { x: x + Math.cos(end) * arrowRadius, y: y + Math.sin(end) * arrowRadius }; const large = Math.abs(end - start) > Math.PI ? 1 : 0; return <g key={pair.line.id} data-transfer-arrow="true" data-arrow-index={index}><path d={`M ${from.x} ${from.y} A ${arrowRadius} ${arrowRadius} 0 ${large} 1 ${to.x} ${to.y}`} fill="none" stroke={pair.line.color} strokeWidth="3" strokeLinecap="round" /><path d="M -4 -3 L 4 0 L -4 3 Z" transform={`translate(${to.x} ${to.y}) rotate(${end * 180 / Math.PI + 90})`} fill={pair.line.color}/></g> })
  return <g data-transfer-template="kunming" data-service-count={pairs.length} data-kunming-shape="circle"><circle cx={x} cy={y} r={radius} fill={style.shellFill} stroke={style.shellStroke} strokeWidth={style.shellStrokeWidth} vectorEffect="non-scaling-stroke" />{arrows}</g>
}

export function renderTransferArtwork(props: TransferArtworkProps) {
  const { project, station, lines, style, rotation = 0, centerX = station.x, centerY = station.y } = props
  const pairs = serviceCodePairs(project, station, lines)
  let content: React.ReactNode
  if (style.template === 'default') content = defaultTransfer({ ...props, x: centerX, y: centerY, stationId: station.id })
  else if (style.template === 'shanghai' || style.template === 'metroman') content = adaptiveCapsule({ ...props, x: centerX, y: centerY, template: style.template })
  else if (style.template === 'guangzhouClassic') content = guangzhouClassic({ x: centerX, y: centerY, pairs, style })
  else if (style.template === 'guangzhou2024') content = guangzhou2024({ project, station, x: centerX, y: centerY, pairs, style })
  else if (style.template === 'beijing') content = beijing({ x: centerX, y: centerY, pairs, style, size: props.size })
  else content = kunming({ x: centerX, y: centerY, pairs, style, size: props.size, minorAxis: props.minorAxis, minMajorAxis: props.minMajorAxis })
  return <g transform={rotation ? `rotate(${rotation} ${centerX} ${centerY})` : undefined} data-transfer-style-id={style.id}>{content}</g>
}

export const TransferArtwork = renderTransferArtwork
