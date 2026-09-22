import { describe, expect, it } from 'vitest'
import { CANVAS_SCENE_BLEED, canvasCameraTransform, prepareRasterSource, preparedRasterMarkupForBounds } from './persistentCanvasRenderer'

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

  it('keeps aspect-fit mapping stable on a non-matching viewport', () => {
    const transform = canvasCameraTransform(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 25, y: 25, width: 50, height: 50 },
      200,
      100,
    )
    expect(transform).toBe('matrix(2, 0, 0, 2, -100, -50)')
  })

  it('strips editor-only and live SVG layers from the retained formal source', () => {
    document.body.innerHTML = '<svg><g data-layer="camera-viewport" transform="matrix(2 0 0 2 1 1)"><g data-layer="canvas-background"><rect/></g><g data-layer="segments"><path class="segment-main"/><path class="segment-hit"/></g><g data-layer="line-legend"><rect/></g><g data-editor="true"><circle/></g></g></svg>'
    const svg = document.querySelector('svg') as SVGSVGElement
    const source = prepareRasterSource(svg)
    expect(source?.markup).toContain('segment-main')
    expect(source?.markup).not.toContain('segment-hit')
    expect(source?.markup).not.toContain('canvas-background')
    expect(source?.markup).not.toContain('line-legend')
    expect(source?.markup).not.toContain('data-editor')
    expect(source?.markup).not.toContain('matrix(2 0 0 2 1 1)')
  })

  it('keeps only buffered-view chunks when cached world bounds are available', () => {
    const source = {
      markup: '<g id="fallback"/>',
      fixedMarkup: '<defs/>',
      chunks: [
        { markup: '<g id="near"/>', bounds: { x: 20, y: 20, width: 10, height: 10 } },
        { markup: '<g id="far"/>', bounds: { x: 800, y: 800, width: 10, height: 10 } },
        { markup: '<g id="unknown"/>' },
      ],
    }
    const markup = preparedRasterMarkupForBounds(source, { x: 0, y: 0, width: 100, height: 100 })
    expect(markup).toContain('near')
    expect(markup).toContain('unknown')
    expect(markup).not.toContain('far')
    expect(markup).toContain('camera-viewport')
  })

  it('falls back to the complete cleaned scene when chunk bounds are unavailable', () => {
    expect(preparedRasterMarkupForBounds({ markup: '<g id="all"/>' }, { x: 0, y: 0, width: 100, height: 100 }))
      .toBe('<g id="all"/>')
  })

  it('uses the same twenty percent bleed as the AARC-inspired viewport cache', () => {
    expect(CANVAS_SCENE_BLEED).toBe(.2)
  })
})
