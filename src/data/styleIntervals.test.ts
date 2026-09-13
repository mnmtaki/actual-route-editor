import { describe, expect, it } from 'vitest'
import type { ActualRouteProject, Segment } from './model'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS } from './model'
import { addStructureNodeAtProgress, deleteStylePoint, getSegmentStyleIntervals, updateStyleIntervalAtProgress } from './structure'
import { insertStationIntoSegment } from './operations'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'

function project(): ActualRouteProject {
  const segment: Segment = { id:'AB', lineId:'L', fromStationId:'A', toStationId:'B', mode:'straight', structureType:'underground', waypoints:[], structureNodes:[], openedAt:'2020-01-01' }
  return {
    version:1,name:'style-intervals',
    stations:[{id:'A',name:'A',x:0,y:0,labelOffsetX:10,labelOffsetY:-10},{id:'B',name:'B',x:300,y:0,labelOffsetX:10,labelOffsetY:-10}],
    lines:[{id:'L',name:'L',color:'#2879d0',lineOrder:0,stationSequence:['A','B'],openedAt:'2020-01-01',visible:true,locked:false}],
    stationLineRelations:[{id:'rA',stationId:'A',lineId:'L',openedAt:'2020-01-01'},{id:'rB',stationId:'B',lineId:'L',openedAt:'2020-01-01'}],openingPhases:[],geometry:{segments:[segment]},background:null,
    timeline:{currentDate:'2020-01-01',startDate:'2020-01-01',endDate:'2020-01-01',playing:false},presentation:{...DEFAULT_PRESENTATION_SETTINGS,startDate:'2020-01-01',endDate:'2020-01-01'},settings:{...DEFAULT_SETTINGS},
    styles:[{id:'custom',name:'Custom',layers:[{id:'layer',colorMode:'followLine',width:1,widthMode:'ratio'}]}]
  }
}

describe('style intervals',()=>{
  it('adds a style point without changing either side appearance',()=>{
    const before=project(),segment=before.geometry.segments[0]
    segment.structureNodes=[{id:'rise',progress:.2,structureAfter:'elevated',styleAfter:{lineStyleId:null}}]
    const result=addStructureNodeAtProgress(before,segment.id,.6,'elevated'),next=result.project.geometry.segments[0]
    expect(getSegmentStyleIntervals(result.project,next)).toEqual([
      {start:0,end:.2,structureType:'underground',lineStyleId:undefined},
      {start:.2,end:.6,structureType:'elevated',lineStyleId:null,startNodeId:'rise'},
      {start:.6,end:1,structureType:'elevated',lineStyleId:null,startNodeId:result.nodeId!},
    ])
  })

  it('edits only the selected interval after a style point',()=>{
    const before=project(),added=addStructureNodeAtProgress(before,'AB',.4,'underground'),nodeId=added.nodeId!
    const changed=updateStyleIntervalAtProgress(added.project,'AB',.7,{structureType:'elevated',lineStyleId:'custom'})
    expect(getSegmentStyleIntervals(changed,changed.geometry.segments[0])).toEqual([
      {start:0,end:.4,structureType:'underground',lineStyleId:undefined},
      {start:.4,end:1,structureType:'elevated',lineStyleId:'custom',startNodeId:nodeId},
    ])
  })

  it('lets deletion keep either adjacent interval style',()=>{
    const before=project(),added=addStructureNodeAtProgress(before,'AB',.4,'underground'),nodeId=added.nodeId!
    const changed=updateStyleIntervalAtProgress(added.project,'AB',.7,{structureType:'elevated',lineStyleId:'custom'})
    const keepBefore=deleteStylePoint(changed,'AB',nodeId,'before')
    expect(getSegmentStyleIntervals(keepBefore,keepBefore.geometry.segments[0])).toEqual([{start:0,end:1,structureType:'underground',lineStyleId:undefined}])
    const keepAfter=deleteStylePoint(changed,'AB',nodeId,'after')
    expect(getSegmentStyleIntervals(keepAfter,keepAfter.geometry.segments[0])).toEqual([{start:0,end:1,structureType:'elevated',lineStyleId:'custom'}])
  })

  it('round-trips style-point line-style state through project JSON',()=>{
    const before=project(),added=addStructureNodeAtProgress(before,'AB',.4,'underground')
    const changed=updateStyleIntervalAtProgress(added.project,'AB',.7,{structureType:'elevated',lineStyleId:'custom'})
    const restored=parseProjectJson(serializeProject(changed)),node=restored.geometry.segments[0].structureNodes?.[0]
    expect(node?.styleAfter).toEqual({lineStyleId:'custom'})
    expect(getSegmentStyleIntervals(restored,restored.geometry.segments[0])[1]).toMatchObject({structureType:'elevated',lineStyleId:'custom'})
  })

  it('keeps the active interval style when a station is inserted',()=>{
    const before=project(),added=addStructureNodeAtProgress(before,'AB',.35,'underground')
    const changed=updateStyleIntervalAtProgress(added.project,'AB',.7,{structureType:'elevated',lineStyleId:'custom'})
    const result=insertStationIntoSegment(changed,'AB',{x:210,y:0})
    expect(result.stationId).toBeTruthy()
    const first=result.project.geometry.segments.find(item=>item.toStationId===result.stationId)!,second=result.project.geometry.segments.find(item=>item.fromStationId===result.stationId)!
    expect(first.structureType).toBe('underground')
    expect(first.lineStyleId).toBeUndefined()
    expect(second.structureType).toBe('elevated')
    expect(second.lineStyleId).toBe('custom')
  })
})
