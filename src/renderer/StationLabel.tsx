import type { ProjectSettings, Station } from '../data/model'
import { effectiveLabelRotation, resolveLabelAnchor } from '../data/style'
import { getAarcLabelAlignmentOffset, getAarcLabelBlockMetrics, resolveAarcLabelAnchor } from '../import-export/aarcVisualStyle'

export function StationLabel({ station, settings, showForeign, presentation=false, opacity, onPointerDown }:{ station:Station; settings:ProjectSettings; showForeign:boolean; presentation?:boolean; opacity?:number; onPointerDown?:(event:React.PointerEvent<SVGGElement>)=>void }){
  const labelSize=settings.stationLabelSize,foreignLabelSize=settings.stationForeignLabelSize,foreignLabelGap=settings.foreignLabelGap,rotation=effectiveLabelRotation(station,settings)
  const x=station.x+station.labelOffsetX,y=station.y+station.labelOffsetY
  const foreignLines=showForeign&&station.nameS?station.nameS.split(/\r?\n/):[]
  const foreignStart=labelSize+foreignLabelGap
  const anchor=resolveLabelAnchor(station.labelOffsetX,station.labelOffsetY)
  if(station.source?.labelAnchorMode==='aarc-block'){
    const blockAnchor=resolveAarcLabelAnchor([station.labelOffsetX,station.labelOffsetY])
    const fontWeight=station.source.stationNameFontWeight??'normal'
    const metrics=getAarcLabelBlockMetrics(labelSize,foreignLabelSize,foreignLabelGap,foreignLines.length)
    const alignmentOffset=getAarcLabelAlignmentOffset(blockAnchor.horizontalAlign,blockAnchor.verticalAlign)
    const blockX=alignmentOffset.x
    const blockY=(blockAnchor.verticalAlign==='top'?0:blockAnchor.verticalAlign==='bottom'?-metrics.height:-metrics.height/2)+alignmentOffset.y
    return <g className="station-label-group aarc-station-label-group" transform={`translate(${x} ${y}) rotate(${rotation})`} opacity={opacity} onPointerDown={onPointerDown} data-label-anchor-x={x} data-label-anchor-y={y} data-label-rotation={rotation} data-label-horizontal-anchor={blockAnchor.horizontalAlign} data-label-vertical-anchor={blockAnchor.verticalAlign}>
      <g className="station-label-block" transform={`translate(${blockX} ${blockY})`} data-label-block-height={metrics.height}>
        <text x="0" y={metrics.primaryBaseline} textAnchor={blockAnchor.horizontalAlign} className={presentation?'presentation-station-label station-label-primary':'station-label station-label-primary'} style={{fontSize:labelSize,fontFamily:'sans-serif',fontWeight,textRendering:'geometricPrecision'}}>{station.name}</text>
        {foreignLines.map((line,index)=><text key={`${index}-${line}`} x="0" y={metrics.foreignBaselines[index]} textAnchor={blockAnchor.horizontalAlign} fill="#999999" className={presentation?'presentation-station-label station-label-foreign':'station-label station-label-foreign'} style={{fontSize:foreignLabelSize,fontFamily:'sans-serif',fontWeight,fill:'#999999',textRendering:'geometricPrecision'}}>{line}</text>)}
      </g>
    </g>
  }
  return <g className="station-label-group" transform={`translate(${x} ${y}) rotate(${rotation})`} opacity={opacity} onPointerDown={onPointerDown} data-label-anchor-x={x} data-label-anchor-y={y} data-label-rotation={rotation} data-label-horizontal-anchor={anchor.textAnchor} data-label-vertical-anchor={anchor.verticalAnchor}>
    <text x="0" y="0" textAnchor={anchor.textAnchor} dominantBaseline={anchor.dominantBaseline} className={presentation?'presentation-station-label':'station-label'} style={{fontSize:labelSize}}>
      <tspan x="0" y="0" className="station-label-primary">{station.name}</tspan>
      {foreignLines.map((line,index)=><tspan key={`${index}-${line}`} x="0" y={foreignStart+index*foreignLabelSize*1.02} className="station-label-foreign" style={{fontSize:foreignLabelSize}}>{line}</tspan>)}
    </text>
  </g>
}
