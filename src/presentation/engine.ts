import type { ActualRouteProject } from '../data/model'
import { evaluateCameraTrack } from './camera'
import { PRESENTATION_ANIMATION, clamp, easing, inverseLineEasing } from './config'
import { getBeatRevealFronts, getBeatRevealedDistance, getBeatSegmentRevealProgress, getStationArrivalRatio } from './reveal'
import { stationLineKey } from './compiler'
import { resolveSegmentLineAt } from '../data/segmentLineHistory'
import type { PresentationBeat, PresentationSequence, PresentationState, StationPresentationState } from './types'

export function getPresentationState(project: ActualRouteProject, sequence: PresentationSequence, presentationTime: number): PresentationState {
  const time = clamp(presentationTime, 0, sequence.duration)
  let beatIndex = sequence.beats.findIndex(beat => time >= beat.presentationStart && time < beat.presentationEnd)
  if (beatIndex < 0 && time >= sequence.duration && sequence.beats.length) beatIndex = sequence.beats.length - 1
  const currentBeat = beatIndex >= 0 ? sequence.beats[beatIndex] : null
  const historyDate = currentBeat?.historyDate ?? sequence.initialDate
  const globalRevealProgress = currentBeat?.eventTypes.includes('SEGMENT_OPENING') ? getBeatGlobalRevealProgress(currentBeat, time) : getBeatLocalProgress(currentBeat, time)
  const currentRevealedDistance = currentBeat ? getBeatRevealedDistance(currentBeat, globalRevealProgress) : 0
  const revealFronts = getBeatRevealFronts(project, currentBeat, globalRevealProgress)

  const segmentStates: PresentationState['segmentStates'] = {}
  for (const segment of project.geometry.segments) {
    const openingIndex = sequence.cache.segmentOpeningBeat[segment.id], closureIndex = sequence.cache.segmentClosureBeat[segment.id]
    const historicalLineId = sequence.cache.segmentLineIdsByDate[historyDate]?.[segment.id] ?? resolveSegmentLineAt(segment, historyDate)
    const opening = openingIndex === undefined ? undefined : sequence.beats[openingIndex], closure = closureIndex === undefined ? undefined : sequence.beats[closureIndex]
    let revealProgress = opening ? beatSegmentProgress(opening, segment.id, time) : historicallyVisible(segment.openedAt, segment.closedAt, historyDate) ? 1 : 0
    let opacity = revealProgress > 0 ? 1 : 0
    if (closure && time >= closure.revealStart) opacity *= 1 - easing.transfer(clamp((time - closure.revealStart) / Math.max(.000001, closure.revealDuration)))
    if (closure && time >= closure.revealEnd) { revealProgress = 0; opacity = 0 }
    const revealFrom = opening ? beatSegmentDirection(opening, segment.id, segment.fromStationId) : 'from'
    segmentStates[segment.id] = { lineId: historicalLineId, revealProgress, revealFrom, opacity, strokeDashoffset: (revealFrom === 'from' ? 1 : -1) * (1 - revealProgress) }
  }

  const stationStates: Record<string, StationPresentationState> = {}
  for (const station of project.stations) {
    const beatIndices = sequence.cache.stationBeatIndices[station.id] ?? [], openingIndex = beatIndices[0]
    const opening = openingIndex === undefined ? undefined : sequence.beats[openingIndex]
    const transition = beatIndex >= 0 && beatIndices.includes(beatIndex) ? currentBeat : null
    const openingArrival = opening ? getStationArrivalRatio(opening, station.id) : 0
    const openingArrivalTime = opening ? opening.revealStart + inverseLineEasing(openingArrival) * opening.revealDuration : 0
    const markerProgress = opening ? easing.station(clamp((time - openingArrivalTime) / PRESENTATION_ANIMATION.stationFadeDuration)) : 1
    const labelProgress = opening ? easing.station(clamp((time - openingArrivalTime - PRESENTATION_ANIMATION.labelDelay) / PRESENTATION_ANIMATION.labelFadeDuration)) : 1
    const arrival = transition ? getStationArrivalRatio(transition, station.id) : 0
    const transitionArrivalTime = transition ? transition.revealStart + inverseLineEasing(arrival) * transition.revealDuration : 0
    const targetLineIds = activeLineIds(sequence, station.id, transition?.historyDate ?? historyDate)
    const previousLineIds = transition ? presentationVisibleLineIds(project,sequence,station.id,historyDate,transitionArrivalTime-1e-6) : presentationVisibleLineIds(project,sequence,station.id,historyDate,time)
    const lineIds = presentationVisibleLineIds(project,sequence,station.id,historyDate,time)
    const relationSetChanged=previousLineIds.length!==lineIds.length||previousLineIds.some((id,index)=>id!==lineIds[index])
    const transferProgress = transition && relationSetChanged ? easing.transfer(clamp((time - transitionArrivalTime) / PRESENTATION_ANIMATION.transferMorphDuration)) : 1
    const openingHasStarted = !opening || time >= opening.revealStart, historicallyEligible = targetLineIds.length > 0, isClosed = !historicallyEligible && openingHasStarted
    const closingNow = Boolean(currentBeat?.type.includes('CLOSURE') && currentBeat.stationIds.includes(station.id) && previousLineIds.length > 0 && lineIds.length === 0)
    const closureOpacity = closingNow && currentBeat ? 1 - easing.transfer(clamp((time - currentBeat.revealStart) / Math.max(.000001, currentBeat.revealDuration))) : 0
    const transitionAnimating = Boolean(transition && time < transition.revealEnd)
    const historicalState: StationPresentationState['historicalState'] = opening && time < opening.revealStart ? 'future' : transitionAnimating ? 'current-partial' : historicallyEligible ? 'previous-stable' : 'future'
    const opacity = historicalState === 'future' ? 0 : isClosed ? closureOpacity : markerProgress
    const effectiveLabelOpacity = historicalState === 'future' ? 0 : isClosed ? closureOpacity : labelProgress
    const visibleRelationIds=project.stationLineRelations.filter(relation=>relation.stationId===station.id&&lineIds.includes(relation.lineId)).map(relation=>relation.id)
    stationStates[station.id] = { opacity, scale: PRESENTATION_ANIMATION.stationScaleFrom + (1 - PRESENTATION_ANIMATION.stationScaleFrom) * markerProgress, labelOpacity: effectiveLabelOpacity, previousLineIds, lineIds, visibleRelationIds, transferProgress, historicalState }
  }

  const worldUnitsPerKm = project.settings.worldUnitsPerKm > 0 ? project.settings.worldUnitsPerKm : 100
  const operatingLengthKm = project.geometry.segments.reduce((sum, segment) => { const state = segmentStates[segment.id]; return sum + (sequence.cache.segmentLengths[segment.id] ?? 0) * state.revealProgress * state.opacity / worldUnitsPerKm }, 0)
  const stationCount = Object.values(stationStates).filter(state => state.opacity > 0 && state.lineIds.length > 0).length
  const lines = project.lines.filter(line => line.visible).map(line => ({
    lineId: line.id,
    operatingLengthKm: project.geometry.segments.filter(segment => (segmentStates[segment.id]?.lineId ?? segment.lineId) === line.id).reduce((sum, segment) => { const state = segmentStates[segment.id]; return sum + (sequence.cache.segmentLengths[segment.id] ?? 0) * state.revealProgress * state.opacity / worldUnitsPerKm }, 0),
    stationCount: project.stations.filter(station => { const state = stationStates[station.id]; return state?.opacity > 0 && state.lineIds.includes(line.id) }).length,
  })).filter(statistic => statistic.operatingLengthKm > .001 || statistic.stationCount > 0)
  const camera = sequence.settings.cameraMode === 'fixed' || !currentBeat || beatIndex < 0 ? sequence.fixedCamera : evaluateCameraTrack(sequence.cameraTracks[beatIndex], currentBeat, time)
  return { presentationTime: time, historyDate, dateLabel: formatDateLabel(historyDate), currentBeat, currentEvent: currentBeat, globalRevealProgress, currentRevealedDistance, revealFronts, statistics: { operatingLengthKm, stationCount }, lineStatistics: lines, segmentStates, stationStates, camera }
}
export function getBeatLocalProgress(beat: PresentationBeat | null, time: number) { return beat ? clamp((time - beat.revealStart) / Math.max(.000001, beat.revealDuration)) : 0 }
export function getBeatGlobalRevealProgress(beat: PresentationBeat, time: number) { return easing.line(getBeatLocalProgress(beat, time)) }
function beatSegmentProgress(beat: PresentationBeat, segmentId: string, time: number) { if (time < beat.revealStart) return 0; if (time >= beat.revealEnd) return 1; return getBeatSegmentRevealProgress(beat, segmentId, getBeatGlobalRevealProgress(beat, time)) }
function beatSegmentDirection(beat: PresentationBeat, segmentId: string, segmentFrom: string): 'from' | 'to' { const directed = beat.branches.flat().find(item => item.segmentId === segmentId); return !directed || directed.fromStationId === segmentFrom ? 'from' : 'to' }
function activeLineIds(sequence: PresentationSequence, stationId: string, date: string) { return sequence.cache.activeLineIdsByDate[date]?.[stationId] ?? [] }
function presentationVisibleLineIds(project:ActualRouteProject,sequence:PresentationSequence,stationId:string,date:string,time:number){return activeLineIds(sequence,stationId,date).filter(lineId=>{const beatIndex=sequence.cache.stationLineOpeningBeat[stationLineKey(stationId,lineId)];if(beatIndex===undefined)return true;const beat=sequence.beats[beatIndex],arrival=getStationArrivalRatio(beat,stationId),arrivalTime=beat.revealStart+inverseLineEasing(arrival)*beat.revealDuration;return time+1e-9>=arrivalTime&&Boolean(project.stationLineRelations.find(relation=>relation.stationId===stationId&&relation.lineId===lineId))})}
function active(openedAt: string | null | undefined, closedAt: string | null | undefined, date: string) { return (!openedAt || openedAt <= date) && (!closedAt || date < closedAt) }
function historicallyVisible(openedAt: string | null | undefined, closedAt: string | null | undefined, date: string) { return active(openedAt, closedAt, date) }
function formatDateLabel(date: string) { const normalized = /^\d{4}$/.test(date) ? `${date}-01-01` : /^\d{4}-\d{2}$/.test(date) ? `${date}-01` : date; return normalized ? normalized.replaceAll('-', '.') : '' }
