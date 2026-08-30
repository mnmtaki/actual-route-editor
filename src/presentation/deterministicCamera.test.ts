import { describe, expect, it } from 'vitest'
import type { ActualRouteProject, Segment } from '../data/model'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS } from '../data/model'
import { compilePresentation } from './compiler'
import { getPresentationState } from './engine'
import { getSegmentCurveLength } from '../geometry/path'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'

const date = '2020-01-01'
function straightProject(lengthWorld: number, speed = 2): ActualRouteProject {
  return projectFrom({
    stations: [['A', 0, 0], ['B', lengthWorld, 0]],
    sequence: ['A', 'B'],
    segments: [{ id: 'AB', from: 'A', to: 'B', openedAt: date }],
    speed,
  })
}
function projectFrom(input: { stations: [string, number, number][]; sequence: string[]; segments: { id: string; from: string; to: string; openedAt: string; waypoints?: Segment['waypoints'] }[]; speed?: number; phase?: ActualRouteProject['openingPhases'][number] }): ActualRouteProject {
  const openedByStation = new Map<string, string>()
  for (const segment of input.segments) for (const id of [segment.from, segment.to]) {
    const previous = openedByStation.get(id)
    if (!previous || segment.openedAt < previous) openedByStation.set(id, segment.openedAt)
  }
  return {
    version: 1,
    name: 'deterministic-camera-test',
    stations: input.stations.map(([id, x, y]) => ({ id, name: id, x, y, labelOffsetX: 10, labelOffsetY: -10 })),
    lines: [{ id: 'L', name: 'L', color: '#d83b35', lineOrder: 0, stationSequence: input.sequence, openedAt: [...openedByStation.values()].sort()[0], visible: true, locked: false }],
    stationLineRelations: input.stations.map(([id]) => ({ id: `r-${id}`, stationId: id, lineId: 'L', openedAt: openedByStation.get(id) ?? date })),
    openingPhases: input.phase ? [input.phase] : [],
    geometry: { segments: input.segments.map(item => ({ id: item.id, lineId: 'L', fromStationId: item.from, toStationId: item.to, mode: item.waypoints?.length ? 'smooth' : 'straight', structureType: 'underground', structureNodes: [], waypoints: item.waypoints ?? [], openedAt: item.openedAt })) },
    background: null,
    timeline: { currentDate: date, startDate: '2000-01-01', endDate: date, playing: false },
    presentation: { ...DEFAULT_PRESENTATION_SETTINGS, startDate: '2000-01-01', endDate: date, growthSpeedKmPerSecond: input.speed ?? 2, pauseDuration: 0, cameraMode: 'follow' },
    settings: { ...DEFAULT_SETTINGS, worldUnitsPerKm: 100 },
  }
}

describe('deterministic camera track and constant-distance reveal', () => {
  it('returns exactly the same Camera for sequential playback, direct seek, and repeated evaluation', () => {
    const project = curvedProject(), sequence = compilePresentation(project), beat = sequence.beats[0], time = beat.revealStart + beat.revealDuration * .637
    for (let index = 0; index < 200; index += 1) getPresentationState(project, sequence, beat.revealStart + beat.revealDuration * index / 199)
    const direct = getPresentationState(project, sequence, time).camera
    expect(getPresentationState(project, sequence, time).camera).toEqual(direct)
    expect(getPresentationState(project, sequence, time).camera).toEqual(direct)
  })

  it('keeps Scale fixed and the reveal front within five percent of frame center for 300 construction frames', () => {
    const project = curvedProject(), sequence = compilePresentation(project), beat = sequence.beats[0]
    const frames = Array.from({ length: 300 }, (_, index) => getPresentationState(project, sequence, beat.revealStart + beat.revealDuration * index / 299))
    expect(new Set(frames.map(frame => `${frame.camera.width.toFixed(9)}:${frame.camera.height.toFixed(9)}`)).size).toBe(1)
    const maxDeviation = Math.max(...frames.map(frame => {
      const front = frame.revealFronts.find(item => item.branchIndex === beat.primaryBranchIndex)!
      return Math.max(Math.abs(front.worldX - (frame.camera.x + frame.camera.width / 2)) / frame.camera.width, Math.abs(front.worldY - (frame.camera.y + frame.camera.height / 2)) / frame.camera.height)
    }))
    expect(maxDeviation).toBeLessThan(.05)
  })

  it('does not introduce alternating Camera corrections that are absent from the reveal path', () => {
    const project = curvedProject(), sequence = compilePresentation(project), beat = sequence.beats[0]
    const frames = Array.from({ length: 300 }, (_, index) => getPresentationState(project, sequence, beat.revealStart + beat.revealDuration * index / 299))
    const cameraX = frames.map(frame => frame.camera.x + frame.camera.width / 2)
    expect(cameraX.slice(1).every((value, index) => value >= cameraX[index] - 1e-6)).toBe(true)
    const reversals = (values: number[]) => values.slice(2).filter((value, index) => Math.sign(value - values[index + 1]) && Math.sign(values[index + 1] - values[index]) && Math.sign(value - values[index + 1]) !== Math.sign(values[index + 1] - values[index])).length
    const frontY = frames.map(frame => frame.revealFronts[0].worldY), cameraY = frames.map(frame => frame.camera.y + frame.camera.height / 2)
    expect(reversals(cameraY)).toBeLessThanOrEqual(reversals(frontY) + 1)
  })

  it('derives opening duration from actual Geometry km and keeps two km per second', () => {
    const short = straightProject(400), long = straightProject(2000)
    const shortBeat = compilePresentation(short).beats[0], longBeat = compilePresentation(long).beats[0]
    expect(shortBeat.revealDuration).toBeCloseTo(2, 8)
    expect(longBeat.revealDuration).toBeCloseTo(10, 8)
    expect(longBeat.revealDuration).not.toBe(shortBeat.revealDuration)
    const sequence = compilePresentation(short), afterOneSecond = getPresentationState(short, sequence, shortBeat.revealStart + 1)
    expect(afterOneSecond.currentRevealedDistance / short.settings.worldUnitsPerKm).toBeCloseTo(2, 6)
    expect(afterOneSecond.statistics.operatingLengthKm).toBeCloseTo(2, 6)
  })

  it('opens a station exactly when the shared revealed distance reaches it', () => {
    const project = projectFrom({ stations: [['A',0,0],['B',200,0],['C',400,0]], sequence: ['A','B','C'], segments: [{id:'AB',from:'A',to:'B',openedAt:date},{id:'BC',from:'B',to:'C',openedAt:date}], speed: 2 })
    const sequence = compilePresentation(project), beat = sequence.beats[0], arrival = beat.revealStart + 1
    expect(getPresentationState(project, sequence, arrival - .001).stationStates.B.opacity).toBe(0)
    expect(getPresentationState(project, sequence, arrival + .001).stationStates.B.opacity).toBeGreaterThan(0)
  })

  it('directs an extension outward from the single Previous Stable anchor despite reversed stationSequence', () => {
    const project = projectFrom({ stations: [['A',0,0],['B',100,0],['C',200,0],['D',300,0],['E',400,0]], sequence: ['E','D','C','B','A'], segments: [{id:'AB',from:'A',to:'B',openedAt:'2000-01-01'},{id:'BC',from:'B',to:'C',openedAt:'2000-01-01'},{id:'CD',from:'C',to:'D',openedAt:date},{id:'DE',from:'D',to:'E',openedAt:date}] })
    const beat = compilePresentation(project).beats.find(item => item.historyDate === date)!
    expect(beat.type).toBe('LINE_EXTENSION')
    expect(beat.branches[0].map(item => `${item.fromStationId}-${item.toStationId}`)).toEqual(['C-D','D-E'])
  })

  it('uses explicit OpeningPhase direction for a new line with no Previous Stable anchor', () => {
    const phase = { id:'phase', lineId:'L', name:'一期', openedAt:date, segmentIds:['AB','BC'], stationRelationIds:['r-A','r-B','r-C'], revealStartStationId:'C', revealEndStationId:'A' }
    const project = projectFrom({ stations: [['A',0,0],['B',100,0],['C',200,0]], sequence: ['A','B','C'], segments: [{id:'AB',from:'A',to:'B',openedAt:date},{id:'BC',from:'B',to:'C',openedAt:date}], phase })
    const beat = compilePresentation(project).beats[0]
    expect(beat.branches[0].map(item => `${item.fromStationId}-${item.toStationId}`)).toEqual(['C-B','B-A'])
  })

  it('accepts legacy eventDuration JSON but no longer uses it as an opening Beat duration', () => {
    const project=straightProject(400),raw=JSON.parse(serializeProject(project))
    delete raw.presentation.growthSpeedKmPerSecond; raw.presentation.eventDuration=99
    const restored=parseProjectJson(JSON.stringify(raw)),beat=compilePresentation(restored).beats[0]
    expect(restored.presentation.growthSpeedKmPerSecond).toBe(1.5)
    expect(restored.presentation.eventDuration).toBe(99)
    expect(beat.revealDuration).toBeCloseTo(4/1.5,8); expect(beat.revealDuration).not.toBe(99)
  })
  it('uses a fixed duration for a station-only opening instead of dividing zero km by speed', () => {
    const project = straightProject(400)
    project.stationLineRelations.push({ id:'r-late', stationId:'late', lineId:'L', openedAt:'2021-01-01' })
    project.stations.push({ id:'late', name:'late', x:200, y:0, labelOffsetX:10, labelOffsetY:-10 })
    project.presentation.endDate='2021-01-01'; project.presentation.stationOpeningDuration=1.15
    const beat=compilePresentation(project).beats.find(item=>item.type==='STATION_OPENING')!
    expect(beat.totalPathLength).toBe(0); expect(beat.revealDuration).toBe(1.15)
  })
})

function curvedProject() {
  const stations: [string,number,number][] = Array.from({length:7},(_,index)=>[`S${index}`,index*500,350+Math.sin(index*.9)*230])
  return projectFrom({ stations, sequence: stations.map(item=>item[0]), segments: stations.slice(0,-1).map((item,index)=>({ id:`seg-${index}`, from:item[0], to:stations[index+1][0], openedAt:date, waypoints:[{id:`w-${index}`,x:index*500+250,y:350+Math.sin(index*.9+.45)*260,type:'smooth' as const}] })), speed:1.5 })
}