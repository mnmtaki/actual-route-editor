import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { createEmptyProject } from './storage'
import { materializeAarcFakeLineEntries } from './aarcFakeLineEntries'
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
  it('can marquee-select imported fake lines even though they have no native segments', () => {
    const source = createEmptyProject()
    source.aarc = { format: 'aarc', raw: {
      lines: [{ id: 7, name: '图例伪线', type: 0, isFake: true, pts: [1, 2] }],
      points: [{ id: 1, pos: [0, 0] }, { id: 2, pos: [100, 0] }],
    } }
    const project = materializeAarcFakeLineEntries(source)
    const hits = hitMapObjects(project, { left: 40, right: 60, top: -5, bottom: 5 })
    expect(hits.some(item => item.type === 'line' && item.id === 'aarc-line-7')).toBe(true)
  })
  it('selects AARC free/terrain/icon tags without requiring a native line owner', () => {
    const project = createEmptyProject()
    project.textTags = [
      { id: 'free', kind: 'FreeMapText', x: 40, y: 40, text: '广场' },
      { id: 'terrain', kind: 'TerrainNameLabel', x: 70, y: 40, text: '江流', source: { format: 'aarc', forId: 9, targetKind: 'terrain' } },
      { id: 'icon', kind: 'MapIcon', x: 90, y: 40, iconId: 'icon-1' },
    ]
    const hits = hitMapObjects(project, { left: 30, right: 100, top: 20, bottom: 60 })
    expect(hits.filter(item => item.type === 'aarcTextTag').map(item => item.id)).toEqual(['free', 'terrain', 'icon'])
  })
  it('selects an AARC tag by rendered bounds even when its anchor is outside the rectangle', () => {
    const project = createEmptyProject()
    project.textTags = [{ id: 'long-label', kind: 'FreeMapText', x: 200, y: 200, text: '很长的文字' }]
    const rect = { left: 80, top: 150, right: 100, bottom: 170 }
    expect(hitMapObjects(project, rect)).toHaveLength(0)
    const bounds = new Map([['long-label', { left: 70, top: 155, right: 220, bottom: 185 }]])
    expect(hitMapObjects(project, rect, bounds)).toContainEqual({ type: 'aarcTextTag', id: 'long-label' })
  })
  it('resolves AARC fake-line tag owners from source references without losing independent tags', () => {
    const source = createEmptyProject()
    source.aarc = { format: 'aarc', raw: { lines: [{ id: 7, name: '伪线', type: 0, isFake: true, pts: [1, 2] }], points: [{ id: 1, pos: [0, 0] }, { id: 2, pos: [100, 0] }] } }
    const project = materializeAarcFakeLineEntries(source)
    project.textTags = [
      { id: 'fake-name', kind: 'FreeMapText', x: 30, y: 20, source: { format: 'aarc', forId: 7 } },
      { id: 'free-name', kind: 'FreeMapText', x: 40, y: 20 },
    ]
    const hits = hitMapObjects(project, { left: 20, top: 10, right: 50, bottom: 30 })
    expect(hits).toContainEqual({ type: 'lineLabel', id: 'fake-name', lineId: 'aarc-line-7', source: 'aarc' })
    expect(hits).toContainEqual({ type: 'aarcTextTag', id: 'free-name' })
  })
  it('supports mouse-only append mode while keeping previous selections', () => {
    const a = { type: 'station' as const, id: 'a' }, b = { type: 'road' as const, id: 'b' }
    expect(mergeMapSelections([a], [a, b], true)).toEqual([a, b])
    expect(mergeMapSelections([a], [b], false)).toEqual([b])
    expect(selectionIdentity(a)).not.toBe(selectionIdentity({ type: 'line', id: 'a' }))
  })
})
