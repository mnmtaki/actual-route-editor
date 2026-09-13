import { fireEvent, render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { NetworkCanvas } from './NetworkCanvas'

beforeAll(() => {
  class TestPointerEvent extends MouseEvent { pointerId: number; constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } }
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: TestPointerEvent })
  Object.defineProperty(SVGElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } })
})

const baseProps = {
  selection: null,
  drawing: { kind: 'line' as const, lineId: 'line-a', anchorStationId: 's4' },
  onSelect: vi.fn(),
  onCreatePoint: vi.fn(),
  onConnectStation: vi.fn(),
  onExtend: vi.fn(),
  onSegmentPoint: vi.fn(),
  onPreview: vi.fn(),
  onDragCommit: vi.fn(),
  view: { x: 0, y: 0, width: 920, height: 680 },
  setView: vi.fn(),
}

describe('line drawing canvas interaction', () => {
  it('adds a control point at the clicked blank-canvas position and previews the draft smoothly', () => {
    const { container } = render(<NetworkCanvas {...baseProps} project={structuredClone(demoProject)} />)
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const background = container.querySelector('.canvas-bg')!
    fireEvent.pointerDown(background, { pointerId: 51, clientX: 650, clientY: 220, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 51, clientX: 650, clientY: 220, bubbles: true })
    expect(container.querySelectorAll('[data-draft-point-id]')).toHaveLength(1)
    const point = container.querySelector('[data-draft-point-id] circle:nth-of-type(2)')
    expect(point).toHaveAttribute('cx', '650')
    expect(point).toHaveAttribute('cy', '220')
    const previewPath = container.querySelector('[data-layer="line-drawing-overlay"] > path')
    expect(previewPath?.getAttribute('d')).toContain(' C ')
  })

  it('keeps a blank-canvas drag as pan instead of adding a control point', () => {
    const setView = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={structuredClone(demoProject)} setView={setView} />)
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const background = container.querySelector('.canvas-bg')!
    fireEvent.pointerDown(background, { pointerId: 52, clientX: 180, clientY: 160, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 52, clientX: 230, clientY: 190, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 52, clientX: 230, clientY: 190, bubbles: true })
    expect(setView).toHaveBeenCalled()
    expect(container.querySelectorAll('[data-draft-point-id]')).toHaveLength(0)
  })
})
