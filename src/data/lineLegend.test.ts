import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { createLineLegend, displayForeignLineName, displayLineName, getLineLegendItems, getLineLegendLayout, isRingLine, normalizeLineLegend } from './lineLegend'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'

describe('line legend data and layout', () => {
  it('normalizes an optional legend without changing older projects', () => {
    const project = structuredClone(demoProject)
    expect(project.lineLegend).toBeUndefined()
    const created = createLineLegend(project, { x: 12, y: 34 })
    expect(created.legendId).toBe(created.project.lineLegend?.id)
    expect(created.project.lineLegend).toMatchObject({ x: 12, y: 34, mode: 'auto', columns: 4 })
    expect(normalizeLineLegend(created.project.lineLegend)).toEqual(created.project.lineLegend)
    expect(parseProjectJson(serializeProject(created.project)).lineLegend).toEqual(created.project.lineLegend)
  })

  it('uses stable project order and only visible lines in auto mode', () => {
    const project = structuredClone(demoProject)
    project.lines[1].visible = false
    const legend = normalizeLineLegend({ id: 'legend', x: 0, y: 0, mode: 'auto' })!
    expect(getLineLegendItems(project, legend).map(item => item.lineId)).toEqual(['line-a', 'line-c'])
  })

  it('filters custom lines while retaining their project order', () => {
    const project = structuredClone(demoProject)
    const legend = normalizeLineLegend({ id: 'legend', x: 0, y: 0, mode: 'custom', lineIds: ['line-c', 'line-a'], columns: 2 })!
    expect(getLineLegendItems(project, legend).map(item => item.lineId)).toEqual(['line-a', 'line-c'])
    expect(getLineLegendLayout(project, legend).columns).toBe(2)
  })

  it('formats numeric line names and safe foreign fallbacks', () => {
    const numeric = { ...demoProject.lines[0], name: '1' }
    const loop = { ...demoProject.lines[0], name: '机场环线' }
    expect(displayLineName(numeric)).toBe('1号线')
    expect(displayForeignLineName(numeric)).toBe('Line 1')
    expect(displayForeignLineName(loop)).toBe('Loop Line')
    expect(displayForeignLineName(demoProject.lines[0])).toBe('')
  })

  it('detects a ring from topology rather than station names', () => {
    const project = structuredClone(demoProject), line = project.lines[0]
    expect(isRingLine(project, line)).toBe(false)
    project.geometry.segments.push({ id: 'ring-close', lineId: line.id, fromStationId: 's4', toStationId: 's1', mode: 'smooth', structureType: 'underground', waypoints: [] })
    expect(isRingLine(project, line)).toBe(true)
    expect(getLineLegendItems(project, normalizeLineLegend({ id: 'legend', x: 0, y: 0 })!)[0]).toMatchObject({ isRing: true, firstStation: '云港', lastStation: '云港' })
  })

  it('keeps a line with no stations but omits its terminal row',()=>{
    const project=structuredClone(demoProject);project.lines[0].stationSequence=[]
    const legend=normalizeLineLegend({id:'legend',x:0,y:0})!,items=getLineLegendItems(project,legend)
    expect(items[0]).toMatchObject({lineId:'line-a',lineName:'澄川线',firstStation:'',lastStation:''})
    expect(getLineLegendLayout(project,legend).items[0].height).toBeGreaterThan(0)
  })
})
