import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './storage'
import { getOperatingLineCount, isFakeLine, setLineFake } from './fakeLines'

function makeLine(id: string, name: string) {
  return { id, name, color: '#336699', stationSequence: [], lineOrder: 0, visible: true, locked: false }
}

describe('fake line semantics', () => {
  it('persists fake state and excludes it from the operating line count', () => {
    const project = createEmptyProject()
    project.lines = [makeLine('real', '真实线'), makeLine('fake', '图例线')]
    const next = setLineFake(project, 'fake', true)
    expect(isFakeLine(next.lines[1])).toBe(true)
    expect(getOperatingLineCount(next)).toBe(1)
    expect(isFakeLine(project.lines[1])).toBe(false)
  })

  it('can turn a fake line back into a normal operating line', () => {
    const project = createEmptyProject()
    project.lines = [makeLine('line', '线路')]
    const fake = setLineFake(project, 'line', true)
    const restored = setLineFake(fake, 'line', false)
    expect(isFakeLine(restored.lines[0])).toBe(false)
    expect(getOperatingLineCount(restored)).toBe(1)
  })
})
