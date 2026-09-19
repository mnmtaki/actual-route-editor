import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './storage'
import { materializeAarcFakeLineEntries } from './aarcFakeLineEntries'
import { sortByAarcCommonLineZIndex } from './aarcLineZIndex'

describe('AARC fake line entries', () => {
  it('materializes common fake source lines into selectable native line entries', () => {
    const project = createEmptyProject()
    project.aarc = {
      format: 'aarc',
      raw: {
        lines: [
          { id: 7, name: '图例线', color: '#123456', type: 0, isFake: true, pts: [1, 2] },
          { id: 8, name: '伪地形', color: '#abcdef', type: 1, isFake: true, pts: [3, 4] },
        ],
      },
    }
    const next = materializeAarcFakeLineEntries(project)
    expect(next.lines).toHaveLength(1)
    expect(next.lines[0]).toMatchObject({ id: 'aarc-line-7', name: '图例线', color: '#123456', isFake: true })
    expect(materializeAarcFakeLineEntries(next)).toBe(next)
  })

  it('keeps fake children in the parent zIndex render group even when the child appears first in source order', () => {
    const project = createEmptyProject()
    project.aarc = {
      format: 'aarc',
      raw: {
        lines: [
          { id: 11, name: '伪支线', color: '#445566', type: 0, isFake: true, parent: 10, zIndex: -999, pts: [3, 4] },
          { id: 10, name: '伪主线', color: '#223344', type: 0, isFake: true, zIndex: 5, pts: [1, 2] },
          { id: 20, name: '另一伪线', color: '#667788', type: 0, isFake: true, zIndex: 1, pts: [5, 6] },
        ],
      },
    }
    const next = materializeAarcFakeLineEntries(project)
    const child = next.lines.find(line => line.id === 'aarc-line-11')!
    expect(child.parentLineId).toBe('aarc-line-10')
    expect(sortByAarcCommonLineZIndex(next, next.lines, line => line.id).map(line => line.id)).toEqual(['aarc-line-20', 'aarc-line-10', 'aarc-line-11'])
  })
})
