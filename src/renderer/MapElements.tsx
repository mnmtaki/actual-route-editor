import type { ActualRouteProject, MapElement } from '../data/model'

export function MapElementsLayer({ project, presentation = false, visibleLineIds, selectedId, hitRadius = 22, onPointerDown }: {
  project: ActualRouteProject
  presentation?: boolean
  visibleLineIds?: Set<string>
  selectedId?: string
  hitRadius?: number
  onPointerDown?: (event: React.PointerEvent<SVGGElement>, element: MapElement) => void
}) {
  return <g data-layer="map-elements">{(project.mapElements ?? []).filter(element => element.visible).map(element => {
    if (element.type === 'lineBadge') {
      const line = project.lines.find(item => item.id === element.lineId)
      if (!line || (presentation && visibleLineIds && !visibleLineIds.has(line.id))) return null
      const height = element.size, width = Math.max(height, height * (.72 + [...line.name].length * .58)), radius = height * .22
      return <g key={element.id} className={`map-element line-badge ${selectedId === element.id ? 'selected' : ''}`} data-map-element-id={element.id} transform={`translate(${element.x} ${element.y}) rotate(${element.rotation})`} onPointerDown={event => onPointerDown?.(event, element)}>
        <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={radius} fill={line.color} stroke="#ffffff" strokeWidth={Math.max(1.2, height * .055)} />
        <text textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontFamily="sans-serif" fontSize={height * .48} fontWeight="700">{line.name}</text>
        {!presentation && <rect data-editor="true" x={-Math.max(width / 2, hitRadius)} y={-Math.max(height / 2, hitRadius)} width={Math.max(width, hitRadius * 2)} height={Math.max(height, hitRadius * 2)} fill="transparent" pointerEvents="all" />}
        {!presentation && selectedId === element.id && <rect data-editor="true" className="map-element-selection" x={-width / 2 - 5} y={-height / 2 - 5} width={width + 10} height={height + 10} rx={radius + 4} />}
      </g>
    }
    const lines = element.text.split('\n'), anchor = element.textAlign === 'start' ? 'start' : element.textAlign === 'end' ? 'end' : 'middle'
    const estimatedWidth = Math.max(1, ...lines.map(line => [...line].length)) * element.fontSize, height = Math.max(1, lines.length) * element.fontSize * 1.2
    return <g key={element.id} className={`map-element free-text ${selectedId === element.id ? 'selected' : ''}`} data-map-element-id={element.id} transform={`translate(${element.x} ${element.y}) rotate(${element.rotation})`} onPointerDown={event => onPointerDown?.(event, element)}>
      <text textAnchor={anchor} fill="#303532" fontFamily="sans-serif" fontSize={element.fontSize} fontWeight={element.fontWeight}>{lines.map((line, index) => <tspan key={index} x="0" dy={index === 0 ? 0 : element.fontSize * 1.2}>{line || ' '}</tspan>)}</text>
      {!presentation && <rect data-editor="true" x={element.textAlign === 'start' ? 0 : element.textAlign === 'end' ? -estimatedWidth : -estimatedWidth / 2} y={-element.fontSize} width={Math.max(estimatedWidth, hitRadius * 2)} height={Math.max(height, hitRadius * 2)} fill="transparent" pointerEvents="all" />}
      {!presentation && selectedId === element.id && <rect data-editor="true" className="map-element-selection" x={element.textAlign === 'start' ? -4 : element.textAlign === 'end' ? -estimatedWidth - 4 : -estimatedWidth / 2 - 4} y={-element.fontSize - 4} width={estimatedWidth + 8} height={height + 8} rx="4" />}
    </g>
  })}</g>
}
