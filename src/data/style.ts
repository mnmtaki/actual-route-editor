import type { LabelDirection, ProjectSettings, Station } from './model'
import { DEFAULT_SETTINGS } from './model'

export const LABEL_DIRECTIONS: { value: LabelDirection; label: string }[] = [
  { value: 'up', label: '上' }, { value: 'down', label: '下' }, { value: 'left', label: '左' }, { value: 'right', label: '右' },
  { value: 'upper-left', label: '左上' }, { value: 'upper-right', label: '右上' }, { value: 'lower-left', label: '左下' }, { value: 'lower-right', label: '右下' },
]
const VECTORS: Record<LabelDirection, [number, number]> = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0], 'upper-left':[-Math.SQRT1_2,-Math.SQRT1_2], 'upper-right':[Math.SQRT1_2,-Math.SQRT1_2], 'lower-left':[-Math.SQRT1_2,Math.SQRT1_2], 'lower-right':[Math.SQRT1_2,Math.SQRT1_2] }
export function labelOffsetFor(direction: LabelDirection, distance: number) { const [x,y]=VECTORS[direction]; return { x:x*distance, y:y*distance } }
export function inferLabelDirection(x:number,y:number,toleranceDegrees=12): LabelDirection | 'custom' { if(!x&&!y)return 'custom'; const angle=Math.atan2(y,x)*180/Math.PI; const candidates: [LabelDirection,number][]=[['right',0],['lower-right',45],['down',90],['lower-left',135],['left',180],['upper-left',-135],['up',-90],['upper-right',-45]]; const found=candidates.find(([,candidate])=>Math.abs((((angle-candidate)+540)%360)-180)<=toleranceDegrees); return found?.[0]??'custom' }
export function effectiveLabelRotation(station: Station, settings: ProjectSettings){ return Number.isFinite(station.labelRotation) ? station.labelRotation! : settings.defaultStationLabelRotation }
export function resetVisualSettings(settings: ProjectSettings): ProjectSettings { return { ...settings, lineWidth:DEFAULT_SETTINGS.lineWidth, stationSize:DEFAULT_SETTINGS.stationSize, transferMinorAxis:DEFAULT_SETTINGS.transferMinorAxis, transferEndPadding:DEFAULT_SETTINGS.transferEndPadding, transferDotGap:DEFAULT_SETTINGS.transferDotGap, stationLabelSize:DEFAULT_SETTINGS.stationLabelSize, stationForeignLabelSize:DEFAULT_SETTINGS.stationForeignLabelSize, foreignLabelGap:DEFAULT_SETTINGS.foreignLabelGap, defaultLabelDirection:DEFAULT_SETTINGS.defaultLabelDirection, defaultLabelDistance:DEFAULT_SETTINGS.defaultLabelDistance, defaultStationLabelRotation:DEFAULT_SETTINGS.defaultStationLabelRotation } }
export type LabelHorizontalAnchor = 'start' | 'middle' | 'end'
export type LabelVerticalAnchor = 'above' | 'middle' | 'below'
export function resolveLabelAnchor(offsetX:number,offsetY:number){
  const epsilon=1e-6
  const textAnchor:LabelHorizontalAnchor=offsetX>epsilon?'start':offsetX<-epsilon?'end':'middle'
  const verticalAnchor:LabelVerticalAnchor=offsetY>epsilon?'below':offsetY<-epsilon?'above':'middle'
  const dominantBaseline: 'hanging' | 'middle' | 'auto' = verticalAnchor==='below'?'hanging':verticalAnchor==='middle'?'middle':'auto'
  return {textAnchor,verticalAnchor,dominantBaseline}
}
