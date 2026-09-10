import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './model'
import { effectiveLabelRotation, effectiveLineWidth, inferLabelDirection, labelOffsetFor, resetVisualSettings, resolveLabelAnchor, resolveStationLabelDirection, snapLabelOffset } from './style'
describe('visual style helpers',()=>{
 it('maps cardinal and diagonal directions to exact offsets',()=>{expect(labelOffsetFor('right',10)).toEqual({x:10,y:0});const diagonal=labelOffsetFor('upper-right',10);expect(diagonal.x).toBeCloseTo(7.0710678);expect(diagonal.y).toBeCloseTo(-7.0710678);expect(inferLabelDirection(diagonal.x,diagonal.y)).toBe('upper-right')})
 it('resolves stable eight-way sectors around top and bottom',()=>{
   expect(resolveStationLabelDirection(-5,-100)).toBe('up');expect(resolveStationLabelDirection(0,-100)).toBe('up');expect(resolveStationLabelDirection(5,-100)).toBe('up')
   expect(resolveStationLabelDirection(-5,100)).toBe('down');expect(resolveStationLabelDirection(0,100)).toBe('down');expect(resolveStationLabelDirection(5,100)).toBe('down')
   expect(resolveStationLabelDirection(100,-100)).toBe('upper-right');expect(resolveStationLabelDirection(-100,-100)).toBe('upper-left');expect(resolveStationLabelDirection(100,100)).toBe('lower-right');expect(resolveStationLabelDirection(-100,100)).toBe('lower-left')
   expect(resolveStationLabelDirection(0,0)).toBe('custom')
 })
 it('snaps an edited offset while preserving its distance',()=>{const snapped=snapLabelOffset(5,-100);expect(snapped.direction).toBe('up');expect(snapped.x).toBe(0);expect(snapped.y).toBeCloseTo(-Math.hypot(5,100));expect(Math.hypot(snapped.x,snapped.y)).toBeCloseTo(Math.hypot(5,100))})
 it('centers vertical label anchors and keeps diagonal anchors directional',()=>{expect(resolveLabelAnchor(-5,-100)).toMatchObject({textAnchor:'middle',verticalAnchor:'above'});expect(resolveLabelAnchor(5,100)).toMatchObject({textAnchor:'middle',verticalAnchor:'below'});expect(resolveLabelAnchor(100,-100)).toMatchObject({textAnchor:'start',verticalAnchor:'above'});expect(resolveLabelAnchor(-100,100)).toMatchObject({textAnchor:'end',verticalAnchor:'below'})})
 it('keeps station rotation overrides independent from global defaults',()=>{const station={id:'s',name:'S',x:0,y:0,labelOffsetX:10,labelOffsetY:0};expect(effectiveLabelRotation(station,{...DEFAULT_SETTINGS,defaultStationLabelRotation:-45})).toBe(-45);expect(effectiveLabelRotation({...station,labelRotation:45},{...DEFAULT_SETTINGS,defaultStationLabelRotation:-45})).toBe(45)})
 it('resets only visual style fields to product defaults',()=>{const reset=resetVisualSettings({...DEFAULT_SETTINGS,lineWidth:24,stationSize:14,worldUnitsPerKm:222});expect(reset.lineWidth).toBe(18);expect(reset.stationSize).toBe(11);expect(reset.transferMinorAxis).toBe(19.5);expect(reset.worldUnitsPerKm).toBe(222)})
 it('scales AARC source width ratios through the active theme without changing native lines',()=>{const line={id:'aarc',name:'AARC',color:'#123456',stationSequence:[],lineOrder:0,openedAt:null,visible:true,locked:false,source:{format:'aarc' as const,sourceWidthRatio:2}};expect(effectiveLineWidth(line,{...DEFAULT_SETTINGS,lineWidth:21,aarcLineWidthReferenceRatio:1.5})).toBeCloseTo(28);const native={...line,source:undefined};expect(effectiveLineWidth(native,{...DEFAULT_SETTINGS,lineWidth:21,aarcLineWidthReferenceRatio:1.5})).toBe(21)})
})
