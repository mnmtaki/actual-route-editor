import { describe, expect, it } from 'vitest'
import { projectPointToSvgPath, screenPointToWorld, screenPointToWorldFallback } from './screenPoint'

const rect = { left: 100, top: 50, width: 920, height: 680 }
describe('screen point to SVG world coordinates', () => {
  it('maps a pointer without zoom or pan', () => { expect(screenPointToWorldFallback(rect,{x:0,y:0,width:920,height:680},400,250)).toEqual({x:300,y:200}) })
  it('maps a pointer at 2x zoom', () => { expect(screenPointToWorldFallback(rect,{x:100,y:50,width:460,height:340},500,350)).toEqual({x:300,y:200}) })
  it('maps a pointer after pan', () => { expect(screenPointToWorldFallback(rect,{x:240,y:130,width:920,height:680},160,120)).toEqual({x:300,y:200}) })
  it('maps a pointer after combined zoom and pan', () => { expect(screenPointToWorldFallback(rect,{x:200,y:100,width:460,height:340},300,250)).toEqual({x:300,y:200}) })
  it('honors xMidYMid meet letterboxing instead of stretching the viewBox', () => { const wide={left:0,top:0,width:1000,height:600}; const scale=600/680; const left=(1000-920*scale)/2; const point=screenPointToWorldFallback(wide,{x:0,y:0,width:920,height:680},left+300*scale,200*scale); expect(point.x).toBeCloseTo(300,8); expect(point.y).toBeCloseTo(200,8) })
  it('prefers the browser SVG CTM inverse when available', () => { const svg={ getScreenCTM:()=>({inverse:()=>({})}), createSVGPoint:()=>({x:0,y:0,matrixTransform(this:{x:number;y:number}){return{x:(this.x-40)/2,y:(this.y-20)/2}}}), getBoundingClientRect:()=>rect } as unknown as SVGSVGElement; expect(screenPointToWorld(svg,640,420)).toEqual({x:300,y:200}) })
  it('projects only an explicit Segment click to its nearest centerline point', () => { const path={getTotalLength:()=>100,getPointAtLength:(length:number)=>({x:length,y:0})} as unknown as SVGPathElement; const point=projectPointToSvgPath(path,{x:33,y:14}); expect(point.x).toBeCloseTo(33,1); expect(point.y).toBe(0) })
})
