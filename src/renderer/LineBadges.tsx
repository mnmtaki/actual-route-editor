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
    const size=badge.size,radius=size*.22,textUnits=Math.max(1,[...line.name].reduce((total,character)=>total+(/^[\x00-\x7F]$/.test(character)?.62:1),0)),fontSize=Math.min(size*.48,size*.72/textUnits)
    return <g key={badge.id} className={`map-element line-badge ${selectedId === badge.id ? 'selected' : ''}`} data-line-badge-id={badge.id} data-line-id={line.id} transform={`translate(${badge.x} ${badge.y}) rotate(${badge.rotation})`} onPointerDown={event => onPointerDown?.(event, line, badge)}>
      <rect x={-size / 2} y={-size / 2} width={size} height={size} rx={radius} fill={line.color} stroke="#ffffff" strokeWidth={Math.max(1.2, size * .055)} />
      <text textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontFamily="sans-serif" fontSize={fontSize} fontWeight="700">{line.name}</text>
      {!presentation && <rect data-editor="true" x={-Math.max(size / 2, hitRadius)} y={-Math.max(size / 2, hitRadius)} width={Math.max(size, hitRadius * 2)} height={Math.max(size, hitRadius * 2)} fill="transparent" pointerEvents="all" />}
      {!presentation && selectedId === badge.id && <rect data-editor="true" className="map-element-selection" x={-size / 2 - 5} y={-size / 2 - 5} width={size + 10} height={size + 10} rx={radius + 4} />}
    </g>
  }))}</g>
}
