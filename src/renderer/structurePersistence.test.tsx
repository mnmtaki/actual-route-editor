import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { exportSvg } from '../import-export/svgExport'
import { ContextActions } from '../components/ContextActions'

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
})
