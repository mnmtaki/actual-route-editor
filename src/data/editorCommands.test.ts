import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import {
  removeBackground,
  setLineBoolean,
  setLineLocked,
  setLineVisibility,
  setLinesBoolean,
  setLinesLocked,
  setLinesVisibility,
} from './editorCommands'

describe('shared editor commands', () => {
  it('applies the same line visibility/lock result for any UI entry point', () => {
    const seed = structuredClone(demoProject)
    const desktopResult = setLineVisibility(seed, 'line-a', false)
    const mobileResult = setLineVisibility(seed, 'line-a', false)
    expect(mobileResult).toEqual(desktopResult)
    expect(desktopResult.lines.find((line) => line.id === 'line-a')?.visible).toBe(false)

    const desktopLocked = setLineLocked(desktopResult, 'line-a', true)
    const mobileLocked = setLineBoolean(mobileResult, 'line-a', 'locked', true)
    expect(mobileLocked).toEqual(desktopLocked)
    expect(desktopLocked.lines.find((line) => line.id === 'line-a')?.locked).toBe(true)
  })

  it('keeps batch operations immutable and deterministic', () => {
    const seed = structuredClone(demoProject)
    const ids = ['line-a', 'line-b']
    const desktop = setLinesVisibility(seed, ids, false)
    const mobile = setLinesBoolean(seed, ids, 'visible', false)
    expect(mobile).toEqual(desktop)
    expect(seed.lines.filter((line) => ids.includes(line.id)).every((line) => line.visible)).toBe(true)

    const locked = setLinesLocked(desktop, ids, true)
    expect(locked.lines.filter((line) => ids.includes(line.id)).every((line) => line.locked)).toBe(true)
    expect(locked.lines.find((line) => line.id === 'line-c')?.locked).toBe(false)
  })

  it('uses one basemap removal command and preserves unrelated project data', () => {
    const seed = structuredClone(demoProject)
    seed.background = { dataUrl: 'data:image/png;base64,AA==', name: 'map.png', x: 1, y: 2, width: 3, height: 4, opacity: .5, visible: true, locked: false }
    const next = removeBackground(seed)
    expect(next.background).toBeNull()
    expect(next.lines).toEqual(seed.lines)
    expect(next.stations).toEqual(seed.stations)
    expect(removeBackground(next)).toBe(next)
  })
})
