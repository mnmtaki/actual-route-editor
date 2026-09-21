import { memo } from 'react'
import type { ActualRouteProject, Line, LineBadge } from '../data/model'
import { getEffectiveLineColor, getLineDisplayName } from '../data/lineIdentity'

export const LineBadgesLayer = memo(function LineBadgesLayer({ project, presentation = false, visibleLineIds, selectedId, hitRadius = 22, onPointerDown, includeLabelIds, excludeLabelIds, overlay = false }: {
  project: ActualRouteProject
  presentation?: boolean
  visibleLineIds?: Set<string>
  selectedId?: string
  hitRadius?: number
  onPointerDown?: (event: React.PointerEvent<SVGGElement>, line: Line, badge: LineBadge) => void
  includeLabelIds?: ReadonlySet<string>
  excludeLabelIds?: ReadonlySet<string>
  overlay?: boolean
}) {
  return <g data-layer={overlay ? "line-badges-active-overlay" : "line-badges"} data-line-label-layer="native" pointerEvents={overlay ? "none" : undefined}>{project.lines.flatMap(line => (line.lineBadges ?? []).filter(badge => badge.visible && (!includeLabelIds || includeLabelIds.has(badge.id)) && !excludeLabelIds?.has(badge.id)).map(badge => {
    if (presentation && visibleLineIds && !visibleLineIds.has(line.id)) return null
    const displayName = getLineDisplayName(project, line)
    const color = getEffectiveLineColor(project, line)
    const size = badge.size, radius = Math.max(0, Math.min(size / 2, badge.cornerRadius ?? size * .22))
    const textUnits = Math.max(1, [...displayName].reduce((total, character) => total + (/^[\x00-\x7F]$/.test(character) ? .62 : 1), 0))
    const fontSize = Math.min(size * .48, size * .72 / textUnits)
    return <g key={badge.id} className={`map-element line-label line-badge ${selectedId === badge.id ? 'selected' : ''}`} data-line-label-id={badge.id} data-line-label-source="native" data-line-badge-id={badge.id} data-line-id={line.id} transform={`translate(${badge.x} ${badge.y}) rotate(${badge.rotation})`} onPointerDown={event => onPointerDown?.(event, line, badge)}>
      <rect x={-size / 2} y={-size / 2} width={size} height={size} rx={radius} fill={color} stroke="#ffffff" strokeWidth={Math.max(1.2, size * .055)} />
      <text textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontFamily="sans-serif" fontSize={fontSize} fontWeight="700">{displayName}</text>
      {!presentation && <rect data-editor="true" x={-Math.max(size / 2, hitRadius)} y={-Math.max(size / 2, hitRadius)} width={Math.max(size, hitRadius * 2)} height={Math.max(size, hitRadius * 2)} fill="transparent" pointerEvents="all" />}
      {!presentation && selectedId === badge.id && <rect data-editor="true" className="map-element-selection" x={-size / 2 - 5} y={-size / 2 - 5} width={size + 10} height={size + 10} rx={Math.min((size + 10) / 2, radius + 4)} />}
    </g>
  }))}</g>
})