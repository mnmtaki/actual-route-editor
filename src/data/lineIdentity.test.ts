import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { deleteLineAndOrphans } from './operations'
import { getEffectiveLineColor, getLineDisplayName, collapseLinesByServiceFamily, validateLineParentRelations } from './lineIdentity'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'

describe('line identity and branch service family', () => {
  it('resolves inherited colors and fallback display names', () => {
    const project = structuredClone(demoProject)
    project.lines.push({ id: 'branch', name: '', color: '#ffffff', parentLineId: 'line-a', stationSequence: ['s1', 's2'], lineOrder: 3, visible: true, locked: false })
    expect(getEffectiveLineColor(project, 'branch')).toBe(project.lines[0].color)
    expect(getLineDisplayName(project, 'branch')).toBe('支线')
  })
  it('collapses root and branch into one passenger family without mutating order', () => {
    const project = structuredClone(demoProject)
    project.lines.push({ id: 'branch', name: '', color: '#ffffff', parentLineId: 'line-a', stationSequence: ['s1', 's2'], lineOrder: 3, visible: true, locked: false })
    const input = [project.lines[3], project.lines[0], project.lines[1]]
    const output = collapseLinesByServiceFamily(project, input)
    expect(output.map(line => line.id)).toEqual(['line-a', 'line-b'])
    expect(input.map(line => line.id)).toEqual(['branch', 'line-a', 'line-b'])
  })
  it('collapses sibling branches while preserving unrelated service families', () => {
    const project = structuredClone(demoProject)
    project.lines.push({ id: 'branch-1', name: '', color: '#fff', parentLineId: 'line-a', stationSequence: ['s1', 's2'], lineOrder: 3, visible: true, locked: false })
    project.lines.push({ id: 'branch-2', name: '机场支线', color: '#fff', parentLineId: 'line-a', stationSequence: ['s1', 's2'], lineOrder: 4, visible: true, locked: false })
    expect(collapseLinesByServiceFamily(project, [project.lines[0], project.lines[3], project.lines[4], project.lines[1]]).map(line => line.id)).toEqual(['line-a', 'line-b'])
    expect(collapseLinesByServiceFamily(project, [project.lines[3], project.lines[1]]).map(line => line.id)).toEqual(['branch-1', 'line-b'])
  })
  it('deletes direct and nested branches with their parent', () => {
    const project = structuredClone(demoProject)
    project.lines.push({ id: 'branch', name: '', color: '#ffffff', parentLineId: 'line-a', stationSequence: ['s1', 's2'], lineOrder: 3, visible: true, locked: false })
    project.lines.push({ id: 'nested', name: '', color: '#ffffff', parentLineId: 'branch', stationSequence: ['s1', 's2'], lineOrder: 4, visible: true, locked: false })
    const next = deleteLineAndOrphans(project, 'line-a')
    expect(next.lines.some(line => line.id === 'line-a')).toBe(false)
    expect(next.lines.some(line => line.id === 'branch' || line.id === 'nested')).toBe(false)
  })
  it('keeps a branch when deleting only the branch', () => {
    const project = structuredClone(demoProject)
    project.lines.push({ id: 'branch', name: '', color: '#ffffff', parentLineId: 'line-a', stationSequence: ['s1', 's2'], lineOrder: 3, visible: true, locked: false })
    const next = deleteLineAndOrphans(project, 'branch')
    expect(next.lines.map(line => line.id)).toContain('line-a')
    expect(next.lines.map(line => line.id)).not.toContain('branch')
  })
  it('validates dangling and cyclic parent references', () => {
    const project = structuredClone(demoProject)
    project.lines[0].parentLineId = 'missing'
    project.lines[1].parentLineId = 'line-c'
    project.lines[2].parentLineId = 'line-b'
    expect(validateLineParentRelations(project).length).toBeGreaterThan(0)
  })
  it('round-trips parentLineId through native JSON', () => {
    const project = structuredClone(demoProject)
    project.lines[1].parentLineId = 'line-a'
    const restored = parseProjectJson(serializeProject(project))
    expect(restored.lines.find(line => line.id === 'line-b')?.parentLineId).toBe('line-a')
  })
})