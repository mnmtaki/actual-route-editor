import { createRef } from 'react'
import { fireEvent, render } from '@testing-library/react'
import { createRef } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { appendBasemapPoint, createBasemapPath } from '../data/basemapPaths'
import { NetworkCanvas, type NetworkCanvasHandle } from './NetworkCanvas'

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
  it('undoes and redoes a draft control-point drag without undoing a station', () => {
    const project = structuredClone(demoProject)
    const ref = createRef<NetworkCanvasHandle>()
    const onDragCommit = vi.fn()
    const onDraftHistoryChange = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} ref={ref} project={project} onDragCommit={onDragCommit} onDraftHistoryChange={onDraftHistoryChange} />)
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const background = container.querySelector('.canvas-bg')!
    fireEvent.pointerDown(background, { pointerId: 181, clientX: 650, clientY: 220, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 181, clientX: 650, clientY: 220, bubbles: true })
    const handle = container.querySelector('[data-draft-point-id]')!
    fireEvent.pointerDown(handle, { pointerId: 182, clientX: 650, clientY: 220, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 182, clientX: 700, clientY: 260, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 182, clientX: 700, clientY: 260, bubbles: true })
    expect(container.querySelector('[data-draft-point-id] circle:nth-of-type(2)')).toHaveAttribute('cx', '700')
    expect(ref.current?.undoDraftEdit()).toBe(true)
    expect(container.querySelector('[data-draft-point-id] circle:nth-of-type(2)')).toHaveAttribute('cx', '650')
    expect(ref.current?.redoDraftEdit()).toBe(true)
    expect(container.querySelector('[data-draft-point-id] circle:nth-of-type(2)')).toHaveAttribute('cx', '700')
    expect(onDragCommit).not.toHaveBeenCalled()
  })
  it('commits the entire pending curve when Finish drawing is invoked, rather than dropping the temporary path', () => {
    const project = structuredClone(demoProject)
    const ref = createRef<NetworkCanvasHandle>()
    const onDragCommit = vi.fn()
    const onSelect = vi.fn()
    const { container, rerender } = render(<NetworkCanvas {...baseProps} project={project} ref={ref} onDragCommit={onDragCommit} onSelect={onSelect} />)
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const background = container.querySelector('.canvas-bg')!
    for (const [id, x, y] of [[81, 650, 210], [82, 760, 280]] as const) {
      fireEvent.pointerDown(background, { pointerId: id, clientX: x, clientY: y, bubbles: true })
      fireEvent.pointerUp(svg, { pointerId: id, clientX: x, clientY: y, bubbles: true })
    }
    expect(container.querySelectorAll('[data-draft-point-id]')).toHaveLength(2)
    expect(ref.current?.hasPendingLineDraft()).toBe(true)
    expect(ref.current?.finalizeLineDraft()).toBe(true)
    expect(onDragCommit).toHaveBeenCalledTimes(1)
    const committed = onDragCommit.mock.calls[0][1] as typeof project
    const newStation = committed.stations.find(station => !project.stations.some(old => old.id === station.id))!
    const newSegment = committed.geometry.segments.find(segment => !project.geometry.segments.some(old => old.id === segment.id))!
    expect(newStation).toMatchObject({ x: 760, y: 280 })
    expect(newSegment).toMatchObject({ fromStationId: 's4', toStationId: newStation.id })
    expect(newSegment.waypoints).toMatchObject([{ x: 650, y: 210 }])
    expect(onSelect).toHaveBeenCalledWith({ type: 'station', id: newStation.id })
    rerender(<NetworkCanvas {...baseProps} project={committed} ref={ref} drawing={null} />)
    expect(container.querySelector('[data-layer="line-drawing-overlay"]')).toBeNull()
    expect(committed.geometry.segments.some(segment => segment.id === newSegment.id)).toBe(true)
  })

  it('finishes immediately without creating a duplicate Station if draft is empty', () => {
    const ref = createRef<NetworkCanvasHandle>()
    const onDragCommit = vi.fn()
    render(<NetworkCanvas {...baseProps} project={structuredClone(demoProject)} ref={ref} onDragCommit={onDragCommit} />)
    expect(ref.current?.hasPendingLineDraft()).toBe(false)
    expect(ref.current?.finalizeLineDraft()).toBe(false)
    expect(onDragCommit).not.toHaveBeenCalled()
  })
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

describe('basemap drawing canvas interaction', () => {
  const makeBasemap = () => {
    const created = createBasemapPath(structuredClone(demoProject), 'terrain')
    return { project: created.project, pathId: created.pathId }
  }

  it('adds a basemap node on blank click but not until pointer up', () => {
    const { project, pathId } = makeBasemap()
    const onCreatePoint = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={project} drawing={{ kind: 'basemap', pathId }} selection={{ type: 'basemapPath', id: pathId }} onCreatePoint={onCreatePoint} />)
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const background = container.querySelector('.canvas-bg')!
    fireEvent.pointerDown(background, { pointerId: 61, clientX: 510, clientY: 310, bubbles: true })
    expect(onCreatePoint).not.toHaveBeenCalled()
    fireEvent.pointerUp(svg, { pointerId: 61, clientX: 510, clientY: 310, bubbles: true })
    expect(onCreatePoint).toHaveBeenCalledWith({ x: 510, y: 310 })
  })

  it('keeps blank drag as pan and does not add a basemap node', () => {
    const { project, pathId } = makeBasemap()
    const onCreatePoint = vi.fn(), setView = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={project} drawing={{ kind: 'basemap', pathId }} selection={{ type: 'basemapPath', id: pathId }} onCreatePoint={onCreatePoint} setView={setView} />)
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const background = container.querySelector('.canvas-bg')!
    fireEvent.pointerDown(background, { pointerId: 62, clientX: 170, clientY: 150, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 62, clientX: 230, clientY: 205, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 62, clientX: 230, clientY: 205, bubbles: true })
    expect(setView).toHaveBeenCalled()
    expect(onCreatePoint).not.toHaveBeenCalled()
  })

  it('allows an existing basemap node to be dragged while the same path is being drawn', () => {
    const created = makeBasemap()
    const project = appendBasemapPoint(created.project, created.pathId, { x: 200, y: 180 })
    const onDragCommit = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={project} drawing={{ kind: 'basemap', pathId: created.pathId }} selection={{ type: 'basemapPath', id: created.pathId }} onDragCommit={onDragCommit} />)
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const pointHit = container.querySelector('[data-basemap-point-id] .basemap-point-hit')!
    fireEvent.pointerDown(pointHit, { pointerId: 63, clientX: 200, clientY: 180, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 63, clientX: 250, clientY: 220, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 63, clientX: 250, clientY: 220, bubbles: true })
    expect(onDragCommit).toHaveBeenCalledTimes(1)
    const next = onDragCommit.mock.calls[0][1]
    expect(next.basemapPaths?.find((path: { id: string }) => path.id === created.pathId)?.points[0]).toMatchObject({ x: 250, y: 220 })
  })
})
