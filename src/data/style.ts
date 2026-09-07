import type { LabelDirection, Line, ProjectSettings, Station, StationStyleOverrides } from './model'
import { DEFAULT_SETTINGS } from './model'

export const LABEL_DIRECTIONS: { value: LabelDirection; label: string }[] = [
  { value: 'up', label: '上' }, { value: 'down', label: '下' }, { value: 'left', label: '左' }, { value: 'right', label: '右' },
  { value: 'upper-left', label: '左上' }, { value: 'upper-right', label: '右上' }, { value: 'lower-left', label: '左下' }, { value: 'lower-right', label: '右下' },
]
const VECTORS: Record<LabelDirection, [number, number]> = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0], 'upper-left':[-Math.SQRT1_2,-Math.SQRT1_2], 'upper-right':[Math.SQRT1_2,-Math.SQRT1_2], 'lower-left':[-Math.SQRT1_2,Math.SQRT1_2], 'lower-right':[Math.SQRT1_2,Math.SQRT1_2] }
const DIRECTION_ORDER: LabelDirection[] = ['right','lower-right','down','lower-left','left','upper-left','up','upper-right']
export function labelOffsetFor(direction: LabelDirection, distance: number) { const [x,y]=VECTORS[direction]; return { x:x*distance, y:y*distance } }
/** Resolve a world-space label vector to one deterministic 45° direction sector. */
export function resolveStationLabelDirection(x:number,y:number): LabelDirection | 'custom' {
  if (Math.hypot(x,y) <= 1e-9) return 'custom'
  const angle=(Math.atan2(y,x)*180/Math.PI+360)%360
  const sector=Math.floor((angle+22.5)/45)%8
  return DIRECTION_ORDER[sector]
}
/** Kept as the existing public helper; direction inference now uses the same eight-sector resolver. */
export function inferLabelDirection(x:number,y:number,_toleranceDegrees=12): LabelDirection | 'custom' { return resolveStationLabelDirection(x,y) }
/** Snap only an actively edited offset; untouched stored offsets remain unchanged. */
export function snapLabelOffset(x:number,y:number) {
  const direction=resolveStationLabelDirection(x,y)
  if (direction==='custom') return { x, y, direction }
  const offset=labelOffsetFor(direction,Math.hypot(x,y))
  return { ...offset, direction }
}
export function effectiveLabelRotation(station: Station, settings: ProjectSettings){ return Number.isFinite(station.labelRotation) ? station.labelRotation! : settings.defaultStationLabelRotation }
const positiveOverride=(value:number|undefined,fallback:number)=>Number.isFinite(value)&&value!>0?value!:fallback
const nonNegativeOverride=(value:number|undefined,fallback:number)=>Number.isFinite(value)&&value!>=0?value!:fallback
const fontFamilyOverride=(value:string|undefined,fallback:string)=>normalizeFontFamily(value)??fallback
const fontWeightOverride=(value:number|undefined,fallback:number)=>normalizeFontWeight(value)??fallback
const colorOverride=(value:string|undefined,fallback:string)=>normalizeHexColor(value)??fallback
export function normalizeFontFamily(value:unknown):string|null{if(typeof value!=='string')return null;const normalized=value.trim();return normalized&&normalized.length<=500&&!/[;{}<>\r\n]/.test(normalized)&&!/^url\s*\(/i.test(normalized)?normalized:null}
export function normalizeFontWeight(value:unknown):number|null{const normalized=typeof value==='number'?value:Number(value);return Number.isFinite(normalized)&&normalized>=100&&normalized<=900?normalized:null}
export function normalizeHexColor(value:unknown):string|null{if(typeof value!=='string')return null;const normalized=value.trim();if(/^#[0-9a-f]{6}$/i.test(normalized))return normalized.toLowerCase();if(/^#[0-9a-f]{3}$/i.test(normalized)){const [r,g,b]=normalized.slice(1).toLowerCase();return `#${r}${r}${g}${g}${b}${b}`}return null}
export function effectiveLineWidth(line:Line,settings:ProjectSettings){return positiveOverride(line.styleOverrides?.lineWidth,settings.lineWidth)}
export function effectiveStationStyle(station:Station,settings:ProjectSettings):Required<StationStyleOverrides>{return{
  stationSize:positiveOverride(station.styleOverrides?.stationSize,settings.stationSize),
  transferMinorAxis:positiveOverride(station.styleOverrides?.transferMinorAxis,settings.transferMinorAxis),
  transferEndPadding:nonNegativeOverride(station.styleOverrides?.transferEndPadding,settings.transferEndPadding),
  transferDotGap:nonNegativeOverride(station.styleOverrides?.transferDotGap,settings.transferDotGap),
  labelSize:positiveOverride(station.styleOverrides?.labelSize,settings.stationLabelSize),
  labelFontFamily:fontFamilyOverride(station.styleOverrides?.labelFontFamily,settings.stationLabelFontFamily),
  labelFontWeight:fontWeightOverride(station.styleOverrides?.labelFontWeight,settings.stationLabelFontWeight),
  labelColor:colorOverride(station.styleOverrides?.labelColor,settings.stationLabelColor),
  foreignLabelSize:positiveOverride(station.styleOverrides?.foreignLabelSize,settings.stationForeignLabelSize),
  foreignLabelFontFamily:fontFamilyOverride(station.styleOverrides?.foreignLabelFontFamily,settings.stationForeignLabelFontFamily),
  foreignLabelFontWeight:fontWeightOverride(station.styleOverrides?.foreignLabelFontWeight,settings.stationForeignLabelFontWeight),
  foreignLabelColor:colorOverride(station.styleOverrides?.foreignLabelColor,settings.stationForeignLabelColor),
  foreignLabelGap:nonNegativeOverride(station.styleOverrides?.foreignLabelGap,settings.foreignLabelGap),
}}
export function resetVisualSettings(settings: ProjectSettings): ProjectSettings { return { ...settings, lineWidth:DEFAULT_SETTINGS.lineWidth, stationSize:DEFAULT_SETTINGS.stationSize, transferMinorAxis:DEFAULT_SETTINGS.transferMinorAxis, transferEndPadding:DEFAULT_SETTINGS.transferEndPadding, transferDotGap:DEFAULT_SETTINGS.transferDotGap, stationLabelSize:DEFAULT_SETTINGS.stationLabelSize, stationLabelFontFamily:DEFAULT_SETTINGS.stationLabelFontFamily, stationLabelFontWeight:DEFAULT_SETTINGS.stationLabelFontWeight, stationLabelColor:DEFAULT_SETTINGS.stationLabelColor, stationForeignLabelSize:DEFAULT_SETTINGS.stationForeignLabelSize, stationForeignLabelFontFamily:DEFAULT_SETTINGS.stationForeignLabelFontFamily, stationForeignLabelFontWeight:DEFAULT_SETTINGS.stationForeignLabelFontWeight, stationForeignLabelColor:DEFAULT_SETTINGS.stationForeignLabelColor, foreignLabelGap:DEFAULT_SETTINGS.foreignLabelGap, defaultLabelDirection:DEFAULT_SETTINGS.defaultLabelDirection, defaultLabelDistance:DEFAULT_SETTINGS.defaultLabelDistance, defaultStationLabelRotation:DEFAULT_SETTINGS.defaultStationLabelRotation } }
export type LabelHorizontalAnchor = 'start' | 'middle' | 'end'
export type LabelVerticalAnchor = 'above' | 'middle' | 'below'
export function resolveLabelAnchor(offsetX:number,offsetY:number){
  const direction=resolveStationLabelDirection(offsetX,offsetY)
  const textAnchor:LabelHorizontalAnchor=direction==='left'||direction==='upper-left'||direction==='lower-left'?'end':direction==='right'||direction==='upper-right'||direction==='lower-right'?'start':'middle'
  const verticalAnchor:LabelVerticalAnchor=direction==='up'||direction==='upper-left'||direction==='upper-right'?'above':direction==='down'||direction==='lower-left'||direction==='lower-right'?'below':'middle'
  const dominantBaseline: 'hanging' | 'middle' | 'auto' = verticalAnchor==='below'?'hanging':verticalAnchor==='middle'?'middle':'auto'
  return {textAnchor,verticalAnchor,dominantBaseline}
}
