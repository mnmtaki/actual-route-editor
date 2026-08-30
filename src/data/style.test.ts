import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './model'
import { effectiveLabelRotation, inferLabelDirection, labelOffsetFor, resetVisualSettings } from './style'
describe('visual style helpers',()=>{
 it('maps cardinal and diagonal directions to exact offsets',()=>{expect(labelOffsetFor('right',10)).toEqual({x:10,y:0});const diagonal=labelOffsetFor('upper-right',10);expect(diagonal.x).toBeCloseTo(7.0710678);expect(diagonal.y).toBeCloseTo(-7.0710678);expect(inferLabelDirection(diagonal.x,diagonal.y)).toBe('upper-right')})
 it('keeps station rotation overrides independent from global defaults',()=>{const station={id:'s',name:'S',x:0,y:0,labelOffsetX:10,labelOffsetY:0};expect(effectiveLabelRotation(station,{...DEFAULT_SETTINGS,defaultStationLabelRotation:-45})).toBe(-45);expect(effectiveLabelRotation({...station,labelRotation:45},{...DEFAULT_SETTINGS,defaultStationLabelRotation:-45})).toBe(45)})
 it('resets only visual style fields to product defaults',()=>{const reset=resetVisualSettings({...DEFAULT_SETTINGS,lineWidth:24,stationSize:14,worldUnitsPerKm:222});expect(reset.lineWidth).toBe(18);expect(reset.stationSize).toBe(11);expect(reset.transferMinorAxis).toBe(19.5);expect(reset.worldUnitsPerKm).toBe(222)})
})
