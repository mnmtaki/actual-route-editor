import type { Line, Station, StationStyle } from '../data/model'

export interface OrdinaryStationRenderProps { station: Station; size: number; style?: StationStyle; lineColor?: string; backgroundColor?: string; centerX?: number; centerY?: number; lineCode?: string; stationCode?: string }
export interface TransferStationRenderProps { station: Station; lines: Line[]; size: number; minorAxis: number; dotGap: number; endPadding: number; rotation: number; centerX?: number; centerY?: number; minMajorAxis?: number }
export interface PresentationStationRenderProps extends TransferStationRenderProps { previousLines: Line[]; morphProgress: number; opacity: number; scale: number; ordinaryStyle?: StationStyle; lineColor?: string; backgroundColor?: string }
export const TRANSFER_CONTAINER_STYLE = { fill: 'white', stroke: '#3f454a', strokeWidth: 1.75, vectorEffect: 'non-scaling-stroke' as const }
export const TRANSFER_DOT_DIAMETER_RATIO = 0.8
export interface StationStyleDefinition { id:string; name:string; renderOrdinary:(props:OrdinaryStationRenderProps)=>React.ReactNode; renderTransfer:(props:TransferStationRenderProps)=>React.ReactNode; renderPresentation:(props:PresentationStationRenderProps)=>React.ReactNode }

type ArtworkAttrs = { fill?: string; fillOpacity?: number; stroke?: string; strokeWidth?: number; strokeOpacity?: number; 'data-testid'?: string; 'data-station-shape'?: string }

function colorFor(mode: StationStyle['fillColorMode'] | StationStyle['strokeColorMode'], value: string, backgroundColor: string, fallback: string) {
  if (mode === 'none') return 'none'
  if (mode === 'background') return backgroundColor
  return value || fallback
}

function shapeNode(style: StationStyle, centerX: number, centerY: number, width: number, height: number, attrs: ArtworkAttrs) {
  const left = centerX - width / 2, top = centerY - height / 2
  if (style.shape === 'circle') {
    if (Math.abs(width - height) < 1e-9) return <circle cx={centerX} cy={centerY} r={width / 2} {...attrs} />
    return <ellipse cx={centerX} cy={centerY} rx={width / 2} ry={height / 2} {...attrs} />
  }
  if (style.shape === 'diamond') {
    return <path d={`M ${centerX} ${top} L ${centerX + width / 2} ${centerY} L ${centerX} ${centerY + height / 2} L ${left} ${centerY} Z`} {...attrs} />
  }
  const radius = style.shape === 'capsule' ? Math.min(width, height) / 2 : style.shape === 'roundedRect' ? Math.min(Math.max(0, style.cornerRadius), Math.min(width, height) / 2) : 0
  return <rect x={left} y={top} width={width} height={height} rx={radius} {...attrs} />
}

/** Shared ordinary-station SVG artwork used by editor, presentation and export. */
export function renderStationArtwork({ station, style, lineColor = '#596161', backgroundColor = '#f3f0e9', centerX = station.x, centerY = station.y, lineCode = '', stationCode = '' }: { station: Station; style: StationStyle; lineColor?: string; backgroundColor?: string; centerX?: number; centerY?: number; lineCode?: string; stationCode?: string }) {
  const markerFill = style.markerColorMode === 'service' ? lineColor : (style.markerColor ?? style.fillColor)
  const fill = style.template === 'sideMarker' || style.template === 'numberPill'
    ? markerFill
    : style.fillEnabled ? colorFor(style.fillColorMode, style.fillColor, backgroundColor, '#ffffff') : 'none'
  const stroke = style.strokeEnabled && style.strokeWidth > 0 ? colorFor(style.strokeColorMode, style.strokeColor, backgroundColor, '#3f454a') : 'none'
  const bodyAttrs: ArtworkAttrs = {
    fill,
    fillOpacity: style.fillEnabled ? style.fillOpacity : 0,
    stroke,
    strokeWidth: stroke === 'none' ? 0 : style.strokeWidth,
    strokeOpacity: style.strokeEnabled ? style.strokeOpacity : 0,
    'data-testid': `station-${station.id}`,
    'data-station-shape': style.shape,
  }
  const halo = style.haloEnabled && style.haloWidth > 0
    ? shapeNode(style, centerX, centerY, style.width + style.haloGap * 2, style.height + style.haloGap * 2, { fill: 'none', stroke: style.haloColor, strokeWidth: style.haloWidth, strokeOpacity: style.haloOpacity, 'data-station-shape': `${style.shape}-halo` })
    : null
  const transform = style.rotation ? `rotate(${style.rotation} ${centerX} ${centerY})` : undefined
  const body = shapeNode(style, centerX, centerY, style.width, style.height, bodyAttrs)
  const codeText = [style.showLineCode === true ? lineCode : '', style.showStationCode === true ? stationCode : ''].filter(Boolean).join(' | ')
  const code = style.template === 'numberPill' && codeText ? <text className="station-number-pill-label" data-station-line-code={lineCode} x={centerX} y={centerY + style.width * .08} textAnchor="middle" fill={lineColor === '#ffffff' || lineColor === 'white' ? '#202526' : '#ffffff'} fontSize={Math.max(4, Math.min(style.height * .52, style.width * .23))} fontWeight="700">{codeText}</text> : null
  return <g className="station-artwork" data-station-artwork={station.id} data-station-style-id={style.id} transform={transform}>{halo}{body}{code}</g>
}

export function StationArtwork({ station, style, lineColor, backgroundColor, centerX, centerY, lineCode, stationCode }: { station: Station; style: StationStyle; lineColor?: string; backgroundColor?: string; centerX?: number; centerY?: number; lineCode?: string; stationCode?: string }) {
  return <>{renderStationArtwork({ station, style, lineColor, backgroundColor, centerX, centerY, lineCode, stationCode })}</>
}

export function getDefaultTransferMetrics(size:number,count:number,dotGap:number,endPadding:number,minorAxis:number,minMajorAxis=0){
  const dotDiameter=size*TRANSFER_DOT_DIAMETER_RATIO
  const gap=Math.max(0,dotGap), horizontalPadding=Math.max(0,endPadding)
  const naturalWidth=horizontalPadding*2+count*dotDiameter+Math.max(0,count-1)*gap
  return { dotDiameter, gap, horizontalPadding, naturalWidth, height:Math.max(dotDiameter,minorAxis), width:Math.max(naturalWidth,minMajorAxis) }
}
const ordinary=({station,size,style,lineColor,backgroundColor,centerX=centerOf(station).x,centerY=centerOf(station).y,lineCode,stationCode}:OrdinaryStationRenderProps)=>style ? <StationArtwork station={station} style={style} lineColor={lineColor} backgroundColor={backgroundColor} centerX={centerX} centerY={centerY} lineCode={lineCode} stationCode={stationCode}/> : <circle cx={centerX} cy={centerY} r={size/2} fill="white" data-testid={`station-${station.id}`}/>
const transfer=({station,lines,size,minorAxis,dotGap,endPadding,rotation,centerX=centerOf(station).x,centerY=centerOf(station).y,minMajorAxis=0}:TransferStationRenderProps)=>{const metrics=getDefaultTransferMetrics(size,lines.length,dotGap,endPadding,minorAxis,minMajorAxis);return <g transform={`rotate(${rotation} ${centerX} ${centerY})`} data-testid={`transfer-${station.id}`}><rect x={centerX-metrics.width/2} y={centerY-metrics.height/2} width={metrics.width} height={metrics.height} rx={metrics.height/2} {...TRANSFER_CONTAINER_STYLE}/>{lines.map((line,index)=><circle key={line.id} cx={dotX(centerX,metrics,index)} cy={centerY} r={metrics.dotDiameter/2} fill={line.color}/>)}</g>}
const presentation=({station,previousLines,lines,size,minorAxis,dotGap,endPadding,rotation,morphProgress,opacity,scale,centerX=centerOf(station).x,centerY=centerOf(station).y,minMajorAxis=0,ordinaryStyle,lineColor,backgroundColor}:PresentationStationRenderProps)=>{const previousCount=previousLines.length;if(lines.length<2)return <g opacity={opacity} transform={`translate(${station.x} ${station.y}) scale(${scale}) translate(${-station.x} ${-station.y})`}>{ordinary({station,size,style:ordinaryStyle,lineColor,backgroundColor})}</g>;const fromMetrics=getDefaultTransferMetrics(size,Math.max(2,previousCount),dotGap,endPadding,minorAxis,minMajorAxis),toMetrics=getDefaultTransferMetrics(size,lines.length,dotGap,endPadding,minorAxis,minMajorAxis),morph=morphProgress,width=lerp(previousCount<2?size:fromMetrics.width,toMetrics.width,morph),height=lerp(previousCount<2?size:fromMetrics.height,toMetrics.height,morph);return <g opacity={opacity} transform={`rotate(${rotation} ${centerX} ${centerY})`} data-presentation-station={station.id}>{previousCount<2&&<g opacity={1-morph}>{ordinary({station,size,style:ordinaryStyle,lineColor,backgroundColor})}</g>}<rect x={centerX-width/2} y={centerY-height/2} width={width} height={height} rx={height/2} {...TRANSFER_CONTAINER_STYLE} opacity={previousCount<2?morph:1}/>{lines.map((line,index)=>{const previousIndex=previousLines.findIndex(item=>item.id===line.id),fromX=previousIndex>=0&&previousCount>=2?dotX(centerX,fromMetrics,previousIndex):centerX,toX=dotX(centerX,toMetrics,index);return <circle key={line.id} cx={lerp(fromX,toX,morph)} cy={centerY} r={toMetrics.dotDiameter/2} fill={line.color} opacity={previousIndex>=0&&previousCount>=2?1:morph}/>})}</g>}
export const DEFAULT_STATION_STYLE:StationStyleDefinition={id:'default',name:'默认站点',renderOrdinary:ordinary,renderTransfer:transfer,renderPresentation:presentation}
const STATION_STYLES:Record<string,StationStyleDefinition>={[DEFAULT_STATION_STYLE.id]:DEFAULT_STATION_STYLE}
export function getStationStyle(styleId:string|undefined):StationStyleDefinition{return STATION_STYLES[styleId??'default']??DEFAULT_STATION_STYLE}
export function dotX(center:number,metrics:ReturnType<typeof getDefaultTransferMetrics>,index:number){
 const contentInset=(metrics.width-metrics.naturalWidth)/2
 return center-metrics.width/2+contentInset+metrics.horizontalPadding+metrics.dotDiameter/2+index*(metrics.dotDiameter+metrics.gap)
}
function centerOf(station:Station){return {x:station.x,y:station.y}}
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t
