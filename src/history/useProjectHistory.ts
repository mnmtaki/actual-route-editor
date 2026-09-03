import { useCallback, useState } from 'react'
import type { ActualRouteProject } from '../data/model'

interface HistoryState { past: ActualRouteProject[]; present: ActualRouteProject; future: ActualRouteProject[] }

export function useProjectHistory(initial: ActualRouteProject) {
  const [history, setHistory] = useState<HistoryState>({ past: [], present: initial, future: [] })
  const commit = useCallback((next: ActualRouteProject | ((current: ActualRouteProject) => ActualRouteProject), transient = false, before?: ActualRouteProject) => {
    setHistory((state) => {
      const value = typeof next === 'function' ? next(state.present) : next
      if (value === state.present) return state
      if (transient) return { ...state, present: value }
      if (before) return { past: [...state.past.slice(-79), before], present: value, future: [] }
      return { past: [...state.past.slice(-79), state.present], present: value, future: [] }
    })
  }, [])
  const replace = useCallback((next: ActualRouteProject) => setHistory((state) => ({ ...state, present: next })), [])
  const commitFrom = useCallback((before: ActualRouteProject, next: ActualRouteProject) => {
    setHistory((state) => ({ past: [...state.past.slice(-79), before], present: next, future: [] }))
  }, [])
  const undo = useCallback(() => setHistory((state) => {
    const previous = state.past.at(-1)
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state
  }), [])
  const redo = useCallback(() => setHistory((state) => {
    const next = state.future[0]
    return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state
  }), [])
  return { project: history.present, commit, replace, commitFrom, undo, redo, canUndo: history.past.length > 0, canRedo: history.future.length > 0 }
}
