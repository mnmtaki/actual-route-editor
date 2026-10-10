import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { hitMapObjects, mergeMapSelections, selectionIdentity } from './mapMarquee'

describe('mouse map marquee', () => {
  it('hits visible stations and mapped line segments in a dragged rectangle', () => {
    const project = structuredClone(demoProject)
    const station = project.stations[0]
    const hits = hitMapObjects(project, { left: station.x - 10, right: station.x + 10, top: station.y - 10, bottom: station.y + 10 })
    expect(hits.some(item => item.type === 'station' && item.id === station.id)).toBe(true)
  })
  it('handles a long segment that crosses the rectangle with neither endpoint inside', () => {
    const project = structuredClone(demoProject)
    project.roads = [{ id: 'crossing-road', points: [{ id: 'p1', x: -100, y: 100 }, { id: 'p2', x: 100, y: 100 }], name: 'Test', styleId: 'default', zIndex: 1, visible: true, locked: false, createdOrder: 0 }]
    const hits = hitMapObjects(project, { left: -1, right: 1, top: 90, bottom: 110 })
    expect(hits.some(item => item.type === 'road' && item.id === 'crossing-road')).toBe(true)
  })
  it('selects visible editables without allowing a background to swallow every small marquee', () => {
    const project = structuredClone(demoProject)
    project.background = { dataUrl: 'data:image/png;base64,AAAA', name: 'bg', x: 0, y: 0, width: 1000, height: 1000, opacity: 1, visible: true, locked: false }
    const small = hitMapObjects(project, { left: 20, right: 60, top: 20, bottom: 60 })
    const large = hitMapObjects(project, { left: -1, right: 1001, top: -1, bottom: 1001 })
    expect(small.some(item => item.type === 'background')).toBe(false)
    expect(large.some(item => item.type === 'background')).toBe(true)
  })
  it('supports mouse-only append mode while keeping previous selections', () => {
    const a = { type: 'station' as const, id: 'a' }, b = { type: 'road' as const, id: 'b' }
    expect(mergeMapSelections([a], [a, b], true)).toEqual([a, b])
    expect(mergeMapSelections([a], [b], false)).toEqual([b])
    expect(selectionIdentity(a)).not.toBe(selectionIdentity({ type: 'line', id: 'a' }))
  })
})
