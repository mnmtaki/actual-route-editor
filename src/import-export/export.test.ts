import { render } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { parseProjectJson, serializeProject } from './projectJson'
import { exportSvg } from './svgExport'
import { StationMarker } from '../renderer/StationMarker'

describe('project and SVG export', () => {
  it('round-trips the complete project schema', () => {
    const restored = parseProjectJson(serializeProject(demoProject))
    expect(restored).toEqual(demoProject)
    expect(restored.stationLineRelations[0].openedAt).toBe('2000-01-01')
    expect(restored.geometry.segments[0].waypoints).toHaveLength(1)
  })
  it('round-trips object-level line, station, transfer and label styles',()=>{const current=structuredClone(demoProject);current.lines[0].lineWidth=20;Object.assign(current.stations[0],{stationSize:14,transferMinorAxis:23,transferEndPadding:6,transferDotGap:3,labelSize:18,foreignLabelSize:11,foreignLabelGap:4});const restored=parseProjectJson(serializeProject(current));expect(restored.lines[0].lineWidth).toBe(20);expect(restored.stations[0]).toMatchObject({stationSize:14,transferMinorAxis:23,transferEndPadding:6,transferDotGap:3,labelSize:18,foreignLabelSize:11,foreignLabelGap:4})})

  it('withdraws the oversized transfer defaults while preserving deliberate custom values', () => {
    const oversized=JSON.parse(serializeProject(demoProject)); oversized.settings.transferHeightRatio=1.18; oversized.settings.transferGapRatio=.202
    const restored=parseProjectJson(JSON.stringify(oversized))
    expect(restored.settings.transferHeightRatio).toBeCloseTo(1.0833333333333333)
    expect(restored.settings.transferGapRatio).toBeCloseTo(.1944)
    oversized.settings.transferHeightRatio=1.12; oversized.settings.transferGapRatio=.2
    const custom=parseProjectJson(JSON.stringify(oversized))
    expect(custom.settings.transferHeightRatio).toBe(1.12)
    expect(custom.settings.transferGapRatio).toBe(.2)
  })
  it('migrates legacy ratio-only styles to actual units without overwriting custom geometry or label offsets',()=>{
    const legacy=JSON.parse(serializeProject(demoProject));for(const key of ['transferMinorAxis','transferEndPadding','transferDotGap','stationLabelSize','stationForeignLabelSize','foreignLabelGap','defaultLabelDirection','defaultLabelDistance','defaultStationLabelRotation'])delete legacy.settings[key]
    legacy.settings.transferHeightRatio=1.12;legacy.settings.transferGapRatio=.2;legacy.settings.transferPaddingRatio=.3;legacy.stations[0].labelOffsetX=20;legacy.stations[0].labelOffsetY=-10
    const restored=parseProjectJson(JSON.stringify(legacy));expect(restored.settings.transferMinorAxis).toBeCloseTo(20.16);expect(restored.settings.transferDotGap).toBeCloseTo(2.2);expect(restored.settings.transferEndPadding).toBeCloseTo(3.3);expect(restored.settings.stationLabelSize).toBe(14);expect(restored.settings.stationForeignLabelSize).toBe(10.08);expect(restored.stations[0].labelOffsetX).toBe(20);expect(restored.stations[0].labelOffsetY).toBe(-10)
  })
  it('recognizes Build 11 defaults and upgrades only those defaults to the new transfer length',()=>{const legacy=JSON.parse(serializeProject(demoProject));for(const key of ['transferMinorAxis','transferEndPadding','transferDotGap'])delete legacy.settings[key];const restored=parseProjectJson(JSON.stringify(legacy));expect(restored.settings.transferMinorAxis).toBe(19.5);expect(restored.settings.transferEndPadding).toBe(5.15);expect(restored.settings.transferDotGap).toBe(2.25)})
  it('preserves distance scale and normalizes legacy year-only dates without losing full dates', () => {
    const current=structuredClone(demoProject); current.settings.worldUnitsPerKm=125; current.lines[0].openedAt='2000-06-18'
    const restored=parseProjectJson(serializeProject(current))
    expect(restored.settings.worldUnitsPerKm).toBe(125)
    expect(restored.lines[0].openedAt).toBe('2000-06-18')
    expect(restored.presentation.showOperatingLength).toBe(true)
    expect(restored.presentation.showStationCount).toBe(true)

    const legacy=JSON.parse(serializeProject(current))
    delete legacy.settings.worldUnitsPerKm; delete legacy.presentation.showOperatingLength; delete legacy.presentation.showStationCount
    legacy.lines[0].openedAt='2012'; legacy.geometry.segments[0].openedAt='2012'; legacy.stationLineRelations[0].openedAt='2012'
    const migrated=parseProjectJson(JSON.stringify(legacy))
    expect(migrated.settings.worldUnitsPerKm).toBe(100)
    expect(migrated.lines[0].openedAt).toBe('2012-01-01')
    expect(migrated.geometry.segments[0].openedAt).toBe('2012-01-01')
    expect(migrated.stationLineRelations[0].openedAt).toBe('2012-01-01')
  })
  it('round-trips Opening Phase membership and keeps old projects without the field compatible', () => {
    const current=structuredClone(demoProject)
    current.openingPhases=[{id:'phase-1',lineId:'line-a',name:'东延',openedAt:'2026-01-01',segmentIds:['a-3'],stationRelationIds:['r-a-s4'],overriddenSegmentIds:[],overriddenStationRelationIds:[]}]
    expect(parseProjectJson(serializeProject(current)).openingPhases).toEqual(current.openingPhases)
    const legacy=JSON.parse(serializeProject(current));delete legacy.openingPhases
    expect(parseProjectJson(JSON.stringify(legacy)).openingPhases).toEqual([])
  })

  it('migrates the old misleading Station.openedAt value into its sole relation when that relation only inherited the line date', () => {
    const legacy=structuredClone(demoProject)
    const station=legacy.stations.find(item=>item.id==='s4')!,relation=legacy.stationLineRelations.find(item=>item.stationId==='s4'&&item.lineId==='line-a')!
    station.openedAt='2026-01-01';relation.openedAt='2000-01-01'
    const migrated=parseProjectJson(serializeProject(legacy))
    expect(migrated.stationLineRelations.find(item=>item.id===relation.id)?.openedAt).toBe('2026-01-01')
    expect(JSON.parse(serializeProject(migrated)).stationLineRelations.find((item:{id:string})=>item.id===relation.id).openedAt).toBe('2026-01-01')
  })
  it('removes editor handles and optionally removes the background', () => {
    document.body.innerHTML = '<svg viewBox="0 0 100 100"><image href="x"/><path class="art"/><g data-editor="true"><circle/></g><path class="segment-hit"/></svg>'
    const result = exportSvg(document.querySelector('svg')!, false)
    expect(result).toContain('class="art"')
    expect(result).not.toContain('data-editor')
    expect(result).not.toContain('segment-hit')
    expect(result).not.toContain('<image')
  })

  it('exports current transfer dimensions and rotated bilingual label styles',()=>{const project=structuredClone(demoProject),station=project.stations.find(item=>item.id==='s2')!;station.nameS='Civic Square';station.labelRotation=45;project.settings.stationLabelSize=18;project.settings.stationForeignLabelSize=10;const {container}=render(createElement('svg',null,createElement(StationMarker,{project,station,time:'2025-01-01',selected:false,onPointerDown:()=>{},onLabelPointerDown:()=>{}}))),svg=exportSvg(container.querySelector('svg')!,true);expect(svg).toContain('width="34.599999999999994"');expect(svg).toContain('height="19.5"');expect(svg).toContain('r="3.3"');expect(svg).toContain('rotate(45)');expect(svg).toContain('font-size: 18px');expect(svg).toContain('font-size: 10px')})
  it('keeps bilingual label lines and formal elevated terminal caps in SVG export', () => {
    document.body.innerHTML = '<svg viewBox="0 0 100 100"><text class="station-label"><tspan>木阳站</tspan><tspan class="station-label-foreign">Muyang Railway Station</tspan></text><path data-run-centerline="outer" d="M 0 0 C 20 0 30 20 50 20"/><path data-terminal-cap="end" d="M 0 -5 A 5 5 0 0 1 0 5 L 0 -5 Z"/></svg>'
    const result=exportSvg(document.querySelector('svg')!,true)
    expect(result).toContain('Muyang Railway Station')
    expect(result).toContain('data-run-centerline="outer"')
    expect(result).toContain('data-terminal-cap="end"')
  })})
