import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { addLineBadge, appendStationToLine, connectExistingStation, createLine, deleteLineAndOrphans, deleteLineBadge, insertStationIntoSegment } from './operations'

describe('line-driven editing operations', () => {
  it('adds multiple independent badges to one Line and deletes only the requested badge',()=>{let project=structuredClone(demoProject);const first=addLineBadge(project,'line-a',{x:10,y:20}),second=addLineBadge(first.project,'line-a',{x:30,y:40});project=second.project;expect(project.lines.find(line=>line.id==='line-a')?.lineBadges).toHaveLength(2);const next=deleteLineBadge(project,'line-a',first.badgeId!);expect(next.lines.find(line=>line.id==='line-a')?.lineBadges?.map(badge=>badge.id)).toEqual([second.badgeId]);expect(next.lines.some(line=>line.id==='line-a')).toBe(true)})
  it('leaves new Lines and Stations inheriting visual defaults',()=>{const source=structuredClone(demoProject);source.settings.lineWidth=23;source.settings.stationSize=8;source.settings.stationLabelSize=17;const created=createLine(source,{name:'默认样式线',color:'#123456'}),line=created.project.lines.find(item=>item.id===created.lineId)!;expect(line.lineWidth).toBeUndefined();const result=appendStationToLine(created.project,created.lineId,{x:1,y:2}),station=result.project.stations.find(item=>item.id===result.stationId)!;for(const key of ['stationSize','transferMinorAxis','transferEndPadding','transferDotGap','labelSize','foreignLabelSize','foreignLabelGap','labelRotation'])expect(station[key as keyof typeof station]).toBeUndefined()})
  it('uses the default label direction and distance without creating a rotation override',()=>{const source=structuredClone(demoProject);source.settings.defaultLabelDirection='right';source.settings.defaultLabelDistance=10;source.settings.defaultStationLabelRotation=15;const result=appendStationToLine(source,'line-a',{x:900,y:300},'s4'),station=result.project.stations.find(item=>item.id===result.stationId)!;expect(station.labelOffsetX).toBe(10);expect(station.labelOffsetY).toBe(0);expect(station.labelRotation).toBeUndefined()})
  it('makes the first created station a line member immediately', () => {
    const created = createLine(demoProject, { name: '测试线', color: '#123456', openedAt: '2025-01-01' })
    const result = appendStationToLine(created.project, created.lineId, { x: 10, y: 20 })
    expect(result.project.stationLineRelations.some((relation) => relation.stationId === result.stationId && relation.lineId === created.lineId)).toBe(true)
    expect(result.project.geometry.segments.filter((segment) => segment.lineId === created.lineId)).toHaveLength(0)
  })

  it('creates an extension and a branch from the requested station', () => {
    const extension = appendStationToLine(demoProject, 'line-a', { x: 900, y: 500 }, 's4')
    expect(extension.project.geometry.segments.some((segment) => segment.fromStationId === 's4' && segment.toStationId === extension.stationId)).toBe(true)
    const branch = appendStationToLine(demoProject, 'line-a', { x: 400, y: 600 }, 's2')
    expect(branch.project.geometry.segments.some((segment) => segment.fromStationId === 's2' && segment.toStationId === branch.stationId)).toBe(true)
  })

  it('splits a segment atomically when inserting a station', () => {
    const result = insertStationIntoSegment(demoProject, 'a-1', { x: 280, y: 430 })
    expect(result.project.geometry.segments.some((segment) => segment.id === 'a-1')).toBe(false)
    expect(result.project.geometry.segments.filter((segment) => segment.lineId === 'line-a')).toHaveLength(4)
    expect(result.project.stationLineRelations.some((relation) => relation.stationId === result.stationId && relation.lineId === 'line-a')).toBe(true)
  })

  it('connects an existing station without creating an overlapping station', () => {
    const created = createLine(demoProject, { name: '接入线', color: '#654321' })
    const before = created.project.stations.length
    const connected = connectExistingStation(created.project, created.lineId, 's2')
    expect(connected.stations).toHaveLength(before)
    expect(connected.stationLineRelations.some((relation) => relation.stationId === 's2' && relation.lineId === created.lineId)).toBe(true)
  })

  it('removes zero-line stations when deleting a line', () => {
    const project=structuredClone(demoProject);project.lines.find(line=>line.id==='line-a')!.lineBadges=[{id:'badge-a',x:10,y:20,size:42,rotation:0,visible:true}];project.lines.find(line=>line.id==='line-b')!.lineBadges=[{id:'badge-b',x:30,y:40,size:42,rotation:0,visible:true}]
    const next = deleteLineAndOrphans(project, 'line-a')
    expect(next.stations.some((station) => station.id === 's1')).toBe(false)
    expect(next.stations.some((station) => station.id === 's2')).toBe(true)
    expect(next.stations.every((station) => next.stationLineRelations.some((relation) => relation.stationId === station.id))).toBe(true)
    expect(next.lines.some(line=>line.lineBadges?.some(badge=>badge.id==='badge-a'))).toBe(false)
    expect(next.lines.find(line=>line.id==='line-b')?.lineBadges?.map(badge=>badge.id)).toEqual(['badge-b'])
  })
})

describe('station coordinates remain pointer-authored', () => {
  it('keeps four consecutive new-line clicks without layout or rounding', () => { const created=createLine(demoProject,{name:'坐标线',color:'#112233'}); const points=[{x:300.25,y:200.75},{x:455.5,y:160.125},{x:612.875,y:330.625},{x:760.0625,y:510.9375}]; let project=created.project; let anchor:string|null=null; const ids:string[]=[]; for(const point of points){const result=appendStationToLine(project,created.lineId,point,anchor);project=result.project;anchor=result.stationId;ids.push(result.stationId)} ids.forEach((id,index)=>{const station=project.stations.find(item=>item.id===id)!;expect(station.x).toBe(points[index].x);expect(station.y).toBe(points[index].y)}) })
  it('keeps the exact endpoint-extension click', () => { const point={x:937.375,y:482.625}; const result=appendStationToLine(demoProject,'line-a',point,'s4'); const station=result.project.stations.find(item=>item.id===result.stationId)!; expect({x:station.x,y:station.y}).toEqual(point) })
  it('keeps the exact middle-station branch click', () => { const point={x:444.125,y:647.875}; const result=appendStationToLine(demoProject,'line-a',point,'s2'); const station=result.project.stations.find(item=>item.id===result.stationId)!; expect({x:station.x,y:station.y}).toEqual(point) })
  it('keeps the explicit projected Segment click instead of using its midpoint', () => { const point={x:281.375,y:431.625}; const result=insertStationIntoSegment(demoProject,'a-1',point); const station=result.project.stations.find(item=>item.id===result.stationId)!; expect({x:station.x,y:station.y}).toEqual(point); expect(station.x).not.toBe((180+390)/2) })
})
