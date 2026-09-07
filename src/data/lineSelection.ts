export interface LineSelectionState {
  selectedLineIds: string[]
  activeLineId: string | null
  selectionAnchorLineId: string | null
}

export interface LineSelectionInput extends LineSelectionState {
  lineIds: string[]
  lineId: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

function ordered(lineIds: string[], ids: Iterable<string>): string[] {
  const wanted = new Set(ids)
  return lineIds.filter(id => wanted.has(id))
}

/** Pure line-list selection reducer. The order always follows the displayed rows. */
export function selectLineInList(input: LineSelectionInput): LineSelectionState {
  const { lineIds, lineId, selectedLineIds, activeLineId, selectionAnchorLineId } = input
  if (!lineIds.includes(lineId)) return { selectedLineIds: [], activeLineId: null, selectionAnchorLineId: null }
  const additive = Boolean(input.ctrlKey || input.metaKey)
  if (input.shiftKey && selectionAnchorLineId && lineIds.includes(selectionAnchorLineId)) {
    const a = lineIds.indexOf(selectionAnchorLineId)
    const b = lineIds.indexOf(lineId)
    const range = lineIds.slice(Math.min(a, b), Math.max(a, b) + 1)
    const next = additive ? ordered(lineIds, [...selectedLineIds, ...range]) : range
    return { selectedLineIds: next, activeLineId: lineId, selectionAnchorLineId }
  }
  if (additive) {
    const nextSet = new Set(selectedLineIds)
    if (nextSet.has(lineId)) nextSet.delete(lineId)
    else nextSet.add(lineId)
    const next = ordered(lineIds, nextSet)
    const nextActive = next.includes(lineId)
      ? lineId
      : (activeLineId && next.includes(activeLineId) ? activeLineId : (next[0] ?? null))
    return { selectedLineIds: next, activeLineId: nextActive, selectionAnchorLineId: lineId }
  }
  return { selectedLineIds: [lineId], activeLineId: lineId, selectionAnchorLineId: lineId }
}

/** Applies a marquee hit set. Shift has no special meaning for marquee. */
export function selectLinesByMarquee(
  lineIds: string[],
  hitLineIds: Iterable<string>,
  currentSelectedLineIds: string[],
  activeLineId: string | null,
  additive: boolean,
): LineSelectionState {
  const next = ordered(lineIds, additive
    ? [...currentSelectedLineIds, ...hitLineIds]
    : hitLineIds)
  const nextActive = activeLineId && next.includes(activeLineId) ? activeLineId : (next[0] ?? null)
  return { selectedLineIds: next, activeLineId: nextActive, selectionAnchorLineId: nextActive }
}

