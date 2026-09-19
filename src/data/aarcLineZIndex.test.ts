import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './storage'
import type { Line, Segment } from './model'
import { resolveAarcCommonLineCap, sortByAarcCommonLineZIndex } from './aarcLineZIndex'
import { getActiveNetworkAtTime } from '../timeline/active'

const source = (lineId: number, sourceZIndex: number, sourceParentId?: number, raw?: Record<string, unknown>) => ({
  format: 'aarc' as const,
  lineId,
  sourceLineId: lineId,
  sourceZIndex,
  ...(sourceParentId !== undefined ? { sourceParentId } : {}),
  ...(raw ? { raw } : {}),
})

const line = (id: string, order: number, z?: number, parentLineId?: string): Line => ({
  id,
  name: id,
  color: '#336699',
  stationSequence: [],
  lineOrder: order,
  visible: true,
  locked: false,
  ...(parentLineId ? { parentLineId } : {}),
  ...(z !== undefined ? { source: source(Number(id.replace(/\D/g, '')) || order + 1, z, parentLineId ? Number(parentLineId.replace(/\D/g, '')) : undefined) } : {}),
})

const segment = (id: string, lineId: string): Segment => ({
  id,
  lineId,
  fromStationId: `${id}-a`,
  toStationId: `${id}-b`,
  mode: 'straight',
  structureType: 'underground',
  waypoints: [],
})

describe('AARC common-line zIndex', () => {
  it('sorts imported AARC root lines by zIndex while preserving stable equal-z order', () => {
    const project = createEmptyProject()
    project.lines = [line('line-1', 0, 10), line('line-2', 1, -2), line('line-3', 2, 10)]
    expect(sortByAarcCommonLineZIndex(project, project.lines, item => item.id).map(item => item.id)).toEqual(['line-2', 'line-1', 'line-3'])
  })

  it('keeps a child line with its parent render group instead of using the child zIndex independently', () => {
    const project = createEmptyProject()
    const parent = line('line-1', 0, 5)
    const child = { ...line('line-11', 1, -999, parent.id), source: source(11, -999, 1) }
    const other = line('line-2', 2, 1)
    project.lines = [parent, child, other]
    expect(sortByAarcCommonLineZIndex(project, project.lines, item => item.id).map(item => item.id)).toEqual(['line-2', 'line-1', 'line-11'])
  })

  it('leaves native ActualRoute slots untouched while reordering AARC items inside their own slots', () => {
    const project = createEmptyProject()
    const nativeA = line('native-a', 0)
    const aarcHigh = line('line-1', 1, 9)
    const nativeB = line('native-b', 2)
    const aarcLow = line('line-2', 3, -1)
    project.lines = [nativeA, aarcHigh, nativeB, aarcLow]
    expect(sortByAarcCommonLineZIndex(project, project.lines, item => item.id).map(item => item.id)).toEqual(['native-a', 'line-2', 'native-b', 'line-1'])
  })

  it('feeds the zIndex order into the active segment render sequence used by the editor', () => {
    const project = createEmptyProject()
    project.lines = [line('line-1', 0, 20), line('line-2', 1, -4)]
    project.geometry.segments = [segment('seg-1', 'line-1'), segment('seg-2', 'line-2')]
    const active = getActiveNetworkAtTime(project, project.timeline.currentDate)
    expect(active.lines.map(item => item.id)).toEqual(['line-2', 'line-1'])
    expect(active.segments.map(item => item.id)).toEqual(['seg-2', 'seg-1'])
  })
})

describe('AARC common-line cap', () => {
  it('uses butt by default for AARC common lines and preserves native round caps', () => {
    const native = line('native', 0)
    const imported = line('line-1', 1, 0)
    expect(resolveAarcCommonLineCap(native)).toBe('round')
    expect(resolveAarcCommonLineCap(imported)).toBe('butt')
  })

  it('honors an explicit AARC source cap', () => {
    const imported = line('line-1', 0, 0)
    imported.source = source(1, 0, undefined, { cap: 'square' })
    expect(resolveAarcCommonLineCap(imported)).toBe('square')
    imported.source.raw = { cap: 'round' }
    expect(resolveAarcCommonLineCap(imported)).toBe('round')
  })
})
