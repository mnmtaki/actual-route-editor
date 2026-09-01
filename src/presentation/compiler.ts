import type { ActualRouteProject, Line, OpeningPhase, PresentationSettings, Segment } from '../data/model'
import { getSegmentCurveLength, getSegmentPoints } from '../geometry/path'
import { PRESENTATION_ANIMATION, clamp } from './config'
import { compileCameraTrack } from './camera'
import { getBeatRevealFronts } from './reveal'
import type { CameraView, DirectedSegment, HistoryEvent, PresentationBeat, PresentationCompileCache, PresentationSequence } from './types'

const FAR_FUTURE = '9999-12-31'
const openDate = (project: ActualRouteProject, segment: Segment) => segment.openedAt || project.lines.find(line => line.id === segment.lineId)?.openedAt || ''
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const isOpenAt = (openedAt: string | null | undefined, closedAt: string | null | undefined, date: string) => (!openedAt || openedAt <= date) && (!closedAt || date < closedAt)

export function compileHistoryEvents(project: ActualRouteProject, settings: PresentationSettings = project.presentation): HistoryEvent[] {
  const start = settings.startDate || '0000-01-01', end = settings.endDate || FAR_FUTURE
  const openings = new Map<string, Segment[]>()
  for (const segment of project.geometry.segments) {
    const date = openDate(project, segment)
    if (!validDate(date) || date < start || date > end) continue
    const phase = project.openingPhases.find(item => item.lineId === segment.lineId && item.openedAt === date && item.segmentIds.includes(segment.id) && !item.overriddenSegmentIds?.includes(segment.id))
    const key = `${date}\u0000${segment.lineId}\u0000${phase?.id ?? ''}`
    openings.set(key, [...(openings.get(key) ?? []), segment])
  }
  const events: HistoryEvent[] = []
  for (const [key, segments] of openings) {
    const [historyDate, lineId, openingPhaseId] = key.split('\u0000')
    const phase = openingPhaseId ? project.openingPhases.find(item => item.id === openingPhaseId) : undefined
    const earlier = project.geometry.segments.filter(segment => segment.lineId === lineId && validDate(openDate(project, segment)) && openDate(project, segment) < historyDate)
    for (const [componentIndex, component] of connectedComponents(segments).entries()) {
      const type = earlier.length ? 'LINE_EXTENSION' : 'LINE_OPENING'
      const branches = directComponent(project, component, earlier, phase)
      const stationIds = unique(component.flatMap(segment => [segment.fromStationId, segment.toStationId])).filter(stationId => stationOpensAt(project, stationId, lineId, historyDate))
      const interchangeStationIds = stationIds.filter(stationId => { const before = activeLineIds(project, stationId, previousDate(historyDate)).length, after = activeLineIds(project, stationId, historyDate).length; return after >= 2 && after > before })
      const eventTypes = unique([type, 'SEGMENT_OPENING', ...(stationIds.length ? ['STATION_OPENING'] : []), ...(interchangeStationIds.length ? ['INTERCHANGE_CREATED'] : [])]) as HistoryEvent['eventTypes']
      events.push({ id: `${historyDate}-${lineId}-${openingPhaseId || 'legacy'}-${componentIndex}`, type, eventTypes, historyDate, lineId, openingPhaseId: openingPhaseId || undefined, segmentIds: component.map(segment => segment.id), stationIds, interchangeStationIds, branches })
    }
  }
  const covered = new Set(events.flatMap(event => event.stationIds.map(stationId => `${event.historyDate}\u0000${event.lineId}\u0000${stationId}`)))
  for (const relation of project.stationLineRelations) {
    const historyDate = relation.openedAt
    if (!validDate(historyDate) || historyDate < start || historyDate > end || covered.has(`${historyDate}\u0000${relation.lineId}\u0000${relation.stationId}`)) continue
    const before = activeLineIds(project, relation.stationId, previousDate(historyDate)).length, after = activeLineIds(project, relation.stationId, historyDate).length
    const interchangeStationIds = after >= 2 && after > before ? [relation.stationId] : []
    const phase = project.openingPhases.find(item => item.lineId === relation.lineId && item.openedAt === historyDate && item.stationRelationIds.includes(relation.id) && !item.overriddenStationRelationIds?.includes(relation.id))
    events.push({ id: `${historyDate}-${relation.lineId}-station-${relation.stationId}`, type: 'STATION_OPENING', eventTypes: ['STATION_OPENING', ...(interchangeStationIds.length ? ['INTERCHANGE_CREATED' as const] : [])], historyDate, lineId: relation.lineId, openingPhaseId: phase?.id, segmentIds: [], stationIds: [relation.stationId], interchangeStationIds, branches: [] })
  }
  for (const segment of project.geometry.segments) if (validDate(segment.closedAt) && segment.closedAt >= start && segment.closedAt <= end) events.push({ id: `${segment.closedAt}-${segment.lineId}-close-${segment.id}`, type: 'SEGMENT_CLOSURE', eventTypes: ['SEGMENT_CLOSURE'], historyDate: segment.closedAt, lineId: segment.lineId, segmentIds: [segment.id], stationIds: [], interchangeStationIds: [], branches: [] })
  for (const line of project.lines) if (validDate(line.closedAt) && line.closedAt >= start && line.closedAt <= end) {
    const lineSegments = project.geometry.segments.filter(segment => segment.lineId === line.id)
    events.push({ id: `${line.closedAt}-${line.id}-line-close`, type: 'LINE_CLOSURE', eventTypes: ['LINE_CLOSURE'], historyDate: line.closedAt, lineId: line.id, segmentIds: lineSegments.map(segment => segment.id), stationIds: unique(lineSegments.flatMap(segment => [segment.fromStationId, segment.toStationId])), interchangeStationIds: [], branches: [] })
  }
  return events.sort((a, b) => a.historyDate.localeCompare(b.historyDate) || lineOrder(project, a.lineId) - lineOrder(project, b.lineId) || a.id.localeCompare(b.id))
}

export function compilePresentationBeats(project: ActualRouteProject, events: HistoryEvent[], settings: PresentationSettings): PresentationBeat[] {
  let cursor = 0
  const speed = Math.max(.01, settings.growthSpeedKmPerSecond) * Math.max(.001, project.settings.worldUnitsPerKm)
  return events.map((event, index) => {
    const branchLengths = event.branches.map(branch => branch.reduce((sum, item) => sum + item.length, 0))
    const totalPathLength = Math.max(0, ...branchLengths)
    const primaryBranchIndex = branchLengths.length ? branchLengths.indexOf(totalPathLength) : 0
    const opening = event.eventTypes.includes('SEGMENT_OPENING')
    const revealDuration = opening ? totalPathLength / speed : event.type.includes('CLOSURE') ? PRESENTATION_ANIMATION.closureFadeDuration : settings.stationOpeningDuration
    const cameraTransitionDuration = index === 0 ? 0 : PRESENTATION_ANIMATION.cameraTransitionDuration
    const revealStart = cursor + cameraTransitionDuration, revealEnd = revealStart + revealDuration
    const overviewAfter = Boolean(settings.overviewAfterEachPhase && event.openingPhaseId)
    const pauseDuration = Math.max(0, settings.pauseDuration, event.interchangeStationIds.length ? PRESENTATION_ANIMATION.transferMorphDuration : 0)
    const overviewEnterDuration = overviewAfter ? PRESENTATION_ANIMATION.overviewTransitionDuration : 0
    const overviewHoldDuration = overviewAfter ? Math.max(0, settings.overviewHoldDuration) : 0
    const overviewExitDuration = overviewAfter ? PRESENTATION_ANIMATION.overviewTransitionDuration : 0
    const overviewStart = revealEnd + pauseDuration, overviewEnd = overviewStart + overviewEnterDuration + overviewHoldDuration + overviewExitDuration
    const beat: PresentationBeat = { ...event, beatId: `beat-${index}-${event.id}`, presentationStart: cursor, cameraTransitionDuration, revealStart, revealDuration, revealEnd, animationDuration: revealDuration, pauseDuration, presentationEnd: overviewEnd, totalPathLength, branchLengths, primaryBranchIndex, overviewAfter, overviewStart, overviewEnterDuration, overviewHoldDuration, overviewExitDuration, overviewEnd }
    cursor = beat.presentationEnd
    return beat
  })
}

export function compilePresentation(project: ActualRouteProject, settings: PresentationSettings = project.presentation, aspectOverride?: number): PresentationSequence {
  const history = compileHistoryEvents(project, settings), beats = compilePresentationBeats(project, history, settings)
  const duration = beats.at(-1)?.presentationEnd ?? 0, { width, height } = resolutionSize(settings.resolution), aspect = aspectOverride && aspectOverride > 0 ? aspectOverride : width / height
  const selected = project.geometry.segments.filter(segment => { const date = openDate(project, segment); return validDate(date) && date >= (settings.startDate || '0000-01-01') && date <= (settings.endDate || FAR_FUTURE) })
  const fixedCamera = fitBounds(boundsForSegments(project, selected.length ? selected : project.geometry.segments), aspect)
  const cameraTracks = []
  let previousCamera: CameraView = fixedCamera
  for (const beat of beats) {
    const firstFront = getBeatRevealFronts(project, beat, 0).find(front => front.branchIndex === beat.primaryBranchIndex)
    if (cameraTracks.length === 0 && firstFront) {
      const cameraWidth = Math.max(100, settings.cameraViewWidth)
      previousCamera = { x: firstFront.worldX - cameraWidth / 2, y: firstFront.worldY - cameraWidth / aspect / 2, width: cameraWidth, height: cameraWidth / aspect }
    }
    const track = compileCameraTrack(project, beat, aspect, previousCamera, settings.cameraViewWidth)
    cameraTracks.push(track); previousCamera = track.endCamera
  }
  const cache = buildCompileCache(project, beats)
  return { beats, events: beats, duration, initialDate: beats[0]?.historyDate ?? settings.startDate, finalDate: beats.at(-1)?.historyDate ?? settings.endDate, fixedCamera, cameraTracks, followCameras: cameraTracks.map(track => track.startCamera), settings, cache }
}

function buildCompileCache(project: ActualRouteProject, beats: PresentationBeat[]): PresentationCompileCache {
  const segmentOpeningBeat: Record<string, number> = {}, segmentClosureBeat: Record<string, number> = {}, stationBeatIndices: Record<string, number[]> = {}, stationLineOpeningBeat: Record<string, number> = {}, dates = new Set<string>()
  beats.forEach((beat, index) => { dates.add(beat.historyDate); dates.add(previousDate(beat.historyDate)); for (const id of beat.segmentIds) { if (beat.eventTypes.includes('SEGMENT_OPENING') && segmentOpeningBeat[id] === undefined) segmentOpeningBeat[id] = index; if (beat.eventTypes.includes('SEGMENT_CLOSURE') || beat.eventTypes.includes('LINE_CLOSURE')) segmentClosureBeat[id] = index } for (const stationId of unique([...beat.stationIds, ...beat.interchangeStationIds])) { stationBeatIndices[stationId] = [...(stationBeatIndices[stationId] ?? []), index]; const key=stationLineKey(stationId,beat.lineId); if(stationLineOpeningBeat[key]===undefined&&!beat.type.includes('CLOSURE'))stationLineOpeningBeat[key]=index } })
  const activeLineIdsByDate: Record<string, Record<string, string[]>> = {}; for (const date of dates) activeLineIdsByDate[date] = activeLinesForAllStations(project, date)
  const segmentLengths = Object.fromEntries(project.geometry.segments.map(segment => [segment.id, getSegmentCurveLength(project, segment)]))
  return { segmentOpeningBeat, segmentClosureBeat, stationBeatIndices, stationLineOpeningBeat, activeLineIdsByDate, segmentLengths }
}
export function stationLineKey(stationId:string,lineId:string){return `${stationId}\u0000${lineId}`}
function activeLinesForAllStations(project: ActualRouteProject, date: string) { const lines = new Map(project.lines.map(line => [line.id, line])), result: Record<string, string[]> = {}; for (const relation of project.stationLineRelations) { const line = lines.get(relation.lineId); if (!line || !isOpenAt(relation.openedAt, relation.closedAt, date) || !isOpenAt(line.openedAt, line.closedAt, date)) continue; result[relation.stationId] = [...(result[relation.stationId] ?? []), line.id] } for (const ids of Object.values(result)) ids.sort((a, b) => compareLines(lines.get(a), lines.get(b))); return result }
function compareLines(a: Line | undefined, b: Line | undefined) { return (a?.openedAt || '0000-01-01').localeCompare(b?.openedAt || '0000-01-01') || (a?.lineOrder ?? 1e9) - (b?.lineOrder ?? 1e9) }
function connectedComponents(segments: Segment[]) { const remaining = new Set(segments.map(segment => segment.id)), result: Segment[][] = []; while (remaining.size) { const first = segments.find(segment => remaining.has(segment.id))!, queue = [first], component: Segment[] = []; remaining.delete(first.id); while (queue.length) { const current = queue.shift()!; component.push(current); for (const candidate of segments) if (remaining.has(candidate.id) && sharesStation(current, candidate)) { remaining.delete(candidate.id); queue.push(candidate) } } result.push(component) } return result }
function directComponent(project: ActualRouteProject, component: Segment[], earlier: Segment[], phase?: OpeningPhase): DirectedSegment[][] {
  const byStation = new Map<string, Segment[]>(); for (const segment of component) for (const stationId of [segment.fromStationId, segment.toStationId]) byStation.set(stationId, [...(byStation.get(stationId) ?? []), segment])
  const existing = new Set(earlier.flatMap(segment => [segment.fromStationId, segment.toStationId])), endpoints = [...byStation].filter(([, list]) => list.length === 1).map(([id]) => id), connections = [...byStation.keys()].filter(id => existing.has(id))
  const line = project.lines.find(item => item.id === component[0]?.lineId), order = (id: string) => { const value = line?.stationSequence.indexOf(id) ?? -1; return value < 0 ? 1e9 : value }
  const phaseStart = phase?.revealStartStationId && byStation.has(phase.revealStartStationId) ? phase.revealStartStationId : undefined
  const anchor = connections.length === 1 ? connections[0] : phaseStart
  const seeds = unique([...(anchor ? [anchor] : []), ...endpoints].filter(Boolean)).sort((a, b) => a === anchor ? -1 : b === anchor ? 1 : order(a) - order(b) || a.localeCompare(b))
  const unvisited = new Set(component.map(segment => segment.id)), branches: DirectedSegment[][] = []
  const walk = (seed: string) => { let stationId = seed; const branch: Omit<DirectedSegment, 'startRatio' | 'endRatio'>[] = []; while (true) { const candidates = (byStation.get(stationId) ?? []).filter(segment => unvisited.has(segment.id)).sort((a, b) => segmentOrder(project, a) - segmentOrder(project, b) || a.id.localeCompare(b.id)); const segment = candidates[0]; if (!segment) break; unvisited.delete(segment.id); const toStationId = segment.fromStationId === stationId ? segment.toStationId : segment.fromStationId; branch.push({ segmentId: segment.id, fromStationId: stationId, toStationId, length: getSegmentCurveLength(project, segment) }); stationId = toStationId; if ((byStation.get(stationId) ?? []).filter(item => unvisited.has(item.id)).length > 1) break } if (branch.length) branches.push(withRatios(branch)); for (const candidate of (byStation.get(stationId) ?? []).filter(segment => unvisited.has(segment.id))) walk(stationId) }
  for (const seed of seeds) if ((byStation.get(seed) ?? []).some(segment => unvisited.has(segment.id))) walk(seed)
  while (unvisited.size) { const segment = component.find(item => unvisited.has(item.id))!; walk(segment.fromStationId) }
  return branches
}
function withRatios(branch: Omit<DirectedSegment, 'startRatio' | 'endRatio'>[]) { const total = branch.reduce((sum, item) => sum + item.length, 0) || branch.length; let cursor = 0; return branch.map(item => { const startRatio = cursor / total; cursor += item.length || 1; return { ...item, startRatio, endRatio: cursor / total } }) }
export function estimateSegmentLength(project: ActualRouteProject, segment: Segment) { return getSegmentCurveLength(project, segment) }
function stationOpensAt(project: ActualRouteProject, stationId: string, lineId: string, date: string) { const relation = project.stationLineRelations.find(item => item.stationId === stationId && item.lineId === lineId); return (relation?.openedAt || project.stations.find(item => item.id === stationId)?.openedAt || date) === date }
function activeLineIds(project: ActualRouteProject, stationId: string, date: string) { return project.stationLineRelations.filter(relation => relation.stationId === stationId && isOpenAt(relation.openedAt, relation.closedAt, date) && isOpenAt(project.lines.find(line => line.id === relation.lineId)?.openedAt, project.lines.find(line => line.id === relation.lineId)?.closedAt, date)).map(relation => relation.lineId) }
function previousDate(date: string) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10) }
function sharesStation(a: Segment, b: Segment) { return a.fromStationId === b.fromStationId || a.fromStationId === b.toStationId || a.toStationId === b.fromStationId || a.toStationId === b.toStationId }
function lineOrder(project: ActualRouteProject, lineId: string) { return project.lines.find(line => line.id === lineId)?.lineOrder ?? 1e9 }
function segmentOrder(project: ActualRouteProject, segment: Segment) { const line = project.lines.find(item => item.id === segment.lineId), a = line?.stationSequence.indexOf(segment.fromStationId) ?? -1, b = line?.stationSequence.indexOf(segment.toStationId) ?? -1; return Math.min(a < 0 ? 1e9 : a, b < 0 ? 1e9 : b) }
function unique<T>(values: T[]): T[] { return [...new Set(values)] }
function boundsForSegments(project: ActualRouteProject, segments: Segment[]) { const points = segments.flatMap(segment => getSegmentPoints(project, segment)); if (!points.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 700 }; return { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) } }
function fitBounds(bounds: ReturnType<typeof boundsForSegments>, aspect: number): CameraView { const padding = PRESENTATION_ANIMATION.boundsPadding; let width = Math.max(260, bounds.maxX - bounds.minX + padding * 2), height = Math.max(180, bounds.maxY - bounds.minY + padding * 2); if (width / height > aspect) height = width / aspect; else width = height * aspect; return { x: (bounds.minX + bounds.maxX - width) / 2, y: (bounds.minY + bounds.maxY - height) / 2, width, height } }
export function resolutionSize(value: PresentationSettings['resolution']) { if (value === '1080x1920') return { width: 1080, height: 1920 }; if (value === '1280x720') return { width: 1280, height: 720 }; return { width: 1920, height: 1080 } }
