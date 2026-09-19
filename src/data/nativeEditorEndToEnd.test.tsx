import { act, render, renderHook } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createEmptyProject } from './storage'
import {
  addWaypointToSegment,
  appendStationToLine,
  connectExistingStation,
  createLine,
} from './operations'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { compilePresentation } from '../presentation/compiler'
import { PresentationScene } from '../presentation/PresentationScene'
import { NetworkCanvas } from '../renderer/NetworkCanvas'
import { exportSvg } from '../import-export/svgExport'
import { useProjectHistory } from '../history/useProjectHistory'
import { getPassengerStationCountForLine } from './passengerStats'

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } })
})

const canvasProps = {
  selection: null,
  drawing: null,
  onSelect: vi.fn(),
  onCreatePoint: vi.fn(),
  onConnectStation: vi.fn(),
  onExtend: vi.fn(),
  onSegmentPoint: vi.fn(),
  onPreview: vi.fn(),
  onDragCommit: vi.fn(),
  view: { x: 0, y: 0, width: 1000, height: 700 },
  setView: vi.fn(),
}

describe('native editor end-to-end workflow', () => {
  it('survives a realistic create-edit-branch-transfer-history-save-export-presentation chain', () => {
    let project = createEmptyProject()
    project.name = '原生编辑全链路'
    project.timeline = { currentDate: '2026-01-01', startDate: '2026-01-01', endDate: '2026-01-01', playing: false }
    project.presentation = { ...project.presentation, startDate: '2026-01-01', endDate: '2026-01-01', cameraMode: 'fixed' }

    // 1) New main line and three stations.
    const mainCreated = createLine(project, { name: '主线', color: '#1566D2', openedAt: '2026-01-01' })
    project = mainCreated.project
    const s1 = appendStationToLine(project, mainCreated.lineId, { x: 120, y: 180 })
    project = s1.project
    const s2 = appendStationToLine(project, mainCreated.lineId, { x: 420, y: 220 }, s1.stationId)
    project = s2.project
    const s3 = appendStationToLine(project, mainCreated.lineId, { x: 760, y: 180 }, s2.stationId)
    project = s3.project

    expect(project.lines.find(line => line.id === mainCreated.lineId)?.stationSequence).toEqual([s1.stationId, s2.stationId, s3.stationId])
    expect(project.geometry.segments.filter(segment => segment.lineId === mainCreated.lineId)).toHaveLength(2)

    // 2) Add a control point, then edit it exactly the way Inspector does.
    const firstMainSegment = project.geometry.segments.find(segment => segment.lineId === mainCreated.lineId && segment.fromStationId === s1.stationId)!
    const waypointResult = addWaypointToSegment(project, firstMainSegment.id, { x: 280, y: 330 })
    project = waypointResult.project
    const roundedSegment = project.geometry.segments.find(segment => segment.id === firstMainSegment.id)!
    roundedSegment.mode = 'rounded'
    const corner = roundedSegment.waypoints.find(point => point.id === waypointResult.waypointId)!
    corner.type = 'corner'
    corner.cornerRadius = 36

    // 3) Draw a geometric branch from the middle station on the same line.
    const branch = appendStationToLine(project, mainCreated.lineId, { x: 520, y: 520 }, s2.stationId)
    project = branch.project
    expect(project.geometry.segments.some(segment => segment.lineId === mainCreated.lineId && segment.fromStationId === s2.stationId && segment.toStationId === branch.stationId)).toBe(true)

    // 4) Create a second line and connect existing stations to form transfers.
    const secondCreated = createLine(project, { name: '换乘线', color: '#207C45', openedAt: '2026-01-01' })
    project = secondCreated.project
    project = connectExistingStation(project, secondCreated.lineId, s2.stationId)
    const secondOwn = appendStationToLine(project, secondCreated.lineId, { x: 420, y: 560 }, s2.stationId)
    project = secondOwn.project
    project = connectExistingStation(project, secondCreated.lineId, s3.stationId, secondOwn.stationId)

    expect(project.stationLineRelations.filter(relation => relation.stationId === s2.stationId)).toHaveLength(2)
    expect(project.stationLineRelations.filter(relation => relation.stationId === s3.stationId)).toHaveLength(2)
    expect(getPassengerStationCountForLine(project, mainCreated.lineId)).toBe(4)
    expect(getPassengerStationCountForLine(project, secondCreated.lineId)).toBe(3)

    // 5) History: move one station, undo it, then redo it.
    const beforeMove = project
    const moved = structuredClone(project)
    const movedStation = moved.stations.find(station => station.id === s2.stationId)!
    movedStation.x += 55
    movedStation.y -= 30
    const { result } = renderHook(() => useProjectHistory(beforeMove))
    act(() => result.current.commit(moved))
    expect(result.current.project.stations.find(station => station.id === s2.stationId)).toMatchObject({ x: 475, y: 190 })
    act(() => result.current.undo())
    expect(result.current.project.stations.find(station => station.id === s2.stationId)).toMatchObject({ x: 420, y: 220 })
    act(() => result.current.redo())
    project = result.current.project
    expect(project.stations.find(station => station.id === s2.stationId)).toMatchObject({ x: 475, y: 190 })

    // 6) Native project save/reopen keeps graph topology and local corner geometry.
    const restored = parseProjectJson(serializeProject(project))
    expect(restored.lines).toEqual(project.lines)
    expect(restored.stationLineRelations).toEqual(project.stationLineRelations)
    expect(restored.geometry.segments).toEqual(project.geometry.segments)
    const restoredCorner = restored.geometry.segments.find(segment => segment.id === firstMainSegment.id)?.waypoints.find(point => point.id === waypointResult.waypointId)
    expect(restoredCorner).toMatchObject({ type: 'corner', cornerRadius: 36, x: 280, y: 330 })

    // 7) Formal editor SVG exports without editor-only hit targets.
    const canvas = render(<NetworkCanvas {...canvasProps} project={restored} />)
    const svg = canvas.container.querySelector('svg')!
    const exported = exportSvg(svg, false)
    expect(exported).toContain('data-export-view-box')
    expect(exported).not.toContain('segment-hit')
    expect(exported).not.toContain('data-editor="true"')
    expect(exported).not.toMatch(/\bNaN\b|\bInfinity\b/)
    canvas.unmount()

    // 8) Presentation compiles and renders the same saved project without invalid geometry.
    const sequence = compilePresentation(restored)
    expect(Number.isFinite(sequence.duration)).toBe(true)
    const presentation = render(<PresentationScene project={restored} sequence={sequence} time={sequence.duration} width={1280} height={720} />)
    const presentationSvg = presentation.container.querySelector('svg.presentation-scene')!
    expect(presentationSvg).toBeTruthy()
    expect(presentationSvg.outerHTML).not.toMatch(/\bNaN\b|\bInfinity\b/)
    expect(presentationSvg.querySelector('[data-presentation-layer="segments"]')).toBeTruthy()
    expect(presentationSvg.querySelector('[data-presentation-layer="stations"]')).toBeTruthy()
  })
})
