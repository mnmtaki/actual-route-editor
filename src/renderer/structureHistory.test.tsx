import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { useProjectHistory } from '../history/useProjectHistory'

describe('segment structure history', () => {
  it('undoes and redoes a structure change as one history action', () => {
    const { result } = renderHook(() => useProjectHistory(demoProject))
    act(() => result.current.commit(current => { const next = structuredClone(current); next.geometry.segments[0].structureType = 'elevated'; return next }))
    expect(result.current.project.geometry.segments[0].structureType).toBe('elevated')
    act(() => result.current.undo())
    expect(result.current.project.geometry.segments[0].structureType).toBe('underground')
    act(() => result.current.redo())
    expect(result.current.project.geometry.segments[0].structureType).toBe('elevated')
  })
})
