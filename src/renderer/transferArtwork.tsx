import type { ActualRouteProject, Line, Station, TransferStyle } from '../data/model'
import { getCompoundStationMembers } from '../data/compoundStation'
import { dotX, getDefaultTransferMetrics } from './stationStyles'

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

function numberPill({ x, y, pairs, style }: { x: number; y: number; pairs: ReturnType<typeof serviceCodePairs>; style: TransferStyle }) {
  const gap = 5, cellWidth = 30, height = 18, width = Math.max(42, pairs.length * cellWidth + Math.max(0, pairs.length - 1) * gap)
  return <g data-transfer-template="guangzhou2024" data-service-count={pairs.length}>
    {shell({ x, y, width, height: height + 4, style })}
    {pairs.map((pair, index) => { const cx = x - width / 2 + 5 + cellWidth / 2 + index * (cellWidth + gap); return <g key={pair.line.id} data-transfer-cell="true" data-line-id={pair.line.id}><rect x={cx - cellWidth / 2} y={y - height / 2} width={cellWidth} height={height} rx="3" fill={pair.line.color} /><text x={cx} y={y - 1} textAnchor="middle" fill="#fff" fontSize="8" fontWeight="700">{pair.lineCode}</text><text x={cx} y={y + 7} textAnchor="middle" fill="#fff" fontSize="7">{pair.stationCode || '—'}</text></g> })}
  </g>
}

function guangzhouClassic({ x, y, pairs, style }: { x: number; y: number; pairs: ReturnType<typeof serviceCodePairs>; style: TransferStyle }) {
  const count = pairs.length
  if (count < 2 || count > 4) return <g data-transfer-template="guangzhouClassic" data-transfer-incompatible="true">{shell({ x, y, width: 42, height: 20, style })}</g>
  const positions = count === 2 ? [{ x: x - 24, y }, { x: x + 24, y }] : count === 3 ? [0, 120, 240].map(degrees => ({ x: x + Math.cos((degrees - 90) * Math.PI / 180) * 24, y: y + Math.sin((degrees - 90) * Math.PI / 180) * 24 })) : [{ x: x - 22, y: y - 22 }, { x: x + 22, y: y - 22 }, { x: x + 22, y: y + 22 }, { x: x - 22, y: y + 22 }]
  const arrows = positions.map((from, index) => transferArrow(from, positions[(index + 1) % positions.length], pairs[index].line.color, index, count === 2 ? 10 : 5))
  return <g data-transfer-template="guangzhouClassic" data-service-count={count}>{arrows}{pairs.map((pair, index) => <g key={pair.line.id} data-transfer-cell="true" data-line-id={pair.line.id}><rect x={positions[index].x - 15} y={positions[index].y - 9} width="30" height="18" rx="9" fill={pair.line.color} /><text x={positions[index].x} y={positions[index].y + 3} textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700">{pair.lineCode}</text></g>)}</g>
}

function gridSize(count: number): { rows: number; cols: number } {
  if (count <= 3) return { rows: count, cols: 1 }
  if (count <= 6) return { rows: 2, cols: 2 }
  if (count <= 8) return { rows: 4, cols: 2 }
  const cols = Math.max(2, Math.ceil(Math.sqrt(count))), rows = Math.ceil(count / cols)
  return { rows, cols }
}

function guangzhou2024({ x, y, pairs, style }: { x: number; y: number; pairs: ReturnType<typeof serviceCodePairs>; style: TransferStyle }) {
  const { rows, cols } = gridSize(pairs.length), cellWidth = 44, cellHeight = 24, gap = 5
  const width = cols * cellWidth + (cols - 1) * gap + 8, height = rows * cellHeight + (rows - 1) * gap + 8
  return <g data-transfer-template="guangzhou2024" data-service-count={pairs.length}><rect x={x - width / 2} y={y - height / 2} width={width} height={height} rx="5" fill={style.shellFill} stroke={style.shellStroke} strokeWidth={style.shellStrokeWidth} vectorEffect="non-scaling-stroke" />{pairs.map((pair, index) => { const col = index % cols, row = Math.floor(index / cols), cx = x - (cols - 1) * (cellWidth + gap) / 2 + col * (cellWidth + gap), cy = y - (rows - 1) * (cellHeight + gap) / 2 + row * (cellHeight + gap); return <g key={pair.line.id} data-transfer-cell="true" data-line-id={pair.line.id}><rect x={cx - cellWidth / 2} y={cy - cellHeight / 2} width={cellWidth} height={cellHeight} rx="3" fill={pair.line.color} /><text x={cx} y={cy + 3} textAnchor="middle" fill="#fff" fontSize="10" fontWeight="700">{pair.lineCode} | {pair.stationCode || '—'}</text></g> })}</g>
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
  else if (style.template === 'guangzhou2024') content = guangzhou2024({ x: centerX, y: centerY, pairs, style })
  else if (style.template === 'beijing') content = beijing({ x: centerX, y: centerY, pairs, style, size: props.size })
  else content = kunming({ x: centerX, y: centerY, pairs, style, size: props.size, minorAxis: props.minorAxis, minMajorAxis: props.minMajorAxis })
  return <g transform={rotation ? `rotate(${rotation} ${centerX} ${centerY})` : undefined} data-transfer-style-id={style.id}>{content}</g>
}

export const TransferArtwork = renderTransferArtwork
