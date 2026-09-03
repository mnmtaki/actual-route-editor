export type ISODate = string | null
export type WaypointType = 'smooth' | 'corner'
export type SegmentMode = 'straight' | 'smooth' | 'corner' | 'rounded'
export type StructureType = 'underground' | 'elevated' | 'ground'
export type LabelDirection = 'up' | 'down' | 'left' | 'right' | 'upper-left' | 'upper-right' | 'lower-left' | 'lower-right'

export interface SourceMetadata { format: 'aarc'; pointId?: number; lineId?: number; kind?: 'explicit-control-point' | 'implicit-corner'; nameP?: [number, number]; labelAnchorMode?: 'aarc-block'; stationNameFontWeight?: 'normal' | 'bold' | number }
export interface LineStyleOverrides { lineWidth?: number }
export type LineStyleColorMode = 'followLine' | 'custom'
export type LineStyleWidthMode = 'ratio' | 'absolute'
export type LineStyleLineCap = 'round' | 'butt' | 'square'
export type LineStyleLineJoin = 'round' | 'miter' | 'bevel'
export interface LineStyleLayer {
  id: string
  colorMode: LineStyleColorMode
  color?: string
  colorMixTarget?: string
  colorMixAmount?: number
  width: number
  widthMode?: LineStyleWidthMode
  opacity?: number
  dash?: number[]
  lineCap?: LineStyleLineCap
  lineJoin?: LineStyleLineJoin
}
export interface LineStyle {
  id: string
  name: string
  hideBaseLine?: boolean
  layers: LineStyleLayer[]
  builtin?: boolean
}
export interface StationStyleOverrides { stationSize?: number; transferMinorAxis?: number; transferEndPadding?: number; transferDotGap?: number; labelSize?: number; labelFontFamily?: string; labelFontWeight?: number; labelColor?: string; foreignLabelSize?: number; foreignLabelFontFamily?: string; foreignLabelFontWeight?: number; foreignLabelColor?: string; foreignLabelGap?: number }
export interface StationNameHistoryEntry { id: string; effectiveAt: string | null; name: string; nameS?: string }
export interface Station { id: string; name: string; nameS?: string; nameHistory?: StationNameHistoryEntry[]; x: number; y: number; openedAt?: ISODate; closedAt?: ISODate; stationSize?: number; transferMinorAxis?: number; transferEndPadding?: number; transferDotGap?: number; labelSize?: number; foreignLabelSize?: number; foreignLabelGap?: number; styleOverrides?: StationStyleOverrides; labelOffsetX: number; labelOffsetY: number; labelHidden?: boolean; labelRotation?: number; orientationAnchorLineId?: string; source?: SourceMetadata }
export interface LineBadge { id: string; x: number; y: number; size: number; rotation: number; visible: boolean }
export interface Line { id: string; name: string; color: string; lineWidth?: number; styleOverrides?: LineStyleOverrides; lineStyleId?: string; stationSequence: string[]; lineBadges?: LineBadge[]; lineOrder: number; openedAt?: ISODate; closedAt?: ISODate; visible: boolean; locked: boolean; source?: SourceMetadata }
export interface StationLineRelation { id: string; stationId: string; lineId: string; openedAt?: ISODate; closedAt?: ISODate }
export interface OpeningPhase { id: string; lineId: string; name?: string; openedAt: string; segmentIds: string[]; stationRelationIds: string[]; revealStartStationId?: string; revealEndStationId?: string; showOverviewAfter?: boolean; overriddenSegmentIds?: string[]; overriddenStationRelationIds?: string[] }
export interface Waypoint { id: string; x: number; y: number; type: WaypointType; cornerRadius?: number; source?: SourceMetadata }
export interface StructureNode { id: string; structureAfter: StructureType; waypointId?: string; progress?: number }
export interface SegmentLineHistoryEntry { id: string; effectiveAt: string | null; lineId: string }
export interface Segment { id: string; lineId: string; lineHistory?: SegmentLineHistoryEntry[]; fromStationId: string; toStationId: string; mode: SegmentMode; cornerRadius?: number; structureType: StructureType; structureNodes?: StructureNode[]; waypoints: Waypoint[]; openedAt?: ISODate; closedAt?: ISODate }
export interface BackgroundImage { dataUrl: string; name: string; x: number; y: number; width: number; height: number; opacity: number; visible: boolean; locked: boolean; source?: SourceMetadata }
export type MapTextAlign = 'start' | 'middle' | 'end'
export interface TextMapElement { id: string; type: 'text'; x: number; y: number; text: string; fontSize: number; fontWeight: 'normal' | 'bold'; textAlign: MapTextAlign; rotation: number; visible: boolean }
export type MapElement = TextMapElement
export interface TimelineSettings { currentDate: string; startDate: string; endDate: string; playing: boolean }
export type PresentationCameraMode = 'fixed' | 'follow'
export type PresentationResolution = '1920x1080' | '1080x1920' | '1280x720'
export interface PresentationSettings { startDate: string; endDate: string; eventDuration: number; growthSpeedKmPerSecond: number; stationOpeningDuration: number; pauseDuration: number; cameraViewWidth: number; overviewAfterEachPhase: boolean; overviewHoldDuration: number; fps: 30 | 60; cameraMode: PresentationCameraMode; resolution: PresentationResolution; showLabels: boolean; showForeignStationNames: boolean; showDate: boolean; showOperatingLength: boolean; showStationCount: boolean; showBackground: boolean; showLegend: boolean; title: string }
export interface ProjectSettings { lineWidth: number; stationSize: number; stationStyleId: string; transferMinorAxis: number; transferEndPadding: number; transferDotGap: number; stationLabelSize: number; stationLabelFontFamily: string; stationLabelFontWeight: number; stationLabelColor: string; stationForeignLabelSize: number; stationForeignLabelFontFamily: string; stationForeignLabelFontWeight: number; stationForeignLabelColor: string; foreignLabelGap: number; defaultLabelDirection: LabelDirection; defaultLabelDistance: number; defaultStationLabelRotation: number; transferHeightRatio: number; transferGapRatio: number; transferPaddingRatio: number; labelsVisible: boolean; showForeignStationNames: boolean; gridVisible: boolean; exportBackground: boolean; worldUnitsPerKm: number }
export interface BasemapPathPoint { id: string; x: number; y: number }
export type BasemapPathCategory = 'water' | 'terrain' | 'other'
export interface BasemapPath { id: string; name?: string; category: BasemapPathCategory; points: BasemapPathPoint[]; color: string; width: number; opacity: number; closed: boolean; isFilled: boolean; zIndex: number; visible: boolean; locked: boolean; source?: { format: 'aarc'; sourceLineId?: number | string } }
export interface ActualRouteProject { version: 1; name: string; stations: Station[]; lines: Line[]; stationLineRelations: StationLineRelation[]; openingPhases: OpeningPhase[]; geometry: { segments: Segment[] }; mapElements?: MapElement[]; basemapPaths?: BasemapPath[]; background: BackgroundImage | null; timeline: TimelineSettings; presentation: PresentationSettings; settings: ProjectSettings; styles?: LineStyle[] }
export type Selection = { type: 'station'; id: string } | { type: 'line'; id: string } | { type: 'lineBadge'; id: string; lineId: string } | { type: 'segment'; id: string } | { type: 'waypoint'; id: string; segmentId: string } | { type: 'structureNode'; id: string; segmentId: string } | { type: 'mapElement'; id: string } | { type: 'basemapPath'; id: string } | { type: 'background' } | null

export const DEFAULT_STATION_LABEL_FONT_FAMILY = 'Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif'
export const DEFAULT_SETTINGS: ProjectSettings = { lineWidth: 18, stationSize: 11, stationStyleId: 'default', transferMinorAxis: 19.5, transferEndPadding: 5.15, transferDotGap: 2.25, stationLabelSize: 14, stationLabelFontFamily: DEFAULT_STATION_LABEL_FONT_FAMILY, stationLabelFontWeight: 650, stationLabelColor: '#202526', stationForeignLabelSize: 10.08, stationForeignLabelFontFamily: DEFAULT_STATION_LABEL_FONT_FAMILY, stationForeignLabelFontWeight: 520, stationForeignLabelColor: '#202526', foreignLabelGap: 2.52, defaultLabelDirection: 'upper-right', defaultLabelDistance: 19.79898987322333, defaultStationLabelRotation: 0, transferHeightRatio: 1.0833333333333333, transferGapRatio: 0.1944, transferPaddingRatio: 0.25, labelsVisible: true, showForeignStationNames: true, gridVisible: true, exportBackground: true, worldUnitsPerKm: 100 }
export const DEFAULT_PRESENTATION_SETTINGS: PresentationSettings = { startDate: '', endDate: '', eventDuration: 2.8, growthSpeedKmPerSecond: 1.5, stationOpeningDuration: 1.1, pauseDuration: .6, cameraViewWidth: 1000, overviewAfterEachPhase: false, overviewHoldDuration: 1.5, fps: 30, cameraMode: 'follow', resolution: '1920x1080', showLabels: true, showForeignStationNames: true, showDate: true, showOperatingLength: true, showStationCount: true, showBackground: true, showLegend: false, title: '' }
export const uid = (prefix: string) => { const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto); return `${prefix}_${randomUUID ? randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}` }
