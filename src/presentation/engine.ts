import type { ActualRouteProject } from '../data/model'
import { evaluateCameraTrack } from './camera'
import { PRESENTATION_ANIMATION, clamp, easing, inverseLineEasing } from './config'
import { getBeatRevealFronts, getBeatRevealedDistance, getBeatSegmentRevealProgress, getOpeningAnimationState, getStationArrivalRatio } from './reveal'
import { stationLineKey } from './compiler'
import { resolveSegmentLineAt } from '../data/segmentLineHistory'
import { collapseLineIdsByServiceFamily, getRootLineId } from '../data/lineIdentity'
import { worldUnitsToKilometers } from '../data/distance'
import { getCompoundStationMemberIds, getCompoundStationRelations, getPassengerStationIdentity, isCompoundStationCanonical } from '../data/compoundStation'
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
    const memberIds = getCompoundStationMemberIds(project, station.id)
    const beatIndices = [...new Set(memberIds.flatMap(memberId => sequence.cache.stationBeatIndices[memberId] ?? []))].sort((a, b) => a - b), openingIndex = beatIndices[0]
    const opening = openingIndex === undefined ? undefined : sequence.beats[openingIndex]
    const transition = beatIndex >= 0 && beatIndices.includes(beatIndex) ? currentBeat : null
    const openingMemberIds = opening ? memberIds.filter(memberId => project.stationLineRelations.some(relation => relation.stationId === memberId && relation.lineId === opening.lineId)) : memberIds
    const openingTargets = openingMemberIds.length ? openingMemberIds : memberIds
    const isOriginStation = Boolean(opening?.needsOriginReveal && opening.originStationId && openingTargets.includes(opening.originStationId))
    const originAnimation = isOriginStation && opening ? getOpeningAnimationState(opening, time) : null
    const openingArrival = opening ? Math.min(...openingTargets.map(memberId => getStationArrivalRatio(opening, memberId))) : 0
    const openingArrivalTime = opening ? (isOriginStation ? opening.originRevealStart : opening.revealStart + inverseLineEasing(openingArrival) * opening.revealDuration) : 0
    const markerProgress = originAnimation ? originAnimation.originOpacity : opening ? easing.station(clamp((time - openingArrivalTime) / PRESENTATION_ANIMATION.stationFadeDuration)) : 1
    const labelProgress = originAnimation ? originAnimation.originLabelOpacity : opening ? easing.station(clamp((time - openingArrivalTime - PRESENTATION_ANIMATION.labelDelay) / PRESENTATION_ANIMATION.labelFadeDuration)) : 1
    const transitionMemberIds = transition ? memberIds.filter(memberId => project.stationLineRelations.some(relation => relation.stationId === memberId && relation.lineId === transition.lineId)) : memberIds
    const transitionTargets = transitionMemberIds.length ? transitionMemberIds : memberIds
    const arrival = transition ? Math.min(...transitionTargets.map(memberId => getStationArrivalRatio(transition, memberId))) : 0
    const transitionIsOrigin = Boolean(transition?.needsOriginReveal && transition.originStationId && transitionTargets.includes(transition.originStationId))
    const transitionArrivalTime = transition ? (transitionIsOrigin ? transition.originRevealStart : transition.revealStart + inverseLineEasing(arrival) * transition.revealDuration) : 0
    const targetLineIds = activeLineIds(project, sequence, station.id, transition?.historyDate ?? historyDate)
    const previousLineIds = transition ? presentationVisibleLineIds(project,sequence,station.id,historyDate,transitionArrivalTime-1e-6) : presentationVisibleLineIds(project,sequence,station.id,historyDate,time)
    const lineIds = presentationVisibleLineIds(project,sequence,station.id,historyDate,time)
    const previousPassengerLineIds = collapseLineIdsByServiceFamily(project, previousLineIds)
    const passengerLineIds = collapseLineIdsByServiceFamily(project, lineIds)
    const relationSetChanged=previousPassengerLineIds.length!==passengerLineIds.length||previousPassengerLineIds.some((id,index)=>id!==passengerLineIds[index])
    const transferProgress = transition && relationSetChanged ? easing.transfer(clamp((time - transitionArrivalTime) / PRESENTATION_ANIMATION.transferMorphDuration)) : 1
    const openingHasStarted = !opening || time >= (isOriginStation ? opening.originRevealStart : opening.revealStart), historicallyEligible = targetLineIds.length > 0, isClosed = !historicallyEligible && openingHasStarted
    const closingNow = Boolean(currentBeat?.type.includes('CLOSURE') && memberIds.some(memberId => currentBeat.stationIds.includes(memberId)) && previousLineIds.length > 0 && lineIds.length === 0)
    const closureOpacity = closingNow && currentBeat ? 1 - easing.transfer(clamp((time - currentBeat.revealStart) / Math.max(.000001, currentBeat.revealDuration))) : 0
    const transitionAnimating = Boolean(transition && time < transition.revealEnd)
    const historicalState: StationPresentationState['historicalState'] = opening && time < (isOriginStation ? opening.originRevealStart : opening.revealStart) ? 'future' : transitionAnimating ? 'current-partial' : historicallyEligible ? 'previous-stable' : 'future'
    const opacity = historicalState === 'future' ? 0 : isClosed ? closureOpacity : markerProgress
    const effectiveLabelOpacity = historicalState === 'future' ? 0 : isClosed ? closureOpacity : labelProgress
    const visibleRelationIds = presentationVisibleRelationIds(project, station.id, historyDate, lineIds)
    const scale = originAnimation ? originAnimation.originScale : PRESENTATION_ANIMATION.stationScaleFrom + (1 - PRESENTATION_ANIMATION.stationScaleFrom) * markerProgress
    stationStates[station.id] = { opacity, scale, labelOpacity: effectiveLabelOpacity, previousLineIds, lineIds, visibleRelationIds, transferProgress, historicalState }
  }

  const operatingLengthKm = project.geometry.segments.reduce((sum, segment) => { const state = segmentStates[segment.id]; return sum + worldUnitsToKilometers((sequence.cache.segmentLengths[segment.id] ?? 0) * state.revealProgress * state.opacity, project) }, 0)
  const countedStations = new Set<string>()
  const stationCount = project.stations.reduce((count, station) => { const state = stationStates[station.id], identity = getPassengerStationIdentity(project, station.id); if (!state || state.opacity <= 0 || state.lineIds.length === 0 || countedStations.has(identity)) return count; countedStations.add(identity); return count + 1 }, 0)
  const lines = project.lines.filter(line => line.visible).map(line => ({
    lineId: line.id,
    operatingLengthKm: project.geometry.segments.filter(segment => (segmentStates[segment.id]?.lineId ?? segment.lineId) === line.id).reduce((sum, segment) => { const state = segmentStates[segment.id]; return sum + worldUnitsToKilometers((sequence.cache.segmentLengths[segment.id] ?? 0) * state.revealProgress * state.opacity, project) }, 0),
    stationCount: getPresentationStationCountForLine(project, stationStates, line.id),
  })).filter(statistic => statistic.operatingLengthKm > .001 || statistic.stationCount > 0)
  const camera = sequence.settings.cameraMode === 'fixed' || !currentBeat || beatIndex < 0 ? sequence.fixedCamera : evaluateCameraTrack(sequence.cameraTracks[beatIndex], currentBeat, time)
  return { presentationTime: time, historyDate, dateLabel: formatDateLabel(historyDate), currentBeat, currentEvent: currentBeat, globalRevealProgress, currentRevealedDistance, revealFronts, statistics: { operatingLengthKm, stationCount }, lineStatistics: lines, segmentStates, stationStates, camera }
}
export function getBeatLocalProgress(beat: PresentationBeat | null, time: number) { return beat ? getOpeningAnimationState(beat, time).lineRevealProgress : 0 }
export function getBeatGlobalRevealProgress(beat: PresentationBeat, time: number) { return easing.line(getBeatLocalProgress(beat, time)) }
function beatSegmentProgress(beat: PresentationBeat, segmentId: string, time: number) { if (time < beat.revealStart) return 0; if (time >= beat.revealEnd) return 1; return getBeatSegmentRevealProgress(beat, segmentId, getBeatGlobalRevealProgress(beat, time)) }
function beatSegmentDirection(beat: PresentationBeat, segmentId: string, segmentFrom: string): 'from' | 'to' { const directed = beat.branches.flat().find(item => item.segmentId === segmentId); return !directed || directed.fromStationId === segmentFrom ? 'from' : 'to' }
function activeLineIds(project: ActualRouteProject, sequence: PresentationSequence, stationId: string, date: string) { return [...new Set(getCompoundStationMemberIds(project, stationId).flatMap(memberId => sequence.cache.activeLineIdsByDate[date]?.[memberId] ?? []))] }
function presentationVisibleLineIds(project:ActualRouteProject,sequence:PresentationSequence,stationId:string,date:string,time:number){
  const memberIds = getCompoundStationMemberIds(project, stationId)
  return activeLineIds(project, sequence, stationId, date).filter(lineId => memberIds.filter(memberId => project.stationLineRelations.some(relation => relation.stationId === memberId && relation.lineId === lineId)).some(memberId => {
    const beatIndex = sequence.cache.stationLineOpeningBeat[stationLineKey(memberId,lineId)]
    if (beatIndex === undefined) return true
    const beat = sequence.beats[beatIndex], arrival = getStationArrivalRatio(beat, memberId), isOrigin = Boolean(beat.needsOriginReveal && beat.originStationId === memberId), arrivalTime = isOrigin ? beat.originRevealStart : beat.revealStart + inverseLineEasing(arrival) * beat.revealDuration
    return time + 1e-9 >= arrivalTime
  }))
}
function presentationVisibleRelationIds(project: ActualRouteProject, stationId: string, date: string, lineIds: string[]) {
  const representativeFamilies = new Set(lineIds.map(lineId => project.lines.find(line => line.id === lineId)).filter((line): line is ActualRouteProject['lines'][number] => Boolean(line)).map(line => getRootLineId(project, line)))
  return getCompoundStationMemberIds(project, stationId).flatMap(memberId => project.stationLineRelations.filter(relation => {
    const relationLine = project.lines.find(line => line.id === relation.lineId)
    return relation.stationId === memberId && Boolean(relationLine && representativeFamilies.has(getRootLineId(project, relationLine))) && active(relation.openedAt, relation.closedAt, date)
  }).map(relation => relation.id))
}
function getPresentationStationCountForLine(project: ActualRouteProject, stationStates: Record<string, StationPresentationState>, lineId: string) {
  const counted = new Set<string>()
  for (const station of project.stations) {
    if (!isCompoundStationCanonical(project, station)) continue
    const state = stationStates[station.id]
    if (!state || state.opacity <= 0) continue
    const hasVisibleRelation = getCompoundStationRelations(project, station).some(relation => relation.lineId === lineId && state.visibleRelationIds.includes(relation.id))
    if (!hasVisibleRelation) continue
    counted.add(getPassengerStationIdentity(project, station.id))
  }
  return counted.size
}
function active(openedAt: string | null | undefined, closedAt: string | null | undefined, date: string) { return (!openedAt || openedAt <= date) && (!closedAt || date < closedAt) }
function historicallyVisible(openedAt: string | null | undefined, closedAt: string | null | undefined, date: string) { return active(openedAt, closedAt, date) }
function formatDateLabel(date: string) { const normalized = /^\d{4}$/.test(date) ? `${date}-01-01` : /^\d{4}-\d{2}$/.test(date) ? `${date}-01` : date; return normalized ? normalized.replaceAll('-', '.') : '' }
