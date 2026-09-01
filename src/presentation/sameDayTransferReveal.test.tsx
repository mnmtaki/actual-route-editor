import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ActualRouteProject, Segment } from '../data/model'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS } from '../data/model'
import { convertAarcToActualRouteProject } from '../import-export/aarc'
import rawMuyang from '../import-export/__fixtures__/木阳.aarc.json'
import { getActiveLinesAtStation, getOrientationAnchorLine } from '../timeline/active'
import { compilePresentation } from './compiler'
import { inverseLineEasing, PRESENTATION_ANIMATION } from './config'
import { getPresentationState } from './engine'
import { getStationArrivalRatio } from './reveal'
import { PresentationScene } from './PresentationScene'

const DATE='2026-06-28'
const station=(id:string,x:number,y:number)=>({id,name:id,x,y,labelOffsetX:12,labelOffsetY:-12})
const segment=(id:string,lineId:string,fromStationId:string,toStationId:string):Segment=>({id,lineId,fromStationId,toStationId,mode:'straight',structureType:'underground',structureNodes:[],waypoints:[],openedAt:DATE})

function sameDayProject():ActualRouteProject{
  const lines=[
    {id:'line-4',name:'4号线',color:'#7a4db3',stationSequence:['A0','紫明','A2'],lineOrder:0,openedAt:DATE,visible:true,locked:false},
    {id:'line-6',name:'6号线',color:'#2c8a60',stationSequence:['B0','紫明','B2'],lineOrder:1,openedAt:DATE,visible:true,locked:false},
    {id:'line-8',name:'8号线',color:'#d36b32',stationSequence:['C0','紫明','C2'],lineOrder:2,openedAt:DATE,visible:true,locked:false},
  ]
  const stations=[station('A0',0,0),station('A2',400,0),station('B0',200,-200),station('B2',200,200),station('C0',0,-200),station('C2',400,200),station('紫明',200,0)]
  const stationLineRelations=lines.flatMap(line=>line.stationSequence.map(stationId=>({id:`relation-${line.id}-${stationId}`,stationId,lineId:line.id,openedAt:DATE})))
  return {version:1,name:'同日换乘测试',stations,lines,stationLineRelations,openingPhases:[],geometry:{segments:[segment('4-a','line-4','A0','紫明'),segment('4-b','line-4','紫明','A2'),segment('6-a','line-6','B0','紫明'),segment('6-b','line-6','紫明','B2'),segment('8-a','line-8','C0','紫明'),segment('8-b','line-8','紫明','C2')]},mapElements:[],background:null,timeline:{currentDate:DATE,startDate:DATE,endDate:DATE,playing:false},presentation:{...DEFAULT_PRESENTATION_SETTINGS,startDate:DATE,endDate:DATE,cameraMode:'follow'},settings:{...DEFAULT_SETTINGS,worldUnitsPerKm:100}}
}

const arrivalTime=(beat:ReturnType<typeof compilePresentation>['beats'][number])=>beat.revealStart+inverseLineEasing(getStationArrivalRatio(beat,'紫明'))*beat.revealDuration
const lineCount=(state:ReturnType<typeof getPresentationState>,lineId:string)=>state.lineStatistics.find(item=>item.lineId===lineId)?.stationCount??0

describe('same-day transfer relation reveal timing',()=>{
  it('keeps 紫明 ordinary until line 6 actually arrives, then reveals only that relation',()=>{
    const project=sameDayProject(),sequence=compilePresentation(project),line6=sequence.beats.find(beat=>beat.lineId==='line-6')!,arrival=arrivalTime(line6)
    const before=getPresentationState(project,sequence,arrival-1/60),at=getPresentationState(project,sequence,arrival),after=getPresentationState(project,sequence,arrival+PRESENTATION_ANIMATION.transferMorphDuration+.01)
    expect(before.stationStates['紫明'].lineIds).toEqual(['line-4']);expect(before.stationStates['紫明'].visibleRelationIds).toEqual(['relation-line-4-紫明'])
    expect(at.stationStates['紫明'].previousLineIds).toEqual(['line-4']);expect(at.stationStates['紫明'].lineIds).toEqual(['line-4','line-6']);expect(at.stationStates['紫明'].visibleRelationIds).toEqual(['relation-line-4-紫明','relation-line-6-紫明']);expect(at.stationStates['紫明'].transferProgress).toBe(0)
    expect(after.stationStates['紫明'].lineIds).toEqual(['line-4','line-6']);expect(after.stationStates['紫明'].transferProgress).toBe(1)
  })

  it('reveals three same-day relations in stable presentation order instead of activating the final date state',()=>{
    const project=sameDayProject(),sequence=compilePresentation(project),line6=sequence.beats.find(beat=>beat.lineId==='line-6')!,line8=sequence.beats.find(beat=>beat.lineId==='line-8')!
    expect(getPresentationState(project,sequence,arrivalTime(line6)-.001).stationStates['紫明'].lineIds).toEqual(['line-4'])
    expect(getPresentationState(project,sequence,arrivalTime(line6)+.001).stationStates['紫明'].lineIds).toEqual(['line-4','line-6'])
    expect(getPresentationState(project,sequence,arrivalTime(line8)-.001).stationStates['紫明'].lineIds).toEqual(['line-4','line-6'])
    expect(getPresentationState(project,sequence,arrivalTime(line8)+.001).stationStates['紫明'].lineIds).toEqual(['line-4','line-6','line-8'])
    expect(getActiveLinesAtStation(project,'紫明',DATE).map(line=>line.id)).toEqual(['line-4','line-6','line-8'])
  })

  it('updates per-line station counts at arrival without recounting the shared physical Station',()=>{
    const project=sameDayProject(),sequence=compilePresentation(project),line6=sequence.beats.find(beat=>beat.lineId==='line-6')!,arrival=arrivalTime(line6),before=getPresentationState(project,sequence,arrival-.001),after=getPresentationState(project,sequence,arrival+.001)
    expect(after.statistics.stationCount).toBe(before.statistics.stationCount)
    expect(lineCount(after,'line-6')).toBe(lineCount(before,'line-6')+1)
    expect(lineCount(after,'line-4')).toBe(lineCount(before,'line-4'))
  })

  it('keeps orientation tie-breaking stable and evaluates identical scrub times deterministically',()=>{
    const project=sameDayProject();project.stations.find(item=>item.id==='紫明')!.orientationAnchorLineId='line-4';const sequence=compilePresentation(project),line6=sequence.beats.find(beat=>beat.lineId==='line-6')!,time=arrivalTime(line6)+.12
    expect(getOrientationAnchorLine(project,'紫明',DATE)?.id).toBe('line-4')
    expect(getPresentationState(project,sequence,time)).toEqual(getPresentationState(project,sequence,time))
  })

  it('feeds the same visible relation state to preview, scrub and video-sized PresentationScene renders',()=>{
    const project=sameDayProject(),sequence=compilePresentation(project),line6=sequence.beats.find(beat=>beat.lineId==='line-6')!,time=arrivalTime(line6)-1/60
    const preview=render(<PresentationScene project={project} sequence={sequence} time={time} width={1200} height={800}/>),video=render(<PresentationScene project={project} sequence={sequence} time={time} width={1920} height={1080}/>)
    expect(preview.container.querySelector('[data-station-id="紫明"]')).toHaveAttribute('data-visible-relation-ids','relation-line-4-紫明')
    expect(video.container.querySelector('[data-station-id="紫明"]')).toHaveAttribute('data-visible-relation-ids','relation-line-4-紫明')
    expect(preview.container.querySelector('[data-testid="station-紫明"]')).toBeTruthy();expect(preview.container.querySelector('[data-testid="transfer-紫明"]')).toBeNull()
  })

  it('gates the real 木阳 紫明 relations independently when lines 4 and 6 open on the same day',()=>{
    const project=convertAarcToActualRouteProject(rawMuyang,'木阳.aarc.json').project
    const priorDate='2020-01-01',sameDate='2026-06-28',line4=project.lines.find(line=>line.name==='4')!,line6=project.lines.find(line=>line.name==='6')!,ziming=project.stations.find(station=>station.source?.pointId===68)!
    for(const line of project.lines)line.openedAt=line.id===line4.id||line.id===line6.id?sameDate:priorDate
    for(const relation of project.stationLineRelations)relation.openedAt=relation.lineId===line4.id||relation.lineId===line6.id?sameDate:priorDate
    for(const segment of project.geometry.segments)segment.openedAt=segment.lineId===line4.id||segment.lineId===line6.id?sameDate:priorDate
    project.timeline={...project.timeline,startDate:priorDate,endDate:sameDate,currentDate:priorDate}
    project.presentation={...project.presentation,startDate:priorDate,endDate:sameDate}
    const sequence=compilePresentation(project),line6Beat=sequence.beats.find(beat=>beat.lineId===line6.id&&beat.stationIds.includes(ziming.id))!,arrival=arrivalTimeForStation(line6Beat,ziming.id)
    const before=getPresentationState(project,sequence,arrival-1/60),at=getPresentationState(project,sequence,arrival),after=getPresentationState(project,sequence,arrival+PRESENTATION_ANIMATION.transferMorphDuration+.01)
    const relation4=project.stationLineRelations.find(relation=>relation.stationId===ziming.id&&relation.lineId===line4.id)!,relation6=project.stationLineRelations.find(relation=>relation.stationId===ziming.id&&relation.lineId===line6.id)!
    expect(before.stationStates[ziming.id].lineIds).toEqual([line4.id]);expect(before.stationStates[ziming.id].visibleRelationIds).toEqual([relation4.id])
    expect(at.stationStates[ziming.id].lineIds).toEqual([line4.id,line6.id]);expect(at.stationStates[ziming.id].visibleRelationIds).toEqual([relation4.id,relation6.id]);expect(at.stationStates[ziming.id].transferProgress).toBe(0)
    expect(after.stationStates[ziming.id].lineIds).toEqual([line4.id,line6.id]);expect(after.stationStates[ziming.id].transferProgress).toBe(1)
    expect(at.statistics.stationCount).toBe(before.statistics.stationCount);expect(lineCount(at,line6.id)).toBe(lineCount(before,line6.id)+1)
  })
})

function arrivalTimeForStation(beat:ReturnType<typeof compilePresentation>['beats'][number],stationId:string){return beat.revealStart+inverseLineEasing(getStationArrivalRatio(beat,stationId))*beat.revealDuration}
