import { describe, expect, it } from 'vitest'
import { CANVAS_SCENE_BLEED, canvasCameraTransform } from './persistentCanvasRenderer'

describe('persistent canvas camera', () => {
  const base = { x: 0, y: 0, width: 920, height: 680 }

  it('keeps the retained bitmap stationary at its committed view', () => {
    expect(canvasCameraTransform(base, base, 920, 680)).toBe('none')
  })

  it('maps a centered 2x zoom onto one CSS transform', () => {
    expect(canvasCameraTransform(base, { x: 230, y: 170, width: 460, height: 340 }, 920, 680))
      .toBe('matrix(2, 0, 0, 2, -460, -340)')
  })

  it('maps panning without changing bitmap scale', () => {
    expect(canvasCameraTransform(base, { x: 100, y: 50, width: 920, height: 680 }, 920, 680))
      .toBe('matrix(1, 0, 0, 1, -100, -50)')
  })

  it('uses the same twenty percent bleed as the AARC-inspired viewport cache', () => {
    expect(CANVAS_SCENE_BLEED).toBe(.2)
  })
})
