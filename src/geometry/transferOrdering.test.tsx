import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { ActualRouteProject, Line } from '../data/model'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS } from '../data/model'
import { sortTransferLinesForSpatialOrder, analyzeTransferSpatialOrder } from './transferOrdering'
import { StationMarker } from '../renderer/StationMarker'
import rawPinglan from '../import-export/__fixtures__/平岚.aarc (9).json'
import { convertAarcToActualRouteProject } from '../import-export/aarc'

type Axis = 'horizontal' | 'vertical' | 'diagonal'

function parallelProject(axis: Axis, anchors: Array<[number, number]>, reverse = false): { project: ActualRouteProject; lines: Line[] } {
  const station = { id: 'S', name: '换乘站', x: 0, y: 0, labelOffsetX: 0, labelOffsetY: 0 }
  const stations = [station]
  const lines: Line[] = []
  const segments: ActualRouteProject['geometry']['segments'] = []
  const relations = anchors.map(([x, y], index) => {
    const lineId = 'line-' + index, beforeId = lineId + '-before', afterId = lineId + '-after'
    const direction = axis === 'horizontal' ? { x: 1, y: 0 } : axis === 'vertical' ? { x: 0, y: 1 } : { x: Math.SQRT1_2, y: Math.SQRT1_2 }
    const before = { id: beforeId, name: beforeId, x: x - direction.x * 100, y: y - direction.y * 100, labelOffsetX: 0, labelOffsetY: 0 }
    const after = { id: afterId, name: afterId, x: x + direction.x * 100, y: y + direction.y * 100, labelOffsetX: 0, labelOffsetY: 0 }
    stations.push(before, after)
    lines.push({ id: lineId, name: lineId, color: '#000000', stationSequence: reverse ? [afterId, 'S', beforeId] : [beforeId, 'S', afterId], lineOrder: index, visible: true, locked: false })
    const first = { id: lineId + '-before-segment', lineId, fromStationId: beforeId, toStationId: 'S', mode: 'straight' as const, structureType: 'underground' as const, structureNodes: [], waypoints: [] }
    const second = { id: lineId + '-after-segment', lineId, fromStationId: 'S', toStationId: afterId, mode: 'straight' as const, structureType: 'underground' as const, structureNodes: [], waypoints: [] }
    if (reverse) {
      segments.push({ ...first, fromStationId: 'S', toStationId: beforeId }, { ...second, fromStationId: afterId, toStationId: 'S' })
    } else segments.push(first, second)
    return { id: 'relation-' + lineId, stationId: 'S', lineId, openedAt: '2000-01-01', anchor: { x, y } }
  })
  const project: ActualRouteProject = {
    version: 1,
    name: 'transfer ordering',
    stations,
    lines,
    stationLineRelations: relations,
    openingPhases: [],
    geometry: { segments },
    mapElements: [],
    background: null,
    timeline: { currentDate: '2025-01-01', startDate: '2000-01-01', endDate: '2025-01-01', playing: false },
    presentation: { ...DEFAULT_PRESENTATION_SETTINGS, startDate: '2000-01-01', endDate: '2025-01-01' },
    settings: { ...DEFAULT_SETTINGS },
  }
  return { project, lines }
}

function ids(lines: Line[]) { return lines.map(line => line.id) }

describe('parallel transfer spatial ordering', () => {
  it('sorts horizontal lines from screen top to bottom regardless of relation input order', () => {
    const { project, lines } = parallelProject('horizontal', [[0, -20], [0, 20]])
    const input = [lines[1], lines[0]]
    expect(ids(sortTransferLinesForSpatialOrder(project, 'S', input))).toEqual(['line-0', 'line-1'])
    expect(ids(input)).toEqual(['line-1', 'line-0'])
  })

  it('passes the spatial order to the shared editor marker renderer without changing relation data', () => {
    const { project, lines } = parallelProject('horizontal', [[0, -20], [0, 20]])
    lines[0].color = '#AA0000'
    lines[1].color = '#00AA00'
    lines[0].lineOrder = 1
    lines[1].lineOrder = 0
    const relationOrder = project.stationLineRelations.map(relation => relation.lineId)
    const { container } = render(<svg><StationMarker project={project} station={project.stations[0]} time="2025-01-01" selected={false} onPointerDown={() => {}} onLabelPointerDown={() => {}} /></svg>)
    const fills = [...container.querySelectorAll('[data-testid="transfer-S"] circle')].map(dot => dot.getAttribute('fill'))
    expect(fills).toEqual(['#AA0000', '#00AA00'])
    expect(project.stationLineRelations.map(relation => relation.lineId)).toEqual(relationOrder)
  })

  it('sorts vertical lines from screen left to right', () => {
    const { project, lines } = parallelProject('vertical', [[-20, 0], [20, 0]])
    expect(ids(sortTransferLinesForSpatialOrder(project, 'S', [lines[1], lines[0]]))).toEqual(['line-0', 'line-1'])
  })

  it('keeps the same order when traversal direction is reversed', () => {
    const forward = parallelProject('diagonal', [[-20, 20], [20, -20]])
    const reverse = parallelProject('diagonal', [[-20, 20], [20, -20]], true)
    expect(ids(sortTransferLinesForSpatialOrder(forward.project, 'S', forward.lines))).toEqual(['line-1', 'line-0'])
    expect(ids(sortTransferLinesForSpatialOrder(reverse.project, 'S', reverse.lines))).toEqual(['line-1', 'line-0'])
  })

  it('keeps non-parallel crossings in the existing relation order', () => {
    const horizontal = parallelProject('horizontal', [[0, -20]])
    const vertical = parallelProject('vertical', [[20, 0]])
    const project = horizontal.project
    const rename = (id: string) => id === 'S' ? id : id.replace('line-0', 'line-v')
    project.stations.push(...vertical.project.stations.filter(station => station.id !== 'S').map(station => ({ ...station, id: rename(station.id) })))
    project.lines.push({ ...vertical.lines[0], id: 'line-v', stationSequence: vertical.lines[0].stationSequence.map(rename) })
    project.stationLineRelations.push({ ...vertical.project.stationLineRelations[0], lineId: 'line-v' })
    project.geometry.segments.push(...vertical.project.geometry.segments.map(segment => ({ ...segment, id: segment.id.replace('line-0', 'line-v'), lineId: 'line-v', fromStationId: rename(segment.fromStationId), toStationId: rename(segment.toStationId) })))
    const input = [project.lines[1], project.lines[0]]
    expect(analyzeTransferSpatialOrder(project, 'S', input).sortable).toBe(false)
    expect(ids(sortTransferLinesForSpatialOrder(project, 'S', input))).toEqual(['line-v', 'line-0'])
  })

  it('does not sort coincident anchors or anchors separated along the line axis', () => {
    const coincident = parallelProject('horizontal', [[0, 0], [0, 0]])
    const along = parallelProject('horizontal', [[-20, 0], [20, 0]])
    expect(analyzeTransferSpatialOrder(coincident.project, 'S', [coincident.lines[1], coincident.lines[0]]).sortable).toBe(false)
    expect(analyzeTransferSpatialOrder(along.project, 'S', [along.lines[1], along.lines[0]]).sortable).toBe(false)
  })

  it('sorts three parallel lines and rejects a clearly two-dimensional anchor layout', () => {
    const three = parallelProject('horizontal', [[0, -30], [0, 0], [0, 30]])
    expect(ids(sortTransferLinesForSpatialOrder(three.project, 'S', [three.lines[2], three.lines[0], three.lines[1]]))).toEqual(['line-0', 'line-1', 'line-2'])
    const triangle = parallelProject('horizontal', [[-30, -20], [30, 0], [0, 20]])
    const input = [triangle.lines[2], triangle.lines[0], triangle.lines[1]]
    expect(analyzeTransferSpatialOrder(triangle.project, 'S', input).sortable).toBe(false)
    expect(ids(sortTransferLinesForSpatialOrder(triangle.project, 'S', input))).toEqual(['line-2', 'line-0', 'line-1'])
  })

  it('diagnoses the real Pinglan transfer fixture deterministically', () => {
    const project = convertAarcToActualRouteProject(rawPinglan, 'Pinglan fixture').project
    const stationId = 'aarc-station-199'
    const lines = project.stationLineRelations.filter(relation => relation.stationId === stationId).map(relation => project.lines.find(line => line.id === relation.lineId)).filter((line): line is Line => Boolean(line))
    const analysis = analyzeTransferSpatialOrder(project, stationId, lines)
    expect(analysis.sortable).toBe(true)
    expect(analysis.commonTangentDegrees).toBeCloseTo(0)
    expect(analysis.normalSpread).toBeCloseTo(25)
    expect(ids(sortTransferLinesForSpatialOrder(project, stationId, lines))).toEqual(['aarc-line-1228', 'aarc-line-36'])
  })
})
