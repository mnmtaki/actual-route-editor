import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { createOpeningPhase, getOpeningPhasePathCandidates, updateOpeningPhase } from '../data/openingPhases'
import { useProjectHistory } from './useProjectHistory'

describe('Opening Phase history', () => {
  it('undoes and redoes one phase date change together with every non-overridden member', () => {
    const base=structuredClone(demoProject),path=getOpeningPhasePathCandidates(base,'line-a','s2','s4')[0]
    const created=createOpeningPhase(base,{lineId:'line-a',openedAt:'2026-01-01',path}).project
    const {result}=renderHook(()=>useProjectHistory(created))
    act(()=>result.current.commit(updateOpeningPhase(result.current.project,result.current.project.openingPhases[0].id,{openedAt:'2026-06-28'})))
    expect(result.current.project.geometry.segments.find(item=>item.id==='a-2')?.openedAt).toBe('2026-06-28')
    act(()=>result.current.undo())
    expect(result.current.project.openingPhases[0].openedAt).toBe('2026-01-01')
    expect(result.current.project.geometry.segments.find(item=>item.id==='a-2')?.openedAt).toBe('2026-01-01')
    act(()=>result.current.redo())
    expect(result.current.project.openingPhases[0].openedAt).toBe('2026-06-28')
    expect(result.current.project.geometry.segments.find(item=>item.id==='a-2')?.openedAt).toBe('2026-06-28')
  })
})