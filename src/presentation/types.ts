import type { ActualRouteProject, PresentationSettings } from '../data/model'

export type HistoryEventType = 'LINE_OPENING' | 'LINE_EXTENSION' | 'STATION_OPENING' | 'INTERCHANGE_CREATED' | 'SEGMENT_OPENING' | 'LINE_CLOSURE' | 'SEGMENT_CLOSURE'
export interface DirectedSegment { segmentId: string; fromStationId: string; toStationId: string; length: number; startRatio: number; endRatio: number }
export interface HistoryEvent {
  id: string
  type: 'LINE_OPENING' | 'LINE_EXTENSION' | 'STATION_OPENING' | 'LINE_CLOSURE' | 'SEGMENT_CLOSURE'
  eventTypes: HistoryEventType[]
  historyDate: string
  lineId: string
  openingPhaseId?: string
  segmentIds: string[]
  stationIds: string[]
  interchangeStationIds: string[]
  branches: DirectedSegment[][]
}
export interface CameraView { x: number; y: number; width: number; height: number }
export interface CameraTrackSample { progress: number; centerX: number; centerY: number }
export interface CameraTrack { beatId: string; primaryBranchIndex: number; transitionDuration: number; startCamera: CameraView; constructionCamera: CameraView; endCamera: CameraView; overviewCamera?: CameraView; samples: CameraTrackSample[] }
export interface RevealFront { lineId: string; segmentId: string; worldX: number; worldY: number; tangentX: number; tangentY: number; progress: number; branchIndex: number }
export interface LinePresentationStatistics { lineId: string; operatingLengthKm: number; stationCount: number }
export interface PresentationStatistics { operatingLengthKm: number; stationCount: number }
export interface PresentationBeat extends HistoryEvent {
  beatId: string
  presentationStart: number
  cameraTransitionDuration: number
  revealStart: number
  revealDuration: number
  revealEnd: number
  animationDuration: number
  pauseDuration: number
  presentationEnd: number
  totalPathLength: number
  branchLengths: number[]
  primaryBranchIndex: number
  overviewAfter: boolean
  overviewStart: number
  overviewEnterDuration: number
  overviewHoldDuration: number
  overviewExitDuration: number
  overviewEnd: number
}
export interface PresentationCompileCache {
  segmentOpeningBeat: Record<string, number>
  segmentClosureBeat: Record<string, number>
  stationBeatIndices: Record<string, number[]>
  activeLineIdsByDate: Record<string, Record<string, string[]>>
  segmentLengths: Record<string, number>
}
export interface PresentationSequence {
  beats: PresentationBeat[]
  /** Compatibility alias. Presentation rendering uses beats. */
  events: PresentationBeat[]
  duration: number
  initialDate: string
  finalDate: string
  fixedCamera: CameraView
  cameraTracks: CameraTrack[]
  /** Compatibility alias for older diagnostics. */
  followCameras: CameraView[]
  settings: PresentationSettings
  cache: PresentationCompileCache
}
export interface SegmentPresentationState { revealProgress: number; revealFrom: 'from' | 'to'; opacity: number; strokeDashoffset: number }
export interface StationPresentationState { opacity: number; scale: number; labelOpacity: number; previousLineIds: string[]; lineIds: string[]; transferProgress: number; historicalState: 'previous-stable' | 'current-partial' | 'future' }
export interface PresentationState {
  presentationTime: number
  historyDate: string
  dateLabel: string
  currentBeat: PresentationBeat | null
  currentEvent: PresentationBeat | null
  globalRevealProgress: number
  currentRevealedDistance: number
  revealFronts: RevealFront[]
  statistics: PresentationStatistics
  lineStatistics: LinePresentationStatistics[]
  segmentStates: Record<string, SegmentPresentationState>
  stationStates: Record<string, StationPresentationState>
  camera: CameraView
}
export interface PresentationContext { project: ActualRouteProject; sequence: PresentationSequence }
