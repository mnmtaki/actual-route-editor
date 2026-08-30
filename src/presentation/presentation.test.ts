import { describe, expect, it } from 'vitest'
import type { ActualRouteProject, Line, Segment, Station } from '../data/model'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS } from '../data/model'
import { compileHistoryEvents, compilePresentation } from './compiler'
import { getPresentationState } from './engine'
import { inverseLineEasing } from './config'
import { demoProject } from '../data/demo'
import { getSegmentCurveLength } from '../geometry/path'

const station = (id: string, x: number, y: number): Station => ({ id, name: id, x, y, labelOffsetX: 8, labelOffsetY: -8 })
const segment = (id: string, lineId: string, fromStationId: string, toStationId: string, openedAt: string, structureType: Segment['structureType'] = 'underground'): Segment => ({ id, lineId, fromStationId, toStationId, openedAt, structureType, mode: 'smooth', waypoints: [] })
const line = (id: string, lineOrder: number, stationSequence: string[], openedAt: string, color: string): Line => ({ id, name: id, lineOrder, stationSequence, openedAt, color, visible: true, locked: false })
function historyProject(): ActualRouteProject {
  const stations = [station('A',0,100),station('B',100,100),station('C',200,100),station('D',300,100),station('E',400,80),station('F',500,50),station('X',100,0),station('Y',100,200),station('Z',0,200)]
  const lines = [line('L1',0,['A','B','C','D','E','F'],'2000-01-01','#e43d36'),line('L2',1,['X','B','Y'],'2010-01-01','#2879d0'),line('L3',2,['Z','B'],'2015-01-01','#20a46c')]
  const dates: Record<string,string> = { A:'2000-01-01',B:'2000-01-01',C:'2000-01-01',D:'2000-01-01',E:'2005-01-01',F:'2005-01-01',X:'2010-01-01',Y:'2010-01-01',Z:'2015-01-01' }
  const relation = (stationId:string,lineId:string,openedAt:string) => ({ id:`${lineId}-${stationId}`,stationId,lineId,openedAt })
  return { version:1,name:'测试发展史',stations,lines,openingPhases:[],stationLineRelations:[...['A','B','C','D'].map(id=>relation(id,'L1',dates[id])),...['E','F'].map(id=>relation(id,'L1','2005-01-01')),relation('X','L2','2010-01-01'),relation('B','L2','2010-01-01'),relation('Y','L2','2010-01-01'),relation('Z','L3','2015-01-01'),relation('B','L3','2015-01-01')],geometry:{segments:[segment('AB','L1','A','B','2000-01-01'),segment('BC','L1','B','C','2000-01-01'),segment('CD','L1','C','D','2000-01-01'),segment('DE','L1','D','E','2005-01-01'),segment('EF','L1','E','F','2005-01-01'),segment('XB','L2','X','B','2010-01-01','elevated'),segment('BY','L2','B','Y','2010-01-01'),segment('ZB','L3','Z','B','2015-01-01')]},background:null,timeline:{currentDate:'2020-01-01',startDate:'2000-01-01',endDate:'2020-01-01',playing:false},presentation:{...DEFAULT_PRESENTATION_SETTINGS,startDate:'2000-01-01',endDate:'2015-01-01',cameraMode:'follow'},settings:{...DEFAULT_SETTINGS} }
}

describe('history presentation compiler', () => {
  it('merges same-day connected segments and distinguishes opening from extension', () => { const events=compileHistoryEvents(historyProject()); expect(events[0].type).toBe('LINE_OPENING'); expect(events[0].segmentIds).toEqual(expect.arrayContaining(['AB','BC','CD'])); expect(events[0].segmentIds).toHaveLength(3); const extension=events.find(event=>event.historyDate==='2005-01-01')!; expect(extension.type).toBe('LINE_EXTENSION'); expect(extension.branches[0][0].fromStationId).toBe('D'); expect(extension.segmentIds).toEqual(expect.arrayContaining(['DE','EF'])) })
  it('identifies station and interchange facets', () => { const events=compileHistoryEvents(historyProject()); const interchange=events.find(event=>event.historyDate==='2010-01-01')!; expect(interchange.eventTypes).toContain('INTERCHANGE_CREATED'); expect(interchange.interchangeStationIds).toContain('B'); expect(interchange.eventTypes).toContain('STATION_OPENING') })
  it('maps historical dates into independent adaptive Presentation Beats', () => {
    const project=historyProject(); const sequence=compilePresentation(project,{...project.presentation,growthSpeedKmPerSecond:2,pauseDuration:.5})
    expect(sequence.beats).toHaveLength(4)
    expect(sequence.beats.every(beat=>beat.revealDuration>0 && beat.pauseDuration>=.5)).toBe(true); expect(sequence.beats[0].revealDuration).toBeCloseTo(sequence.beats[0].totalPathLength/(project.settings.worldUnitsPerKm*2),6)
    expect(sequence.beats[1].presentationStart).toBe(sequence.beats[0].presentationEnd)
    expect(sequence.duration).toBe(sequence.beats.at(-1)?.presentationEnd)
    expect(sequence.beats.map(beat=>beat.historyDate)).toEqual(['2000-01-01','2005-01-01','2010-01-01','2015-01-01'])
  })
  it('keeps station and interchange semantics inside their line-growth Beat', () => {
    const project=historyProject(); const sequence=compilePresentation(project)
    const beat=sequence.beats.find(item=>item.historyDate==='2010-01-01')!
    expect(beat.eventTypes).toEqual(expect.arrayContaining(['LINE_OPENING','SEGMENT_OPENING','STATION_OPENING','INTERCHANGE_CREATED']))
    expect(sequence.beats.filter(item=>item.historyDate==='2010-01-01')).toHaveLength(1)
  })
  it('uses cumulative curve length for ordered segment reveal', () => {
    const project=historyProject(); const sequence=compilePresentation(project); const beat=sequence.beats[0]
    const directed=beat.branches[0]
    expect(directed.map(item=>item.startRatio)).toEqual([...directed.map(item=>item.startRatio)].sort((a,b)=>a-b))
    expect(directed[0].startRatio).toBe(0); expect(directed.at(-1)?.endRatio).toBeCloseTo(1,6)
    const samples=Array.from({length:31},(_,index)=>getPresentationState(project,sequence,beat.revealStart+beat.revealDuration*index/30).segmentStates.AB.strokeDashoffset)
    expect(new Set(samples.map(value=>value.toFixed(4))).size).toBeGreaterThan(10)
    expect(samples.every((value,index)=>index===0 || value<=samples[index-1]+1e-9)).toBe(true)
  })
  it('evaluates exact animation middle states for scrubbing', () => { const project=historyProject(); const sequence=compilePresentation(project,{...project.presentation,growthSpeedKmPerSecond:2,pauseDuration:0}); const first=sequence.events[0]; const state=getPresentationState(project,sequence,first.revealStart+first.revealDuration*.5); expect(state.segmentStates.AB.revealProgress).toBeGreaterThan(0); expect(state.segmentStates.CD.revealProgress).toBeLessThan(1); expect(state.presentationTime).toBeCloseTo(first.revealStart+first.revealDuration*.5,9) })
  it('keeps fixed camera still and follow camera continuous', () => { const project=historyProject(); const fixed=compilePresentation(project,{...project.presentation,cameraMode:'fixed'}); const a=getPresentationState(project,fixed,0).camera,b=getPresentationState(project,fixed,fixed.duration).camera; expect(b).toEqual(a); const follow=compilePresentation(project,{...project.presentation,cameraMode:'follow'}); const event=follow.events.at(-1)!; const direct=getPresentationState(project,follow,event.revealStart+event.revealDuration*.5).camera; const repeated=getPresentationState(project,follow,event.revealStart+event.revealDuration*.5).camera; expect(Number.isFinite(direct.x)).toBe(true); expect(repeated).toEqual(direct) })
  it('marks elevated segments with the same deterministic reveal value consumed by every style layer', () => { const project=historyProject(); const sequence=compilePresentation(project); const event=sequence.events.find(item=>item.segmentIds.includes('XB'))!; const state=getPresentationState(project,sequence,event.revealStart+event.revealDuration*.5); expect(project.geometry.segments.find(item=>item.id==='XB')?.structureType).toBe('elevated'); expect(state.segmentStates.XB.revealProgress).toBeGreaterThan(0); expect(state.segmentStates.XB.revealProgress).toBeLessThanOrEqual(1) })
  it('morphs B from ordinary to two-line then three-line transfer without changing the stored anchor', () => { const project=historyProject(); project.stations.find(item=>item.id==='B')!.orientationAnchorLineId='L1'; const sequence=compilePresentation(project); const second=sequence.events.find(item=>item.historyDate==='2010-01-01')!; const third=sequence.events.find(item=>item.historyDate==='2015-01-01')!; const two=getPresentationState(project,sequence,second.revealStart+second.revealDuration).stationStates.B; const threeHalf=getPresentationState(project,sequence,third.revealStart+third.revealDuration+.2).stationStates.B; expect(two.lineIds).toEqual(['L1','L2']); expect(threeHalf.previousLineIds).toEqual(['L1','L2']); expect(threeHalf.lineIds).toEqual(['L1','L2','L3']); expect(threeHalf.transferProgress).toBeGreaterThan(0); expect(project.stations.find(item=>item.id==='B')?.orientationAnchorLineId).toBe('L1') })
  it('holds the exact old station line set until the reveal front reaches B', () => {
    const project=historyProject(); const sequence=compilePresentation(project)
    const second=sequence.beats.find(item=>item.historyDate==='2010-01-01')!
    const secondRatio=stationRatio(second,'B'), secondArrival=second.revealStart+inverseLineEasing(secondRatio)*second.revealDuration
    const ordinaryHold=getPresentationState(project,sequence,secondArrival-.02).stationStates.B
    expect(ordinaryHold.previousLineIds).toEqual(['L1']); expect(ordinaryHold.lineIds).toEqual(['L1']); expect(ordinaryHold.transferProgress).toBe(1)
    const twoLineMorph=getPresentationState(project,sequence,secondArrival+.02).stationStates.B
    expect(twoLineMorph.previousLineIds).toEqual(['L1']); expect(twoLineMorph.lineIds).toEqual(['L1','L2']); expect(twoLineMorph.transferProgress).toBeGreaterThan(0); expect(twoLineMorph.transferProgress).toBeLessThan(1)

    const third=sequence.beats.find(item=>item.historyDate==='2015-01-01')!
    const thirdRatio=stationRatio(third,'B'), thirdArrival=third.revealStart+inverseLineEasing(thirdRatio)*third.revealDuration
    const twoLineHold=getPresentationState(project,sequence,thirdArrival-.02).stationStates.B
    expect(twoLineHold.previousLineIds).toEqual(['L1','L2']); expect(twoLineHold.lineIds).toEqual(['L1','L2']); expect(twoLineHold.transferProgress).toBe(1)
    const threeLineMorph=getPresentationState(project,sequence,thirdArrival+.02).stationStates.B
    expect(threeLineMorph.previousLineIds).toEqual(['L1','L2']); expect(threeLineMorph.lineIds).toEqual(['L1','L2','L3']); expect(threeLineMorph.transferProgress).toBeGreaterThan(0); expect(threeLineMorph.transferProgress).toBeLessThan(1)
    expect(getPresentationState(project,sequence,third.presentationEnd).stationStates.B.transferProgress).toBe(1)
  })
})



describe('reveal-front camera and live statistics', () => {
  it('uses one partial Geometry reveal for mileage, front position, station arrival, and full date', () => {
    const project=preciseDemoProject(),sequence=compilePresentation(project),first=sequence.beats[0]
    const start=getPresentationState(project,sequence,first.presentationStart)
    expect(start.statistics).toEqual({operatingLengthKm:0,stationCount:0})
    expect(start.dateLabel).toBe('2000.06.18')
    expect(start.revealFronts).toHaveLength(1)

    const middle=getPresentationState(project,sequence,first.revealStart+first.revealDuration*.5)
    const expectedKm=project.geometry.segments.reduce((sum,segment)=>sum+getSegmentCurveLength(project,segment)*middle.segmentStates[segment.id].revealProgress*middle.segmentStates[segment.id].opacity/100,0)
    expect(middle.statistics.operatingLengthKm).toBeCloseTo(expectedKm,6)
    expect(middle.statistics.operatingLengthKm).toBeGreaterThan(0)
    expect(middle.statistics.operatingLengthKm).toBeLessThan(getPresentationState(project,sequence,first.revealStart+first.revealDuration).statistics.operatingLengthKm)
  })

  it('adds unique stations only when reached and never recounts B during transfer upgrades', () => {
    const project=preciseDemoProject(),sequence=compilePresentation(project)
    const first=sequence.beats[0],firstBRatio=stationRatio(first,'s2'),firstBArrival=first.revealStart+inverseLineEasing(firstBRatio)*first.revealDuration
    expect(getPresentationState(project,sequence,firstBArrival-.01).statistics.stationCount).toBe(1)
    expect(getPresentationState(project,sequence,firstBArrival+.01).statistics.stationCount).toBe(2)

    const blue=sequence.beats.find(beat=>beat.historyDate==='2010-09-28')!,blueRatio=stationRatio(blue,'s2'),blueArrival=blue.revealStart+inverseLineEasing(blueRatio)*blue.revealDuration
    const beforeBlue=getPresentationState(project,sequence,blueArrival-.01),afterBlue=getPresentationState(project,sequence,blueArrival+.01)
    expect(beforeBlue.stationStates.s2.lineIds).toEqual(['line-a'])
    expect(afterBlue.stationStates.s2.lineIds).toEqual(['line-a','line-b'])
    expect(afterBlue.statistics.stationCount).toBe(beforeBlue.statistics.stationCount)

    const green=sequence.beats.find(beat=>beat.historyDate==='2020-12-26')!,greenRatio=stationRatio(green,'s2'),greenArrival=green.revealStart+inverseLineEasing(greenRatio)*green.revealDuration
    const beforeGreen=getPresentationState(project,sequence,greenArrival-.01),afterGreen=getPresentationState(project,sequence,greenArrival+.01)
    expect(beforeGreen.stationStates.s2.lineIds).toEqual(['line-a','line-b'])
    expect(afterGreen.stationStates.s2.lineIds).toEqual(['line-a','line-b','line-c'])
    expect(afterGreen.statistics.stationCount).toBe(beforeGreen.statistics.stationCount)
  })

  it('follows only the current front through a 52 percent safe area without revealing future Beat bounds', () => {
    const project=preciseDemoProject(),sequence=compilePresentation(project),beat=sequence.beats[0]
    const start=getPresentationState(project,sequence,beat.presentationStart)
    const future=project.stations.find(station=>station.id==='s4')!
    expect(start.camera.x+start.camera.width).toBeLessThan(future.x)
    const frames=Array.from({length:21},(_,index)=>getPresentationState(project,sequence,beat.revealStart+beat.revealDuration*index/20))
    expect(frames.at(-1)!.camera.x-frames[0].camera.x).toBeGreaterThan(200)
    expect(new Set(frames.map(frame=>frame.camera.width.toFixed(4))).size).toBe(1)
    expect(Math.max(...frames.slice(1).map((frame,index)=>Math.abs(frame.camera.x-frames[index].camera.x)))).toBeLessThan(100)
    expect(frames.every(frame=>frame.revealFronts.length===1)).toBe(true)
    const next=sequence.beats[1],beforeBoundary=getPresentationState(project,sequence,next.presentationStart-.001).camera,atBoundary=getPresentationState(project,sequence,next.presentationStart).camera
    expect(Math.abs(atBoundary.x-beforeBoundary.x)).toBeLessThan(1)
    expect(Math.abs(atBoundary.y-beforeBoundary.y)).toBeLessThan(1)
  })

  it('counts a delayed station only in its later Station-Line opening Beat', () => {
    const project=preciseDemoProject()
    project.stations.find(station=>station.id==='s3')!.openedAt='2005-02-03'
    project.stationLineRelations.find(relation=>relation.stationId==='s3'&&relation.lineId==='line-a')!.openedAt='2005-02-03'
    project.presentation.endDate='2020-12-26'
    const sequence=compilePresentation(project),first=sequence.beats[0],delayed=sequence.beats.find(beat=>beat.type==='STATION_OPENING'&&beat.historyDate==='2005-02-03')!
    expect(delayed).toBeTruthy()
    expect(getPresentationState(project,sequence,first.presentationEnd).statistics.stationCount).toBe(3)
    expect(getPresentationState(project,sequence,delayed.presentationStart).statistics.stationCount).toBe(3)
    expect(getPresentationState(project,sequence,delayed.revealStart+.05).statistics.stationCount).toBe(4)
  })
  it('keeps the real date stable throughout every Beat', () => {
    const project=preciseDemoProject(),sequence=compilePresentation(project)
    for(const beat of sequence.beats){
      const expected=beat.historyDate.replaceAll('-','.')
      expect(getPresentationState(project,sequence,beat.presentationStart+.01).dateLabel).toBe(expected)
      expect(getPresentationState(project,sequence,beat.revealStart+beat.revealDuration*.8).dateLabel).toBe(expected)
    }
  })
})
describe('closure presentation', () => {
  it('fades line segments after line.closedAt without mutating project data', () => { const project=historyProject(); project.lines.find(item=>item.id==='L1')!.closedAt='2012-01-01'; project.presentation.endDate='2015-01-01'; const sequence=compilePresentation(project); const closure=sequence.events.find(item=>item.type==='LINE_CLOSURE')!; const state=getPresentationState(project,sequence,closure.revealStart+closure.revealDuration*.5); expect(state.segmentStates.AB.opacity).toBeGreaterThan(0); expect(state.segmentStates.AB.opacity).toBeLessThan(1); expect(project.lines.find(item=>item.id==='L1')!.closedAt).toBe('2012-01-01') })
})
function stationRatio(beat: ReturnType<typeof compilePresentation>['beats'][number], stationId: string) {
  const values=beat.branches.flatMap(branch=>branch.flatMap(item=>[item.fromStationId===stationId?item.startRatio:null,item.toStationId===stationId?item.endRatio:null])).filter((value):value is number=>value!==null)
  return Math.min(...values)
}
function preciseDemoProject(){
  const project=structuredClone(demoProject)
  const dates:Record<string,string>={'2000-01-01':'2000-06-18','2010-01-01':'2010-09-28','2020-01-01':'2020-12-26'}
  const apply=(value:string|null|undefined)=>value?dates[value]??value:value
  for(const item of [...project.stations,...project.lines,...project.stationLineRelations,...project.geometry.segments]){item.openedAt=apply(item.openedAt);item.closedAt=apply(item.closedAt)}
  project.timeline={currentDate:'2020-12-26',startDate:'2000-06-18',endDate:'2020-12-26',playing:false}
  project.presentation={...project.presentation,startDate:'2000-06-18',endDate:'2020-12-26',cameraMode:'follow'}
  project.settings.worldUnitsPerKm=100
  return project
}