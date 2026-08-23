export type ISODate = string | null
export type WaypointType = 'smooth' | 'corner'
export type SegmentMode = 'straight' | 'smooth' | 'corner'

export interface Station { id: string; name: string; x: number; y: number; openedAt?: ISODate; closedAt?: ISODate; labelOffsetX: number; labelOffsetY: number; labelHidden?: boolean; orientationAnchorLineId?: string }
export interface Line { id: string; name: string; color: string; stationSequence: string[]; lineOrder: number; openedAt?: ISODate; closedAt?: ISODate; visible: boolean; locked: boolean }
export interface StationLineRelation { id: string; stationId: string; lineId: string; openedAt?: ISODate; closedAt?: ISODate }
export interface Waypoint { id: string; x: number; y: number; type: WaypointType }
export interface Segment { id: string; lineId: string; fromStationId: string; toStationId: string; mode: SegmentMode; waypoints: Waypoint[]; openedAt?: ISODate; closedAt?: ISODate }
export interface BackgroundImage { dataUrl: string; name: string; x: number; y: number; width: number; height: number; opacity: number; visible: boolean; locked: boolean }
export interface TimelineSettings { currentDate: string; startDate: string; endDate: string; playing: boolean }

export interface ProjectSettings {
  lineWidth: number
  stationSize: number
  stationStyleId: string
  transferHeightRatio: number
  transferGapRatio: number
  transferPaddingRatio: number
  labelsVisible: boolean
  gridVisible: boolean
  exportBackground: boolean
}

export interface ActualRouteProject { version: 1; name: string; stations: Station[]; lines: Line[]; stationLineRelations: StationLineRelation[]; geometry: { segments: Segment[] }; background: BackgroundImage | null; timeline: TimelineSettings; settings: ProjectSettings }
export type Selection = { type: 'station'; id: string } | { type: 'line'; id: string } | { type: 'segment'; id: string } | { type: 'waypoint'; id: string; segmentId: string } | { type: 'background' } | null

export const DEFAULT_SETTINGS: ProjectSettings = {
  lineWidth: 18,
  stationSize: 11,
  stationStyleId: 'default',
  transferHeightRatio: 1.15,
  transferGapRatio: 0.18,
  transferPaddingRatio: 0.25,
  labelsVisible: true,
  gridVisible: true,
  exportBackground: true,
}

export const uid = (prefix: string) => { const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto); return `${prefix}_${randomUUID ? randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}` }
