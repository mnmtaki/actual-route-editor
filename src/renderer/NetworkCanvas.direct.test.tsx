import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { getSegmentPath } from '../geometry/path'
import { NetworkCanvas } from './NetworkCanvas'

beforeAll(() => {
  class TestPointerEvent extends MouseEvent { pointerId: number; constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } }
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: TestPointerEvent })
  Object.defineProperty(SVGElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } })
})

const baseProps = { selection: null, drawing: null, onSelect: vi.fn(), onCreatePoint: vi.fn(), onConnectStation: vi.fn(), onExtend: vi.fn(), onSegmentPoint: vi.fn(), onPreview: vi.fn(), onDragCommit: vi.fn(), view: { x: 0, y: 0, width: 920, height: 680 }, setView: vi.fn() }

describe('direct manipulation gestures', () => {
  it('shows lightweight selectable handles for the actual corners of a selected rounded Segment',()=>{
    const project=structuredClone(demoProject),segment=project.geometry.segments.find(item=>item.id==='a-1')!,onSelect=vi.fn()
    segment.mode='rounded';segment.waypoints=[{id:'corner-a',x:270,y:350,type:'corner',cornerRadius:20},{id:'corner-b',x:330,y:420,type:'corner',cornerRadius:70}]
    const {container}=render(<NetworkCanvas {...baseProps} project={project} selection={{type:'segment',id:segment.id}} onSelect={onSelect}/>)
    const handles=[...container.querySelectorAll('[data-corner-handle="true"]')]
    expect(handles.map(handle=>handle.getAttribute('data-waypoint-id'))).toEqual(['corner-a','corner-b'])
    fireEvent.pointerDown(handles[0],{pointerId:13,clientX:270,clientY:350,bubbles:true})
    expect(onSelect).toHaveBeenCalledWith({type:'waypoint',id:'corner-a',segmentId:segment.id})
  })
  it('renders every existing line with the global width and ignores legacy line overrides',()=>{
    const project=structuredClone(demoProject);project.settings.lineWidth=30;project.lines.forEach((line,index)=>{line.lineWidth=8+index})
    const {container}=render(<NetworkCanvas {...baseProps} project={project}/>)
    const widths=[...container.querySelectorAll('.segment-main')].map(path=>path.getAttribute('stroke-width'))
    expect(widths.length).toBeGreaterThan(1);expect(new Set(widths)).toEqual(new Set(['30']))
  })
  it('drags a station directly and commits the whole drag once', () => {
    const onPreview = vi.fn(), onDragCommit = vi.fn(), setView = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={demoProject} onPreview={onPreview} onDragCommit={onDragCommit} setView={setView} />)
    const svg = container.querySelector('svg')!
    Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 920 })
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const stationGroup = screen.getByTestId('transfer-s2').closest('.station-hit')!
    const original = demoProject.stations.find(station => station.id === 's2')!
    fireEvent.pointerDown(stationGroup, { pointerId: 7, clientX: original.x, clientY: original.y, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 7, clientX: original.x + 80, clientY: original.y + 35, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 7, clientX: original.x + 80, clientY: original.y + 35, bubbles: true })
    expect(onDragCommit).toHaveBeenCalledTimes(1)
    const moved = onDragCommit.mock.calls[0][1]
    const movedStation = moved.stations.find((station: { id: string }) => station.id === 's2')
    expect(movedStation.x).toBeCloseTo(original.x + 80)
    expect(movedStation.y).toBeCloseTo(original.y + 35)
    expect(getSegmentPath(moved, moved.geometry.segments.find((segment: { id: string }) => segment.id === 'a-1')!)).toContain(`${original.x + 80} ${original.y + 35}`)
  })

  it('pans from canvas background without starting an object drag', () => {
    const setView = vi.fn(), onDragCommit = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={demoProject} setView={setView} onDragCommit={onDragCommit} />)
    const svg = container.querySelector('svg')!
    Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 920 })
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const background = container.querySelector('.canvas-bg')!
    fireEvent.pointerDown(background, { pointerId: 8, clientX: 100, clientY: 100, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 8, clientX: 140, clientY: 120, bubbles: true })
    expect(setView).toHaveBeenCalledTimes(1)
    expect(onDragCommit).not.toHaveBeenCalled()
  })

  it('drags a rotated bilingual label by world delta without moving its Station',()=>{
    const project=structuredClone(demoProject),station=project.stations.find(item=>item.id==='s4')!;station.nameS='Linjiang';station.labelRotation=45
    const onDragCommit=vi.fn(),{container}=render(<NetworkCanvas {...baseProps} project={project} onDragCommit={onDragCommit}/>)
    const svg=container.querySelector('svg')!;Object.defineProperty(svg,'clientWidth',{configurable:true,value:920});vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:920,bottom:680,width:920,height:680,toJSON:()=>({})})
    const label=container.querySelector('[data-label-rotation="45"]')!;fireEvent.pointerDown(label,{pointerId:12,clientX:station.x+station.labelOffsetX,clientY:station.y+station.labelOffsetY,bubbles:true});fireEvent.pointerMove(svg,{pointerId:12,clientX:station.x+station.labelOffsetX+30,clientY:station.y+station.labelOffsetY+20,bubbles:true});fireEvent.pointerUp(svg,{pointerId:12,clientX:0,clientY:0,bubbles:true});const moved=onDragCommit.mock.calls[0][1].stations.find((item:{id:string})=>item.id==='s4');expect(moved.x).toBe(station.x);expect(moved.y).toBe(station.y);expect(moved.labelOffsetX).toBeCloseTo(station.labelOffsetX+30);expect(moved.labelOffsetY).toBeCloseTo(station.labelOffsetY+20);expect(moved.labelRotation).toBe(45)
  })
  it('drags an independent Structure Node along its Segment with pointer capture', () => {
    const project=structuredClone(demoProject),segment=project.geometry.segments.find(item=>item.id==='a-1')!
    segment.structureNodes=[{id:'drag-node',progress:.25,structureAfter:'elevated'}]
    const onDragCommit=vi.fn(),onPreview=vi.fn()
    const {container}=render(<NetworkCanvas {...baseProps} project={project} selection={{type:'structureNode',id:'drag-node',segmentId:segment.id}} onDragCommit={onDragCommit} onPreview={onPreview} />)
    const svg=container.querySelector('svg')!
    vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:920,bottom:680,width:920,height:680,toJSON:()=>({})})
    const node=container.querySelector('[data-structure-node-id="drag-node"]')!
    fireEvent.pointerDown(node,{pointerId:9,clientX:270,clientY:440,bubbles:true})
    fireEvent.pointerMove(svg,{pointerId:9,clientX:360,clientY:370,bubbles:true})
    fireEvent.pointerUp(svg,{pointerId:9,clientX:360,clientY:370,bubbles:true})
    expect(SVGElement.prototype.setPointerCapture).toHaveBeenCalledWith(9)
    expect(onDragCommit).toHaveBeenCalledTimes(1)
    const moved=onDragCommit.mock.calls[0][1],movedNode=moved.geometry.segments.find((item:{id:string})=>item.id===segment.id).structureNodes[0]
    expect(movedNode.progress).toBeGreaterThan(.25)
    expect(moved.geometry.segments.find((item:{id:string})=>item.id===segment.id).waypoints).toEqual(segment.waypoints)
  })})


