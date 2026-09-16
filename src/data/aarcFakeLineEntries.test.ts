import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './storage'
import { materializeAarcFakeLineEntries } from './aarcFakeLineEntries'

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
})
