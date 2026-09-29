import { describe, expect, it } from 'vitest'
import { classifyLeg, reconstructAarcLineGeometry, type AarcGeometryPoint } from '../import-export/aarcGeometry'
import { convertAarcToActualRouteProject } from '../import-export/aarc'
import { getSegmentPathSpans } from './path'
import { moveAarcExplicitControlPoint, reformalizeAarcAfterStationMove } from './aarcEditableGeometry'
import { translateStationWithAnchors } from '../data/stationAnchor'

const raw = {
  cvsSize: [400, 240],
  config: { lineTurnAreaRadius: 30, lineWidth: 14 },
  points: [
    { id: 1, pos: [0, 0], sta: 1, dir: 0, name: 'A' },
    { id: 2, pos: [120, 40], sta: 0, dir: 0 },
    { id: 3, pos: [240, 100], sta: 1, dir: 0, name: 'B' },
    { id: 4, pos: [360, 100], sta: 1, dir: 0, name: 'C' },
  ],
  lines: [{ id: 10, name: 'L', type: 0, pts: [1, 2, 3, 4], color: '#123456', width: 1 }],
}

function expectedInterior(moved: { x: number; y: number }) {
  const source: AarcGeometryPoint[] = [
    { id: 1, x: 0, y: 0, dir: 0, station: true },
    { id: 2, x: moved.x, y: moved.y, dir: 0, station: false },
    { id: 3, x: 240, y: 100, dir: 0, station: true },
    { id: 4, x: 360, y: 100, dir: 0, station: true },
  ]
  const nodes = reconstructAarcLineGeometry(source).nodes
  const from = nodes.findIndex(node => node.sourcePointIndex === 0)
  const to = nodes.findIndex(node => node.sourcePointIndex === 2)
  return nodes.slice(from + 1, to).map(node => [node.x, node.y])
}

describe('editable AARC geometry', () => {
  it('reformalizes derived corners when an explicit AARC control point moves', () => {
    const project = convertAarcToActualRouteProject(raw).project
    const moved = moveAarcExplicitControlPoint(project, 2, { x: 150, y: 25 })
    const segment = moved.geometry.segments.find(item => item.source?.pointIds?.[0] === 1 && item.source?.pointIds?.at(-1) === 3)!
    expect(segment.waypoints.map(point => [point.x, point.y])).toEqual(expectedInterior({ x: 150, y: 25 }))
    expect(segment.waypoints.find(point => point.source?.pointId === 2)).toMatchObject({ x: 150, y: 25 })
    const skeleton = [
      moved.stations.find(station => station.id === segment.fromStationId)!,
      ...segment.waypoints,
      moved.stations.find(station => station.id === segment.toStationId)!,
    ]
    for (let index = 1; index < skeleton.length; index += 1) {
      expect(classifyLeg(skeleton[index - 1], skeleton[index])).not.toBe('invalid')
    }
  })

  it('reformalizes the whole AARC line after a source station moves', () => {
    const project = convertAarcToActualRouteProject(raw).project
    const station = project.stations.find(item => item.source?.pointId === 3)!
    translateStationWithAnchors(project, station.id, 30, 45)
    const moved = reformalizeAarcAfterStationMove(project, station.id)
    const incident = moved.geometry.segments.filter(segment => segment.fromStationId === station.id || segment.toStationId === station.id)
    expect(incident).toHaveLength(2)
    for (const segment of incident) {
      const from = moved.stations.find(item => item.id === segment.fromStationId)!
      const to = moved.stations.find(item => item.id === segment.toStationId)!
      const skeleton = [from, ...segment.waypoints, to]
      for (let index = 1; index < skeleton.length; index += 1) {
        expect(classifyLeg(skeleton[index - 1], skeleton[index])).not.toBe('invalid')
      }
    }
  })

  it('keeps AARC free control points direct while rounding their real angle', () => {
    const freeRaw = {
      ...raw,
      points: [
        { id: 1, pos: [0, 0], sta: 1, dir: 0, name: 'A' },
        { id: 2, pos: [120, 35], sta: 0, dir: 0, free: true },
        { id: 3, pos: [240, 100], sta: 1, dir: 0, name: 'B' },
      ],
      lines: [{ id: 10, name: 'L', type: 0, pts: [1, 2, 3], color: '#123456', width: 1 }],
    }
    const project = convertAarcToActualRouteProject(freeRaw).project
    const segment = project.geometry.segments[0]
    expect(segment.waypoints).toEqual([
      expect.objectContaining({ x: 120, y: 35, free: true, source: expect.objectContaining({ pointId: 2 }) }),
    ])
    const spans = getSegmentPathSpans(project, segment)
    expect(spans.some(span => !span.linear)).toBe(true)
    expect(spans[0].start).toMatchObject({ x: 0, y: 0 })
    expect(spans.at(-1)?.end).toMatchObject({ x: 240, y: 100 })
  })
})
