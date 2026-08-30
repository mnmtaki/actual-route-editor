import { fireEvent, render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { NetworkCanvas } from './NetworkCanvas'

beforeAll(() => {
  class TestPointerEvent extends MouseEvent { pointerId:number; constructor(type:string,init:MouseEventInit & {pointerId?:number}={}){super(type,init);this.pointerId=init.pointerId??1} }
  Object.defineProperty(window,'PointerEvent',{configurable:true,value:TestPointerEvent})
  Object.defineProperty(SVGElement.prototype,'setPointerCapture',{configurable:true,value:vi.fn()})
  Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:class{observe(){} disconnect(){}}})
})
const noop=vi.fn()
const base={project:demoProject,selection:null,onSelect:noop,onConnectStation:noop,onExtend:noop,onSegmentPoint:noop,onPreview:noop,onDragCommit:noop,setView:noop}
const bounds={x:100,y:50,left:100,top:50,right:1020,bottom:730,width:920,height:680,toJSON:()=>({})}
describe('station creation pointer coordinates',()=>{
  it.each([
    ['no zoom or pan',{x:0,y:0,width:920,height:680},400,250],
    ['2x zoom',{x:100,y:50,width:460,height:340},500,350],
    ['pan',{x:240,y:130,width:920,height:680},160,120],
    ['zoom and pan',{x:200,y:100,width:460,height:340},300,250],
  ])('creates at the exact pointer world point: %s',(_name,view,clientX,clientY)=>{ const onCreatePoint=vi.fn(); const {container}=render(<NetworkCanvas {...base} drawing={{lineId:'line-a',anchorStationId:'s4'}} onCreatePoint={onCreatePoint} view={view}/>); const svg=container.querySelector('svg')!; vi.spyOn(svg,'getBoundingClientRect').mockReturnValue(bounds); fireEvent.pointerDown(container.querySelector('.canvas-bg')!,{pointerId:4,clientX,clientY,bubbles:true}); expect(onCreatePoint).toHaveBeenCalledTimes(1); expect(onCreatePoint.mock.calls[0][0].x).toBeCloseTo(300,8); expect(onCreatePoint.mock.calls[0][0].y).toBeCloseTo(200,8) })
  it('stores the clicked Segment centerline point rather than a midpoint',()=>{ const onSegmentPoint=vi.fn(); const view={x:0,y:0,width:920,height:680}; const {container}=render(<NetworkCanvas {...base} drawing={null} onCreatePoint={noop} onSegmentPoint={onSegmentPoint} view={view}/>); const svg=container.querySelector('svg')!; vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({ ...bounds,left:0,top:0,x:0,y:0,right:920,bottom:680 }); const path=container.querySelector('.segment-hit') as SVGPathElement; Object.defineProperty(path,'getTotalLength',{configurable:true,value:()=>100}); Object.defineProperty(path,'getPointAtLength',{configurable:true,value:(length:number)=>({x:length,y:0})}); fireEvent.pointerDown(path,{pointerId:5,clientX:37,clientY:12,bubbles:true}); expect(onSegmentPoint).toHaveBeenCalledTimes(1); expect(onSegmentPoint.mock.calls[0][1].x).toBeCloseTo(37,1); expect(onSegmentPoint.mock.calls[0][1].y).toBe(0) })
})

describe('free creation does not snap to existing geometry',()=>{
  it('creates at the raw pointer world point even when the wide Segment hit path was clicked',()=>{ const onCreatePoint=vi.fn(),onSegmentPoint=vi.fn(); const view={x:0,y:0,width:920,height:680}; const {container}=render(<NetworkCanvas {...base} drawing={{lineId:'line-a',anchorStationId:'s4'}} onCreatePoint={onCreatePoint} onSegmentPoint={onSegmentPoint} view={view}/>); const svg=container.querySelector('svg')!; vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({ ...bounds,left:0,top:0,x:0,y:0,right:920,bottom:680 }); const path=container.querySelector('.segment-hit') as SVGPathElement; Object.defineProperty(path,'getTotalLength',{configurable:true,value:()=>100}); Object.defineProperty(path,'getPointAtLength',{configurable:true,value:(length:number)=>({x:length,y:0})}); fireEvent.pointerDown(path,{pointerId:6,clientX:37,clientY:12,bubbles:true}); expect(onCreatePoint).toHaveBeenCalledTimes(1); expect(onCreatePoint.mock.calls[0][0]).toEqual({x:37,y:12}); expect(onSegmentPoint).not.toHaveBeenCalled() })
})
