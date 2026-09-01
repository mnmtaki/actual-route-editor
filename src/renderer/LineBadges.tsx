import type { ActualRouteProject, Line, LineBadge } from '../data/model'

export function LineBadgesLayer({ project, presentation = false, visibleLineIds, selectedId, hitRadius = 22, onPointerDown }: {
  project: ActualRouteProject
  presentation?: boolean
  visibleLineIds?: Set<string>
  selectedId?: string
  hitRadius?: number
  onPointerDown?: (event: React.PointerEvent<SVGGElement>, line: Line, badge: LineBadge) => void
}) {
  return <g data-layer="line-badges">{project.lines.flatMap(line => (line.lineBadges ?? []).filter(badge => badge.visible).map(badge => {
    if (presentation && visibleLineIds && !visibleLineIds.has(line.id)) return null
    const height = badge.size, width = Math.max(height, height * (.72 + [...line.name].length * .58)), radius = height * .22
    return <g key={badge.id} className={`map-element line-badge ${selectedId === badge.id ? 'selected' : ''}`} data-line-badge-id={badge.id} data-line-id={line.id} transform={`translate(${badge.x} ${badge.y}) rotate(${badge.rotation})`} onPointerDown={event => onPointerDown?.(event, line, badge)}>
      <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={radius} fill={line.color} stroke="#ffffff" strokeWidth={Math.max(1.2, height * .055)} />
      <text textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontFamily="sans-serif" fontSize={height * .48} fontWeight="700">{line.name}</text>
      {!presentation && <rect data-editor="true" x={-Math.max(width / 2, hitRadius)} y={-Math.max(height / 2, hitRadius)} width={Math.max(width, hitRadius * 2)} height={Math.max(height, hitRadius * 2)} fill="transparent" pointerEvents="all" />}
      {!presentation && selectedId === badge.id && <rect data-editor="true" className="map-element-selection" x={-width / 2 - 5} y={-height / 2 - 5} width={width + 10} height={height + 10} rx={radius + 4} />}
    </g>
  }))}</g>
}
