import { createElement } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { DEFAULT_PRESENTATION_SETTINGS } from '../data/model'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { exportSvg } from '../import-export/svgExport'
import { MapElementsLayer } from '../renderer/MapElements'
import { LineBadgesLayer } from '../renderer/LineBadges'
import { DEFAULT_LINE_LEGEND } from '../data/lineLegend'
import { compilePresentation } from './compiler'
import { getPresentationState } from './engine'
import { PresentationScene } from './PresentationScene'

function phasedProject() {
  const project = structuredClone(demoProject)
  project.openingPhases = [
    { id:'p1',lineId:'line-a',name:'一期',openedAt:'2000-01-01',segmentIds:['a-1','a-2','a-3'],stationRelationIds:project.stationLineRelations.filter(item=>item.lineId==='line-a').map(item=>item.id) },
    { id:'p2',lineId:'line-b',name:'二期',openedAt:'2010-01-01',segmentIds:['b-1','b-2'],stationRelationIds:project.stationLineRelations.filter(item=>item.lineId==='line-b').map(item=>item.id) },
    { id:'p3',lineId:'line-c',name:'三期',openedAt:'2020-01-01',segmentIds:['c-1','c-2'],stationRelationIds:project.stationLineRelations.filter(item=>item.lineId==='line-c').map(item=>item.id) },
  ]
  project.presentation = { ...DEFAULT_PRESENTATION_SETTINGS, startDate:'2000-01-01', endDate:'2020-01-01', cameraMode:'follow', cameraViewWidth:640, overviewAfterEachPhase:true, overviewHoldDuration:1.25, pauseDuration:.2 }
  return project
}

describe('presentation view width and global overviews', () => {
  it('keeps user cameraViewWidth fixed while center follows the reveal front', () => {
    const project=phasedProject(),sequence=compilePresentation(project,project.presentation,1.5),beat=sequence.beats[0]
    const states=Array.from({length:80},(_,index)=>getPresentationState(project,sequence,beat.revealStart+beat.revealDuration*index/79))
    expect(new Set(states.map(state=>state.camera.width))).toEqual(new Set([640]))
    expect(states.at(-1)!.camera.x).not.toBe(states[0].camera.x)
  })

  it('adds an overview after every OpeningPhase only when the global switch is enabled', () => {
    const project=phasedProject(),enabled=compilePresentation(project)
    expect(enabled.beats).toHaveLength(3); expect(enabled.beats.every(beat=>beat.overviewAfter)).toBe(true)
    for(const beat of enabled.beats) expect(beat.overviewEnd-beat.overviewStart).toBeCloseTo(2*.8+1.25,8)
    project.presentation.overviewAfterEachPhase=false
    expect(compilePresentation(project).beats.every(beat=>!beat.overviewAfter)).toBe(true)
  })

  it('fits only the historically opened network, holds, then deterministically returns to cameraViewWidth', () => {
    const project=phasedProject(); project.stations.find(item=>item.id==='s8')!.x=5000
    const sequence=compilePresentation(project),beat=sequence.beats[0],track=sequence.cameraTracks[0]
    expect(track.overviewCamera).toBeTruthy(); expect(track.overviewCamera!.x+track.overviewCamera!.width).toBeLessThan(3000)
    const holdTime=beat.overviewStart+beat.overviewEnterDuration+beat.overviewHoldDuration/2
    expect(getPresentationState(project,sequence,holdTime).camera).toEqual(track.overviewCamera)
    const returned=getPresentationState(project,sequence,beat.overviewEnd-.000001).camera
    expect(returned.width).toBeCloseTo(640,4)
    expect(getPresentationState(project,sequence,holdTime).camera).toEqual(getPresentationState(project,sequence,holdTime).camera)
  })

  it('keeps center and view width identical across preview and video aspects', () => {
    const project=phasedProject(),preview=compilePresentation(project,project.presentation,1.2),video=compilePresentation(project,project.presentation,16/9)
    const time=preview.beats[0].revealStart+preview.beats[0].revealDuration*.45,a=getPresentationState(project,preview,time).camera,b=getPresentationState(project,video,time).camera
    expect(a.width).toBe(640);expect(b.width).toBe(640)
    expect(a.x+a.width/2).toBeCloseTo(b.x+b.width/2,8);expect(a.y+a.height/2).toBeCloseTo(b.y+b.height/2,8)
  })
})

describe('world-space line badges and map elements', () => {
  it('renders a Line-owned badge and multiline text with shared artwork and exports them to SVG', () => {
    const project=structuredClone(demoProject)
    project.lines.find(line=>line.id==='line-a')!.lineBadges=[{id:'badge',x:250,y:200,size:40,rotation:12,visible:true}]
    project.mapElements=[{id:'text',type:'text',x:400,y:220,text:'第一行\n第二行',fontSize:26,fontWeight:'bold',textAlign:'middle',rotation:-5,visible:true}]
    const {container}=render(createElement('svg',null,createElement(LineBadgesLayer,{project}),createElement(MapElementsLayer,{project})))
    expect(container.querySelector('[data-line-badge-id="badge"] rect')?.getAttribute('fill')).toBe(project.lines.find(line=>line.id==='line-a')!.color)
    expect(container.querySelectorAll('[data-map-element-id="text"] tspan')).toHaveLength(2)
    const svg=exportSvg(container.querySelector('svg')!,true)
    expect(svg).toContain('第一行');expect(svg).toContain('第二行');expect(svg).toContain(project.lines.find(line=>line.id==='line-a')!.color)
    expect(svg).not.toContain('data-editor')
  })

  it('round-trips Line-owned badges and text map elements', () => {
    const project=structuredClone(demoProject);project.lines.find(line=>line.id==='line-b')!.lineBadges=[{id:'badge',x:1,y:2,size:33,rotation:4,visible:true}];project.mapElements=[{id:'text',type:'text',x:3,y:4,text:'说明',fontSize:18,fontWeight:'normal',textAlign:'end',rotation:0,visible:true}]
    const restored=parseProjectJson(serializeProject(project))
    expect(restored.lines.find(line=>line.id==='line-b')!.lineBadges).toEqual(project.lines.find(line=>line.id==='line-b')!.lineBadges)
    expect(restored.mapElements).toEqual(project.mapElements)
    const raw=JSON.parse(serializeProject(project));delete raw.mapElements
    expect(parseProjectJson(JSON.stringify(raw)).mapElements).toEqual([])
  })

  it('migrates legacy mapElement lineBadge once without changing its line or coordinates',()=>{
    const raw=JSON.parse(serializeProject(structuredClone(demoProject)))
    raw.mapElements=[{id:'legacy-badge',type:'lineBadge',lineId:'line-a',x:123.5,y:456.25,size:42,rotation:7,visible:true},{id:'text',type:'text',x:5,y:6,text:'保留',fontSize:18,fontWeight:'normal',textAlign:'middle',rotation:0,visible:true}]
    const migrated=parseProjectJson(JSON.stringify(raw)),badge=migrated.lines.find(line=>line.id==='line-a')!.lineBadges!.find(item=>item.id==='legacy-badge')!
    expect(badge).toMatchObject({x:123.5,y:456.25,size:42,rotation:7,visible:true})
    expect(migrated.mapElements).toEqual([expect.objectContaining({id:'text',type:'text'})])
    const saved=JSON.parse(serializeProject(migrated));expect(saved.mapElements).toHaveLength(1);expect(saved.lines.find((line:{id:string})=>line.id==='line-a').lineBadges.filter((item:{id:string})=>item.id==='legacy-badge')).toHaveLength(1)
  })

  it('uses the same map element layer in the presentation scene', () => {
    const project=phasedProject();project.lines.find(line=>line.id==='line-a')!.lineBadges=[{id:'badge',x:250,y:200,size:40,rotation:0,visible:true}];project.mapElements=[{id:'text',type:'text',x:300,y:250,text:'说明',fontSize:24,fontWeight:'normal',textAlign:'start',rotation:0,visible:true}]
    const sequence=compilePresentation(project),time=sequence.beats[0].revealEnd
    const {container}=render(<PresentationScene project={project} sequence={sequence} time={time} width={1200} height={800}/>)
    expect(container.querySelectorAll('[data-layer="line-badges"] [data-line-badge-id]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-layer="map-elements"] [data-map-element-id]')).toHaveLength(1)
  })

  it('renders the built-in line legend from final project data at every presentation time',()=>{
    const project=phasedProject();project.lineLegend={id:'legend',x:12,y:18,...DEFAULT_LINE_LEGEND}
    const sequence=compilePresentation(project),early=render(<PresentationScene project={project} sequence={sequence} time={0} width={1200} height={800}/>),late=render(<PresentationScene project={project} sequence={sequence} time={sequence.duration} width={1200} height={800}/>)
    expect(early.container.querySelector('[data-layer="line-legend"]')).toBeTruthy()
    expect(late.container.querySelector('[data-layer="line-legend"]')).toBeTruthy()
    expect(early.container.querySelectorAll('[data-layer="line-legend"] .line-legend-item')).toHaveLength(project.lines.length)
  })

  it('keeps every badge synchronized with its owning Line name and color',()=>{
    const project=structuredClone(demoProject),line=project.lines.find(item=>item.id==='line-a')!;line.lineBadges=[{id:'a',x:1,y:2,size:40,rotation:0,visible:true},{id:'b',x:3,y:4,size:40,rotation:0,visible:true}]
    line.name='四号线';line.color='#123456'
    const {container}=render(<svg><LineBadgesLayer project={project}/></svg>)
    expect([...container.querySelectorAll('[data-line-badge-id] text')].map(item=>item.textContent)).toEqual(['四号线','四号线'])
    expect([...container.querySelectorAll('[data-line-badge-id] rect:first-child')].map(item=>item.getAttribute('fill'))).toEqual(['#123456','#123456'])
  })
})
