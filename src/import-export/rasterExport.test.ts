import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRasterPlan, MAX_RASTER_PIXELS, MAX_RASTER_SIDE, rasterFilename, rasterizeSvg } from './rasterExport'
const svg=(viewBox='10 20 321.2 243.4')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><text>木阳站 Muyang</text></svg>`

describe('complete-map raster export',()=>{
  const drawImage=vi.fn(),fillRect=vi.fn(),context={drawImage,fillRect,fillStyle:''}
  const originalFonts=Object.getOwnPropertyDescriptor(document,'fonts')
  beforeEach(()=>{drawImage.mockClear();fillRect.mockClear();context.fillStyle='';vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});Object.defineProperty(globalThis,'Image',{configurable:true,value:class{onload:()=>void=()=>{};onerror:()=>void=()=>{};set src(_value:string){queueMicrotask(()=>this.onload())}}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(function(callback,type){callback(new Blob(['ok'],{type:type??'image/png'}))})})
  afterEach(()=>{vi.restoreAllMocks();if(originalFonts)Object.defineProperty(document,'fonts',originalFonts);else Reflect.deleteProperty(document,'fonts')})
  it.each([['png','image/png','png'],['jpeg','image/jpeg','jpg'],['webp','image/webp','webp']] as const)('uses the correct MIME and filename extension for %s',async(format,mime,extension)=>{const result=await rasterizeSvg(svg(),format,1);expect(result.blob.type).toBe(mime);expect(rasterFilename('木阳',format)).toBe(`木阳.${extension}`)})
  it.each([[1,322,244],[2,643,487],[4,1285,974]] as const)('computes %sx dimensions from the complete SVG viewBox', (scale,width,height)=>{expect(getRasterPlan(svg(),'png',scale)).toMatchObject({width,height,scale,safe:true})})
  it('preserves aspect ratio independently from camera-sized SVG attributes',()=>{const plan=getRasterPlan('<svg viewBox="0 0 640 360" width="20" height="10"/>','png',2);expect(plan.width/plan.height).toBeCloseTo(16/9);expect(plan).toMatchObject({width:1280,height:720})})
  it('uses identical raster bounds for SVG exports with identical complete viewBoxes',()=>{const a=getRasterPlan('<svg viewBox="-20 -30 900 600" width="100"/>','png',2),b=getRasterPlan('<svg viewBox="-20 -30 900 600" width="9999"/>','png',2);expect(a.viewBox).toEqual(b.viewBox);expect([a.width,a.height]).toEqual([b.width,b.height])})
  it('rejects an unsafe canvas without silently downscaling',()=>{const plan=getRasterPlan(svg(`0 0 ${MAX_RASTER_SIDE} ${Math.floor(MAX_RASTER_PIXELS/MAX_RASTER_SIDE)+1}`),'png',1);expect(plan.safe).toBe(false);expect(plan.error).toContain('选择较低倍率')})
  it('composites JPEG onto the requested background before drawing the SVG',async()=>{await rasterizeSvg(svg(),'jpeg',1,'#f3f0e9');expect(context.fillStyle).toBe('#f3f0e9');expect(fillRect).toHaveBeenCalledWith(0,0,322,244);expect(drawImage).toHaveBeenCalled()})
  it('keeps PNG transparent by not painting a forced background',async()=>{await rasterizeSvg(svg(),'png',1);expect(fillRect).not.toHaveBeenCalled()})
  it('reports unsupported WebP encoding instead of creating a damaged file',async()=>{vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(null));await expect(rasterizeSvg(svg(),'webp',1)).rejects.toThrow('不支持 WebP')})
  it('rejects malformed SVG bounds before allocating a canvas',()=>{expect(()=>getRasterPlan('<svg/>','png',1)).toThrow('viewBox')})
  it('waits for document fonts before rasterizing the SVG',async()=>{let resolveFonts!:()=>void;const ready=new Promise<void>(resolve=>{resolveFonts=resolve});Object.defineProperty(document,'fonts',{configurable:true,value:{ready}});const pending=rasterizeSvg(svg(),'png',1);await Promise.resolve();expect(URL.createObjectURL).not.toHaveBeenCalled();resolveFonts();await pending;expect(URL.createObjectURL).toHaveBeenCalled()})
})
