import { describe, expect, it } from 'vitest'
import { reconstructAarcLineGeometry } from './aarcGeometry'
import { buildAarcStationComponents, createAarcFreeSnapCandidateResolver } from './aarcStationClustering'
import { convertAarcToActualRouteProject } from './aarc'
import { parseProjectJson, serializeProject } from './projectJson'
import { getSegmentPathSpans } from '../geometry/path'

describe('AARC free-point semantics', () => {
  it('keeps an edge adjacent to a free point direct and preserves coordinates', () => {
    const result = reconstructAarcLineGeometry([
      { id: 1, x: 0, y: 0, dir: 0, station: true },
      { id: 2, x: 23, y: 17, dir: 1, station: true, free: true },
      { id: 3, x: 80, y: 17, dir: 0, station: true },
    ])
    expect(result.stats.directLegCount).toBe(2)
    expect(result.nodes.map(node => [node.x, node.y, node.free])).toEqual([[0, 0, undefined], [23, 17, true], [80, 17, undefined]])
  })

  it('clusters free stations when any candidate pair falls inside the AARC clinging radius', () => {
    const points = [{ id: 1, x: 0, y: 0, sourceOrder: 0, free: true }, { id: 2, x: 100, y: 0, sourceOrder: 1, free: true }]
    const memberships = new Map([[1, [1]], [2, [2]]])
    const candidates = (point: { id: number }) => point.id === 1
      ? { candidates: [[0, 0], [50, 0]] as Array<[number, number]> }
      : { candidates: [[100, 0], [50, 0]] as Array<[number, number]> }
    const result = buildAarcStationComponents(points, memberships, { configClingingDist: 25, getSnapSize: () => 1, getSnapCandidates: candidates })
    expect(result.components).toHaveLength(1)
    expect(result.components[0].pointIds).toEqual([1, 2])
  })

  it('generates upstream-style free-point candidates from only the first source-line occurrence', () => {
    const positions = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 0, y: 100 }],
      [3, { x: 100, y: 0 }],
      [4, { x: 0, y: -100 }],
      [5, { x: -100, y: 0 }],
    ])
    const resolver = createAarcFreeSnapCandidateResolver(positions, [{ pts: [2, 1, 3] }, { pts: [4, 1, 5] }], () => 10)
    const info = resolver({ id: 1, x: 0, y: 0, sourceOrder: 0, free: true })
    expect(info.candidates).toEqual(expect.arrayContaining([[0, 0], [10, 10], [-10, -10], [-10, 0], [0, -10]]))
    // Candidates specific to the second occurrence must not leak in.
    expect(info.candidates).not.toContainEqual([10, 0])
    expect(info.bbox!.minX).toBe(-10)
    expect(info.bbox!.maxY).toBe(10)
  })

  it('preserves a free AARC station as Station.free through native JSON roundtrip', () => {
    const raw = {
      cvsSize: [300, 200],
      points: [
        { id: 1, pos: [0, 0], sta: 1, dir: 0, name: 'A' },
        { id: 2, pos: [80, 35], sta: 1, dir: 1, free: true, name: 'B' },
        { id: 3, pos: [160, 0], sta: 1, dir: 0, name: 'C' },
      ],
      lines: [{ id: 10, name: 'L', type: 0, pts: [1, 2, 3], color: '#123456', width: 1 }],
    }
    const project = convertAarcToActualRouteProject(raw).project
    expect(project.stations.find(station => station.source?.pointId === 1)?.free).toBeUndefined()
    expect(project.stations.find(station => station.source?.pointId === 2)?.free).toBe(true)
    expect(project.stations.find(station => station.source?.pointId === 3)?.free).toBeUndefined()

    const restored = parseProjectJson(serializeProject(project))
    expect(restored.stations.find(station => station.source?.pointId === 2)?.free).toBe(true)
  })

  it('marks a canonical clustered Station free when any clustered AARC station point is free', () => {
    const raw = {
      cvsSize: [300, 200],
      config: { snapOctaClingPtPtDist: 25 },
      points: [
        { id: 1, pos: [0, 0], sta: 1, dir: 0, name: 'A' },
        { id: 2, pos: [100, 0], sta: 1, dir: 0, name: 'X' },
        { id: 3, pos: [105, 0], sta: 1, dir: 0, free: true, name: 'X' },
        { id: 4, pos: [200, 0], sta: 1, dir: 0, name: 'B' },
      ],
      lines: [
        { id: 10, name: 'L1', type: 0, pts: [1, 2, 4], color: '#123456', width: 1 },
        { id: 11, name: 'L2', type: 0, pts: [1, 3, 4], color: '#654321', width: 1 },
      ],
    }
    const project = convertAarcToActualRouteProject(raw).project
    const clustered = project.stations.find(station => station.source?.pointIds?.includes(2) && station.source?.pointIds?.includes(3))
    expect(clustered?.free).toBe(true)
  })

  it('rounds a free station continuously across the two AR Segment boundaries', () => {
    const raw = {
      cvsSize: [300, 200],
      config: { lineTurnAreaRadius: 30, lineWidth: 14 },
      points: [
        { id: 1, pos: [0, 0], sta: 1, dir: 0, name: 'A' },
        { id: 2, pos: [80, 35], sta: 1, dir: 1, free: true, name: 'B' },
        { id: 3, pos: [160, 0], sta: 1, dir: 0, name: 'C' },
      ],
      lines: [{ id: 10, name: 'L', type: 0, pts: [1, 2, 3], color: '#123456', width: 1 }],
    }
    const project = convertAarcToActualRouteProject(raw).project
    const [incoming, outgoing] = project.geometry.segments
    expect(incoming.source?.pointIds).toEqual([1, 2])
    expect(outgoing.source?.pointIds).toEqual([2, 3])
    const incomingSpans = getSegmentPathSpans(project, incoming)
    const outgoingSpans = getSegmentPathSpans(project, outgoing)
    const leftHalf = incomingSpans.at(-1)!, rightHalf = outgoingSpans[0]
    expect(leftHalf.linear).toBe(false)
    expect(rightHalf.linear).toBe(false)
    expect(leftHalf.end.x).toBeCloseTo(rightHalf.start.x, 8)
    expect(leftHalf.end.y).toBeCloseTo(rightHalf.start.y, 8)
    const station = project.stations.find(item => item.source?.pointId === 2)!
    expect(Math.hypot(leftHalf.end.x - station.x, leftHalf.end.y - station.y)).toBeGreaterThan(0.1)
  })

  it('also rounds an ordinary non-free AARC station turn instead of leaving a sharp Segment join', () => {
    const raw = {
      cvsSize: [300, 200],
      config: { lineTurnAreaRadius: 30, lineWidth: 14 },
      points: [
        { id: 1, pos: [0, 0], sta: 1, dir: 0, name: 'A' },
        { id: 2, pos: [100, 0], sta: 1, dir: 0, name: 'B' },
        { id: 3, pos: [100, 100], sta: 1, dir: 0, name: 'C' },
      ],
      lines: [{ id: 10, name: 'L', type: 0, pts: [1, 2, 3], color: '#123456', width: 1 }],
    }
    const project = convertAarcToActualRouteProject(raw).project
    const [incoming, outgoing] = project.geometry.segments
    const leftHalf = getSegmentPathSpans(project, incoming).at(-1)!
    const rightHalf = getSegmentPathSpans(project, outgoing)[0]
    expect(leftHalf.linear).toBe(false)
    expect(rightHalf.linear).toBe(false)
    expect(leftHalf.end.x).toBeCloseTo(rightHalf.start.x, 8)
    expect(leftHalf.end.y).toBeCloseTo(rightHalf.start.y, 8)
  })

  it('uses per-source-point free semantics when clustered Stations combine different line occurrences', () => {
    const raw = {
      cvsSize: [400, 240],
      config: { snapOctaClingPtPtDist: 25, lineTurnAreaRadius: 30, lineWidth: 14 },
      points: [
        { id: 1, pos: [0, 0], sta: 1, dir: 0, name: 'A' },
        { id: 2, pos: [100, 0], sta: 1, dir: 0, name: 'X' },
        { id: 3, pos: [105, 0], sta: 1, dir: 0, free: true, name: 'X' },
        { id: 4, pos: [200, 100], sta: 1, dir: 0, name: 'B' },
        { id: 5, pos: [210, 100], sta: 1, dir: 0, name: 'C' },
      ],
      lines: [
        { id: 10, name: 'L1', type: 0, pts: [1, 2, 4], color: '#123456', width: 1 },
        { id: 11, name: 'L2', type: 0, pts: [1, 3, 5], color: '#654321', width: 1 },
      ],
    }
    const project = convertAarcToActualRouteProject(raw).project
    const l1First = project.geometry.segments.find(segment => segment.lineId === 'aarc-line-10' && segment.source?.pointIds?.[1] === 2)!
    const l2First = project.geometry.segments.find(segment => segment.lineId === 'aarc-line-11' && segment.source?.pointIds?.[1] === 3)!
    expect(l1First.source?.pointIds).toEqual([1, 2])
    expect(l2First.source?.pointIds).toEqual([1, 3])
    expect(project.stations.find(station => station.id === l1First.toStationId)?.free).toBe(true)
  })
})
