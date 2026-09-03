import type { LineLegend, ActualRouteProject } from '../data/model'
import { getLineLegendLayout } from '../data/lineLegend'

export function LineLegendLayer({ project, presentation = false, selectedId, hitRadius = 22, onPointerDown }: {
  project: ActualRouteProject
  presentation?: boolean
  selectedId?: string
  hitRadius?: number
  onPointerDown?: (event: React.PointerEvent<SVGGElement>, legend: LineLegend) => void
}) {
  const legend = project.lineLegend
  if (!legend || !legend.visible) return null
  const layout = getLineLegendLayout(project, legend)
  const labelFont = project.settings.stationLabelFontFamily || 'sans-serif'
  const foreignFont = project.settings.stationForeignLabelFontFamily || 'sans-serif'
  const title = legend.title || ''
  const foreignTitle = legend.foreignTitle || ''
  return <g data-layer="line-legend" data-line-legend-id={legend.id} className={`line-legend ${legend.locked ? 'locked' : ''} ${selectedId === legend.id ? 'selected' : ''}`} transform={`translate(${legend.x} ${legend.y}) scale(${legend.scale})`} pointerEvents={legend.locked && !presentation ? 'none' : undefined} onPointerDown={event => onPointerDown?.(event, legend)}>
    {legend.backgroundEnabled && <rect className="line-legend-background" x="0" y="0" width={layout.width} height={layout.height} rx="0" fill={legend.backgroundColor} opacity={legend.backgroundOpacity} />}
    {!presentation && !legend.locked && <rect data-editor="true" className="line-legend-hit" x={-Math.max(0, hitRadius / legend.scale - layout.width * .0)} y={-Math.max(0, hitRadius / legend.scale - layout.height * .0)} width={layout.width + Math.max(0, hitRadius / legend.scale * 2)} height={layout.height + Math.max(0, hitRadius / legend.scale * 2)} fill="transparent" pointerEvents="all" />}
    {(title || foreignTitle) && <text className="line-legend-title" x={layout.padding} y={layout.padding + (title ? 28 : 18)} fill="#303532" fontFamily={labelFont} fontSize={title && foreignTitle ? 28 : 24} fontWeight="700">{title}</text>}
    {foreignTitle && <text className="line-legend-foreign-title" x={layout.padding} y={layout.padding + (title ? 50 : 30)} fill="#858b87" fontFamily={foreignFont} fontSize="16" fontWeight="600">{foreignTitle}</text>}
    {layout.items.map(item => {
      const primaryLineY = item.y + 24
      let currentY = primaryLineY
      const foreignLineY = item.y + 43
      const terminalY = item.y + (item.foreignLineName && legend.showForeignLineName ? 64 : 45)
      const foreignTerminalY = terminalY + 16
      const foreignTerminals = item.isRing || item.singleStation ? item.firstStationForeign : [item.firstStationForeign, item.lastStationForeign].filter(Boolean).join(' - ')
      const terminals = item.isRing || item.singleStation ? item.firstStation : [item.firstStation, item.lastStation].filter(Boolean).join(' - ')
      return <g key={item.lineId} className="line-legend-item" data-line-legend-line-id={item.lineId}>
        <rect className="line-legend-strip" x={item.x} y={item.y + 5} width="8" height={Math.max(10, item.height - 10)} fill={project.lines.find(line => line.id === item.lineId)?.color ?? '#888'} />
        <text className="line-legend-line-name" x={item.x + 16} y={currentY} fill="#303532" fontFamily={labelFont} fontSize="20" fontWeight="700">{item.lineName}</text>
        {legend.showForeignLineName && item.foreignLineName && <text className="line-legend-line-foreign" x={item.x + 16} y={foreignLineY} fill="#858b87" fontFamily={foreignFont} fontSize="14" fontWeight="600">{item.foreignLineName}</text>}
        {legend.showTerminals && terminals && <>
          <text className="line-legend-terminals" x={item.x + 16} y={terminalY} fill="#4f5752" fontFamily={labelFont} fontSize="15" fontWeight="500">{terminals}</text>
          {legend.showForeignTerminals && foreignTerminals && <text className="line-legend-foreign-terminals" x={item.x + 16} y={foreignTerminalY} fill="#858b87" fontFamily={foreignFont} fontSize="12" fontWeight="500">{foreignTerminals}</text>}
        </>}
      </g>
    })}
    {!presentation && selectedId === legend.id && <rect data-editor="true" className="map-element-selection line-legend-selection" x="0" y="0" width={layout.width} height={layout.height} rx="4" />}
  </g>
}
