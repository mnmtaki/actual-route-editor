import type { Line, Station } from '../data/model'

export interface OrdinaryStationRenderProps { station: Station; size: number }
export interface TransferStationRenderProps { station: Station; lines: Line[]; size: number; rotation: number; gapRatio: number; paddingRatio: number }
export interface StationStyleDefinition {
  id: string
  name: string
  renderOrdinary: (props: OrdinaryStationRenderProps) => React.ReactNode
  renderTransfer: (props: TransferStationRenderProps) => React.ReactNode
}

export function getDefaultTransferMetrics(size: number, count: number, gapRatio: number, paddingRatio: number) {
  const gap = Math.max(2, size * gapRatio)
  const horizontalPadding = Math.max(2.5, size * paddingRatio)
  const verticalPadding = Math.max(2, size * .18)
  return {
    dotDiameter: size,
    gap,
    horizontalPadding,
    height: size + verticalPadding * 2,
    width: horizontalPadding * 2 + count * size + Math.max(0, count - 1) * gap,
  }
}

export const DEFAULT_STATION_STYLE: StationStyleDefinition = {
  id: 'default',
  name: '默认站点',
  renderOrdinary: ({ station, size }) => <circle cx={station.x} cy={station.y} r={size / 2} fill="white" data-testid={`station-${station.id}`} />,
  renderTransfer: ({ station, lines, size, rotation, gapRatio, paddingRatio }) => {
    const metrics = getDefaultTransferMetrics(size, lines.length, gapRatio, paddingRatio)
    return <g transform={`rotate(${rotation} ${station.x} ${station.y})`} data-testid={`transfer-${station.id}`}>
      <rect x={station.x - metrics.width / 2} y={station.y - metrics.height / 2} width={metrics.width} height={metrics.height} rx={metrics.height / 2} fill="white" />
      {lines.map((line, index) => <circle key={line.id} cx={station.x - metrics.width / 2 + metrics.horizontalPadding + size / 2 + index * (size + metrics.gap)} cy={station.y} r={size / 2} fill={line.color} />)}
    </g>
  },
}

const STATION_STYLES: Record<string, StationStyleDefinition> = { [DEFAULT_STATION_STYLE.id]: DEFAULT_STATION_STYLE }
export function getStationStyle(styleId: string | undefined): StationStyleDefinition { return STATION_STYLES[styleId ?? 'default'] ?? DEFAULT_STATION_STYLE }
