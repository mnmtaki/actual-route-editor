import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { exportSvg } from '../import-export/svgExport'
import { ContextActions } from '../components/ContextActions'
import { Inspector } from '../components/Inspector'

describe('segment structure persistence and style-point UI', () => {
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
  it('exposes a style-point action instead of a directional structure selector', () => {
    const onStylePoint = vi.fn()
    render(<ContextActions project={demoProject} selection={{ type: 'segment', id: 'a-1', progress: .5 }} onExtend={() => {}} onInsertStation={() => {}} onAddWaypoint={() => {}} onStraighten={() => {}} onStructureChange={() => {}} onSetStructureAtPoint={onStylePoint} onDelete={() => {}} />)
    screen.getByRole('button', { name: '＋样式点' }).click()
    expect(onStylePoint).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('线路结构')).toBeNull()
  })
  it('keeps control-point actions geometry-only', () => {
    const segment = demoProject.geometry.segments.find(item => item.id === 'a-1')!
    render(<ContextActions project={demoProject} selection={{ type: 'waypoint', id: 'w1', segmentId: segment.id }} onExtend={() => {}} onInsertStation={() => {}} onAddWaypoint={() => {}} onStraighten={() => {}} onStructureChange={() => {}} onWaypointStructureChange={() => {}} onDelete={() => {}} />)
    expect(screen.getByText(/拖动控制点改变线路形状/)).toBeTruthy()
    expect(screen.queryByLabelText('控制点结构变化')).toBeNull()
  })
  it('keeps the control-point Inspector free of style direction controls', () => {
    const project = structuredClone(demoProject), onChange = vi.fn()
    render(<Inspector project={project} selection={{ type: 'waypoint', id: 'w1', segmentId: 'a-1' }} onChange={onChange} onDelete={() => {}} onPhasePreview={() => {}} onStartPhaseDrawing={() => {}} />)
    expect(screen.getByRole('heading', { name: '控制点' })).toBeTruthy()
    expect(screen.getByLabelText('点类型')).toBeTruthy()
    expect(screen.getByText(/控制点只改变线路形状/)).toBeTruthy()
    expect(screen.queryByLabelText('从此处开始')).toBeNull()
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
