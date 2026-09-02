import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { withoutBackground } from './background'

describe('basemap removal', () => {
  it('clears the imported image and its metadata without changing map content', () => {
    const project = structuredClone(demoProject)
    project.background = { dataUrl: 'data:image/png;base64,AA==', name: 'map.png', x: 12, y: 24, width: 500, height: 300, opacity: .42, visible: false, locked: false }
    const next = withoutBackground(project)
    expect(next).not.toBe(project)
    expect(next.background).toBeNull()
    expect(next.lines).toEqual(project.lines)
    expect(next.stations).toEqual(project.stations)
    expect(next.geometry).toEqual(project.geometry)
    expect(project.background?.dataUrl).toContain('data:image/png')
  })
})
