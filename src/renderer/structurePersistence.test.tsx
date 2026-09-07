import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { exportSvg } from '../import-export/svgExport'
import { ContextActions } from '../components/ContextActions'
import { Inspector } from '../components/Inspector'
import { getWaypointStructureChange, setWaypointStructureAfter } from '../data/structure'

describe('segment structure persistence and UI', () => {
  it('defaults old projects to underground and round-trips elevated', () => {
    const old = JSON.parse(serializeProject(demoProject)); delete old.geometry.segments[0].structureType
    expect(parseProjectJson(JSON.stringify(old)).geometry.segments[0].structureType).toBe('underground')
    const elevated = structuredClone(demoProject); elevated.geometry.segments[1].structureType = 'elevated'
    expect(parseProjectJson(serializeProject(elevated)).geometry.segments[1].structureType).toBe('elevated')
  })
  it('preserves formal elevated strokes in SVG but removes editor layers', () => {
    document.body.innerHTML = '<svg><g data-segment-artwork="elevated"><path class="segment-elevated-outer"/><path class="segment-elevated-separator"/><path class="segment-main"/></g><path class="segment-hit"/><g data-editor="true"><circle/></g></svg>'
    const result = exportSvg(document.querySelector('svg')!, true)
    expect(result).toContain('data-segment-artwork="elevated"')
    expect(result).toContain('segment-elevated-outer')
    expect(result).not.toContain('segment-hit')
    expect(result).not.toContain('data-editor')
  })
  it('exposes the structure selector in the shared desktop/mobile context sheet', () => {
    const onStructureChange = vi.fn()
    render(<ContextActions project={demoProject} selection={{ type: 'segment', id: 'a-1' }} onExtend={() => {}} onInsertStation={() => {}} onAddWaypoint={() => {}} onStraighten={() => {}} onStructureChange={onStructureChange} onDelete={() => {}} />)
    fireEvent.change(screen.getByLabelText('线路结构'), { target: { value: 'elevated' } })
    expect(onStructureChange).toHaveBeenCalledWith('elevated')
  })
  it('keeps the control-point structure selector bound to project state across re-renders', () => {
    const seed = structuredClone(demoProject)
    function Harness() {
      const [project, setProject] = useState(seed)
      const segment = project.geometry.segments.find(item => item.id === 'a-1')!
      return <>
        <ContextActions project={project} selection={{ type: 'waypoint', id: 'w1', segmentId: segment.id }} onExtend={() => {}} onInsertStation={() => {}} onAddWaypoint={() => {}} onStraighten={() => {}} onStructureChange={() => {}} onWaypointStructureChange={change => setProject(setWaypointStructureAfter(project, segment.id, 'w1', change))} onDelete={() => {}} />
        <output data-testid="waypoint-structure-value">{getWaypointStructureChange(segment, 'w1')}</output>
      </>
    }
    render(<Harness />)
    const select = screen.getByLabelText('控制点结构变化') as HTMLSelectElement
    expect(select.value).toBe('none')
    fireEvent.change(select, { target: { value: 'elevated' } })
    expect(select.value).toBe('elevated')
    expect(screen.getByTestId('waypoint-structure-value')).toHaveTextContent('elevated')
    fireEvent.change(select, { target: { value: 'underground' } })
    expect(select.value).toBe('underground')
    expect(screen.getByTestId('waypoint-structure-value')).toHaveTextContent('underground')
    fireEvent.change(select, { target: { value: 'none' } })
    expect(select.value).toBe('none')
    expect(screen.getByTestId('waypoint-structure-value')).toHaveTextContent('none')
  })
  it('uses the same persisted structure state in the control-point Inspector', () => {
    const project = structuredClone(demoProject), onChange = vi.fn()
    const view = render(<Inspector project={project} selection={{ type: 'waypoint', id: 'w1', segmentId: 'a-1' }} onChange={onChange} onDelete={() => {}} onPhasePreview={() => {}} onStartPhaseDrawing={() => {}} />)
    const selector = screen.getByLabelText('从此处开始') as HTMLSelectElement
    expect(selector.value).toBe('none')
    fireEvent.change(selector, { target: { value: 'elevated' } })
    const next = onChange.mock.calls.at(-1)?.[0]
    expect(next.geometry.segments.find((item: { id: string }) => item.id === 'a-1').structureNodes[0].structureAfter).toBe('elevated')
    view.rerender(<Inspector project={next} selection={{ type: 'waypoint', id: 'w1', segmentId: 'a-1' }} onChange={onChange} onDelete={() => {}} onPhasePreview={() => {}} onStartPhaseDrawing={() => {}} />)
    expect((screen.getByLabelText('从此处开始') as HTMLSelectElement).value).toBe('elevated')
  })
  it('does not expose ground structure and maps legacy ground values to default underground', () => {
    const segmentProject = structuredClone(demoProject)
    segmentProject.geometry.segments[0].structureType = 'underground'
    segmentProject.geometry.segments[0].structureNodes = [{ id: 'legacy-node', progress: .4, structureAfter: 'underground' }]
    const raw = JSON.parse(serializeProject(segmentProject)) as { geometry: { segments: Array<Record<string, unknown>> } }
    raw.geometry.segments[0].structureType = 'ground'
    raw.geometry.segments[0].structureNodes = [{ id: 'legacy-node', progress: .4, structureAfter: 'ground' }]
    const restored = parseProjectJson(JSON.stringify(raw))
    expect(restored.geometry.segments[0].structureType).toBe('underground')
    expect(restored.geometry.segments[0].structureNodes?.[0].structureAfter).toBe('underground')
    render(<ContextActions project={demoProject} selection={{ type: 'segment', id: 'a-1' }} onExtend={() => {}} onInsertStation={() => {}} onAddWaypoint={() => {}} onStraighten={() => {}} onStructureChange={() => {}} onDelete={() => {}} />)
    expect(screen.queryByText('地面（预留）')).toBeNull()
    expect(screen.queryByText('地面')).toBeNull()
  })
})
