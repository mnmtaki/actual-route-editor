import { describe, expect, it } from 'vitest'
import { selectLineInList, selectLinesByMarquee } from './lineSelection'

describe('line list selection', () => {
  const ids = ['a', 'b', 'c', 'd']
  it('selects a single line and tracks its anchor', () => {
    expect(selectLineInList({ lineIds: ids, lineId: 'b', selectedLineIds: [], activeLineId: null, selectionAnchorLineId: null })).toEqual({ selectedLineIds: ['b'], activeLineId: 'b', selectionAnchorLineId: 'b' })
  })
  it('toggles with ctrl and deterministically chooses the remaining active line', () => {
    const added = selectLineInList({ lineIds: ids, lineId: 'c', selectedLineIds: ['a'], activeLineId: 'a', selectionAnchorLineId: 'a', ctrlKey: true })
    expect(added).toEqual({ selectedLineIds: ['a', 'c'], activeLineId: 'c', selectionAnchorLineId: 'c' })
    expect(selectLineInList({ ...added, lineIds: ids, lineId: 'c', ctrlKey: true })).toEqual({ selectedLineIds: ['a'], activeLineId: 'a', selectionAnchorLineId: 'c' })
  })
  it('selects a displayed-order shift range', () => {
    expect(selectLineInList({ lineIds: ids, lineId: 'd', selectedLineIds: ['b'], activeLineId: 'b', selectionAnchorLineId: 'b', shiftKey: true })).toEqual({ selectedLineIds: ['b', 'c', 'd'], activeLineId: 'd', selectionAnchorLineId: 'b' })
  })
  it('replaces or adds marquee hits without treating ids as an ordering key', () => {
    expect(selectLinesByMarquee(ids, ['d', 'b'], [], null, false).selectedLineIds).toEqual(['b', 'd'])
    expect(selectLinesByMarquee(ids, ['d'], ['a'], 'a', true).selectedLineIds).toEqual(['a', 'd'])
  })
})

