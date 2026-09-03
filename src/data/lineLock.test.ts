import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { isLineLocked, isSegmentGeometryLocked, isStationGeometryLocked, getLockedStationLineIds } from './lineLock'

describe('line geometry lock guards', () => {
  it('locks a station when any related line is locked', () => {
    const project = structuredClone(demoProject)
    project.lines.find(line => line.id === 'line-a')!.locked = true
    expect(isLineLocked(project, 'line-a')).toBe(true)
    expect(isStationGeometryLocked(project, 's2')).toBe(true)
    expect(getLockedStationLineIds(project, 's2')).toEqual(['line-a'])
  })

  it('does not lock a station that belongs only to an unlocked line', () => {
    const project = structuredClone(demoProject)
    project.lines.find(line => line.id === 'line-a')!.locked = true
    expect(isStationGeometryLocked(project, 's1')).toBe(true)
    expect(isStationGeometryLocked(project, 's5')).toBe(false)
  })

  it('locks segment geometry by its owning line', () => {
    const project = structuredClone(demoProject)
    project.lines.find(line => line.id === 'line-a')!.locked = true
    expect(isSegmentGeometryLocked(project, 'a-1')).toBe(true)
    expect(isSegmentGeometryLocked(project, 'b-1')).toBe(false)
  })
})
