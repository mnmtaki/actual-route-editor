import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ActualRouteProject, Segment } from '../data/model'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS } from '../data/model'
import { addStructureNodeAtProgress, compileElevatedRuns, getSegmentStructureIntervals, moveIndependentStructureNode, resolveStructureNodeProgress, setWaypointStructureAfter } from '../data/structure'
import { getSegmentPath, sampleSegmentAtLengthRatio } from '../geometry/path'
import { insertStationIntoSegment } from '../data/operations'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { compilePresentation } from '../presentation/compiler'
import { getPresentationState } from '../presentation/engine'
import { StructureRunArtwork } from './segmentStyles'

function baseProject(): ActualRouteProject {
  const ids=['A','B','C','D']
  return {
    version:1,name:'structure-runs',
    stations:ids.map((id,index)=>({id,name:id,x:index*300,y:0,labelOffsetX:10,labelOffsetY:-10})),
    lines:[{id:'L',name:'L',color:'#2879d0',lineOrder:0,stationSequence:ids,openedAt:'2020-01-01',visible:true,locked:false}],
    stationLineRelations:ids.map(id=>({id:`r-${id}`,stationId:id,lineId:'L',openedAt:'2020-01-01'})), openingPhases:[],
    geometry:{segments:[segment('AB','A','B'),segment('BC','B','C'),segment('CD','C','D')]}, background:null,
    timeline:{currentDate:'2020-01-01',startDate:'2020-01-01',endDate:'2020-01-01',playing:false},
    presentation:{...DEFAULT_PRESENTATION_SETTINGS,startDate:'2020-01-01',endDate:'2020-01-01',growthSpeedKmPerSecond:1,pauseDuration:0,cameraMode:'fixed'}, settings:{...DEFAULT_SETTINGS,worldUnitsPerKm:100}
  }
}
const segment=(id:string,fromStationId:string,toStationId:string):Segment=>({id,lineId:'L',fromStationId,toStationId,mode:'straight',structureType:'underground',structureNodes:[],waypoints:[],openedAt:'2020-01-01'})

describe('Structure Nodes and continuous Elevated Runs',()=>{
  it('splits one Segment into underground/elevated/underground intervals at 35 and 80 percent',()=>{
    const project=baseProject(),segment=project.geometry.segments[0]
    segment.structureNodes=[{id:'n1',progress:.35,structureAfter:'elevated'},{id:'n2',progress:.8,structureAfter:'underground'}]
    expect(getSegmentStructureIntervals(project,segment)).toEqual([
      {start:0,end:.35,structureType:'underground'}, {start:.35,end:.8,structureType:'elevated'}, {start:.8,end:1,structureType:'underground'}
    ])
  })

  it('keeps a waypoint-attached structure change on the moved waypoint',()=>{
    const project=baseProject(),segment=project.geometry.segments[0]
    segment.waypoints=[{id:'w',x:60,y:0,type:'smooth'}]; segment.mode='smooth'
    const linked=setWaypointStructureAfter(project,segment.id,'w','elevated'),linkedSegment=linked.geometry.segments[0],node=linkedSegment.structureNodes![0]
    const before=resolveStructureNodeProgress(linked,linkedSegment,node)
    linkedSegment.waypoints[0].x=240
    const after=resolveStructureNodeProgress(linked,linkedSegment,node)
    expect(node.waypointId).toBe('w'); expect(after).toBeGreaterThan(before+.3)
  })

  it('adds an independent structure node without changing Geometry',()=>{
    const project=baseProject(),segment=project.geometry.segments[0],beforePath=getSegmentPath(project,segment),beforeWaypoints=structuredClone(segment.waypoints)
    const result=addStructureNodeAtProgress(project,segment.id,.42,'elevated')
    expect(getSegmentPath(result.project,result.project.geometry.segments[0])).toBe(beforePath)
    expect(result.project.geometry.segments[0].waypoints).toEqual(beforeWaypoints)
    expect(result.project.geometry.segments[0].structureNodes?.[0].progress).toBe(.42)
  })

  it('reuses the exact ordinary Bézier path for a whole elevated Segment',()=>{
    const project=baseProject(),segment=project.geometry.segments[0]
    segment.mode='smooth'; segment.waypoints=[{id:'curve',x:145,y:130,type:'smooth'}]; segment.structureType='elevated'
    const ordinaryPath=getSegmentPath(project,segment),run=compileElevatedRuns(project)[0]
    expect(ordinaryPath).toContain(' C '); expect(run.path).toBe(ordinaryPath); expect(run.path).not.toContain(' L ')
  })

  it('keeps partial elevated boundaries as exact cubic subdivisions instead of sampled L segments',()=>{
    const project=baseProject(),segment=project.geometry.segments[0]
    segment.mode='smooth'; segment.waypoints=[{id:'curve',x:145,y:130,type:'smooth'}]
    segment.structureNodes=[{id:'rise',progress:.25,structureAfter:'elevated'},{id:'fall',progress:.78,structureAfter:'underground'}]
    const run=compileElevatedRuns(project)[0]
    expect(run.path).toContain(' C '); expect(run.path).not.toContain(' L ')
    expect((run.path.match(/ C /g)??[]).length).toBeGreaterThanOrEqual(1)
  })
  it('merges partial/full/partial elevated pieces across two internal stations into one run',()=>{
    const project=baseProject(),[ab,bc,cd]=project.geometry.segments
    ab.structureNodes=[{id:'ab-up',progress:.5,structureAfter:'elevated'}]
    bc.structureType='elevated'
    cd.structureType='elevated'; cd.structureNodes=[{id:'cd-down',progress:.5,structureAfter:'underground'}]
    const runs=compileElevatedRuns(project)
    expect(runs).toHaveLength(1); expect(runs[0].segmentIds).toEqual(['AB','BC','CD'])
    expect(runs[0].path.match(/M /g)).toHaveLength(1)
  })

  it('renders only true Elevated Run endpoints with butt caps and three identical paths',()=>{
    const project=baseProject(),[ab,bc,cd]=project.geometry.segments
    ab.structureNodes=[{id:'ab-up',progress:.5,structureAfter:'elevated'}]; bc.structureType='elevated'; cd.structureType='elevated'; cd.structureNodes=[{id:'cd-down',progress:.5,structureAfter:'underground'}]
    const run=compileElevatedRuns(project)[0],line=project.lines[0]
    const {container}=render(<svg><StructureRunArtwork run={run} line={line} lineWidth={18}/></svg>)
    const paths=[...container.querySelectorAll('path')]
    expect(paths).toHaveLength(3); expect(new Set(paths.map(path=>path.getAttribute('d'))).size).toBe(1)
    expect(paths.every(path=>path.getAttribute('stroke-linecap')==='butt')).toBe(true)
  })

  it('reveals all three Elevated Run layers from the same partial structure path',()=>{
    const project=baseProject(); project.geometry.segments[0].structureType='elevated'
    const sequence=compilePresentation(project),beat=sequence.beats[0],time=beat.revealStart+beat.revealDuration*.2,state=getPresentationState(project,sequence,time)
    const visibility=Object.fromEntries(Object.entries(state.segmentStates).map(([id,value])=>[id,{revealProgress:value.revealProgress,revealFrom:value.revealFrom,opacity:value.opacity}]))
    const runs=compileElevatedRuns(project,new Set(beat.segmentIds),visibility)
    expect(runs).toHaveLength(1); expect(runs[0].points.at(-1)!.x).toBeLessThan(project.stations.find(item=>item.id==='B')!.x)
    const {container}=render(<svg><StructureRunArtwork run={runs[0]} line={project.lines[0]} lineWidth={18}/></svg>)
    expect(new Set([...container.querySelectorAll('[data-run-centerline]')].map(path=>path.getAttribute('d'))).size).toBe(1)
  })

  it('loads legacy whole-Segment structureType without structureNodes',()=>{
    const project=baseProject(); project.geometry.segments=[{...project.geometry.segments[0],structureType:'elevated'}]; delete project.geometry.segments[0].structureNodes
    const restored=parseProjectJson(serializeProject(project)),segment=restored.geometry.segments[0]
    expect(segment.structureType).toBe('elevated'); expect(segment.structureNodes).toEqual([]); expect(compileElevatedRuns(restored)).toHaveLength(1)
  })

  it('splits structure nodes consistently when inserting a Station',()=>{
    const project=baseProject(); project.geometry.segments=[project.geometry.segments[0]]; project.lines[0].stationSequence=['A','B']; project.stations=project.stations.slice(0,2); project.stationLineRelations=project.stationLineRelations.slice(0,2)
    project.geometry.segments[0].structureNodes=[{id:'up',progress:.25,structureAfter:'elevated'},{id:'down',progress:.75,structureAfter:'underground'}]
    const result=insertStationIntoSegment(project,'AB',{x:150,y:0}),[first,second]=result.project.geometry.segments
    expect(first.structureType).toBe('underground'); expect(first.structureNodes?.map(node=>[node.progress,node.structureAfter])).toEqual([[.5,'elevated']])
    expect(second.structureType).toBe('elevated'); expect(second.structureNodes?.map(node=>[node.progress,node.structureAfter])).toEqual([[.5,'underground']])
  })

  it('drags an independent Structure Node along a curved path without changing Geometry',()=>{
    const project=baseProject(),segment=project.geometry.segments[0]
    segment.mode='smooth'; segment.waypoints=[{id:'curve',x:140,y:120,type:'smooth'}]; segment.structureNodes=[{id:'independent',progress:.25,structureAfter:'elevated'}]
    const pathBefore=getSegmentPath(project,segment),target=sampleSegmentAtLengthRatio(project,segment,.72)!.point
    const moved=moveIndependentStructureNode(project,segment.id,'independent',target),movedSegment=moved.geometry.segments[0]
    expect(movedSegment.structureNodes?.[0].progress).toBeCloseTo(.72,1)
    expect(getSegmentPath(moved,movedSegment)).toBe(pathBefore)
    expect(compileElevatedRuns(moved)[0].path).toContain(' C ')
  })

  it('does not detach a waypoint-attached Structure Node when direct node drag is attempted',()=>{
    const project=baseProject(),segment=project.geometry.segments[0]
    segment.mode='smooth'; segment.waypoints=[{id:'curve',x:140,y:120,type:'smooth'}]; segment.structureNodes=[{id:'attached',waypointId:'curve',structureAfter:'elevated'}]
    const moved=moveIndependentStructureNode(project,segment.id,'attached',{x:260,y:-100})
    expect(moved).toBe(project); expect(moved.geometry.segments[0].structureNodes?.[0].waypointId).toBe('curve')
  })

  it('uses clean transition cuts but wrapped caps only at true line terminals',()=>{
    const transitionProject=baseProject(),transitionSegment=transitionProject.geometry.segments[1]
    transitionSegment.structureNodes=[{id:'up',progress:.2,structureAfter:'elevated'},{id:'down',progress:.8,structureAfter:'underground'}]
    const transitionRun=compileElevatedRuns(transitionProject)[0]
    const transitionDom=render(<svg><StructureRunArtwork run={transitionRun} line={transitionProject.lines[0]} lineWidth={18}/></svg>).container
    expect(transitionRun.startBoundary).toBe('structure-transition'); expect(transitionRun.endBoundary).toBe('structure-transition')
    expect(transitionDom.querySelectorAll('[data-terminal-cap]')).toHaveLength(0)

    const terminalProject=baseProject(); terminalProject.geometry.segments.forEach(item=>{item.structureType='elevated'})
    const terminalRun=compileElevatedRuns(terminalProject)[0]
    const terminalDom=render(<svg><StructureRunArtwork run={terminalRun} line={terminalProject.lines[0]} lineWidth={18}/></svg>).container
    expect(terminalRun.startBoundary).toBe('line-terminal'); expect(terminalRun.endBoundary).toBe('line-terminal')
    expect(terminalDom.querySelectorAll('[data-terminal-cap="start"]')).toHaveLength(3)
    expect(terminalDom.querySelectorAll('[data-terminal-cap="end"]')).toHaveLength(3)
    expect(terminalDom.querySelectorAll('[data-run-centerline]')).toHaveLength(3)
  })

  it('keeps a continuous run across Stations with no internal cap or gap',()=>{
    const project=baseProject(); project.geometry.segments.forEach(item=>{item.structureType='elevated'})
    const run=compileElevatedRuns(project)[0],dom=render(<svg><StructureRunArtwork run={run} line={project.lines[0]} lineWidth={18}/></svg>).container
    expect(run.segmentIds).toEqual(['AB','BC','CD']); expect(run.path.match(/M /g)).toHaveLength(1)
    expect(dom.querySelectorAll('[data-terminal-cap]')).toHaveLength(6)
  })

  it('orients a terminal cap from the exact diagonal/curved final tangent without changing the Bézier centerline',()=>{
    const project=baseProject(),segment=project.geometry.segments[2]
    project.stations.find(item=>item.id==='D')!.y=180; segment.mode='smooth'; segment.waypoints=[{id:'final-curve',x:780,y:40,type:'smooth'}]
    project.geometry.segments.forEach(item=>{item.structureType='elevated'})
    const run=compileElevatedRuns(project)[0],ordinaryFinal=getSegmentPath(project,segment)
    const dom=render(<svg><StructureRunArtwork run={run} line={project.lines[0]} lineWidth={18}/></svg>).container
    expect(run.path).toContain(' C '); expect(run.path).toContain(ordinaryFinal.slice(ordinaryFinal.indexOf(' C ')))
    const transform=dom.querySelector('[data-terminal-cap="end"]')?.getAttribute('transform') ?? ''
    expect(transform).toContain('rotate('); expect(transform).not.toContain('rotate(0)')
    expect(new Set([...dom.querySelectorAll('[data-run-centerline]')].map(path=>path.getAttribute('d'))).size).toBe(1)
  })})