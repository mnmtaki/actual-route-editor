import { describe, expect, it } from 'vitest'
import type { ActualRouteProject, Segment } from './model'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS } from './model'
import { getLineStationSpacings, getSegmentDistanceKilometers, getSegmentDistanceMeters, getSegmentDistanceWorld } from './stationSpacing'
import { serializeProject } from '../import-export/projectJson'

const projectFor = (stations: Array<[string, number, number]>, sequence: string[], segments: Segment[], lineId = 'L1'): ActualRouteProject => ({
  version: 1,
  name: 'spacing-test',
  stations: stations.map(([id, x, y]) => ({ id, name: id, x, y, labelOffsetX: 10, labelOffsetY: -10 })),
  lines: [{ id: lineId, name: lineId, color: '#d33', stationSequence: sequence, lineOrder: 0, openedAt: '2020-01-01', visible: true, locked: false }],
  stationLineRelations: sequence.map(stationId => ({ id: `${lineId}-${stationId}`, stationId, lineId, openedAt: '2020-01-01' })),
  openingPhases: [],
  geometry: { segments },
  background: null,
  mapElements: [],
  timeline: { currentDate: '2020-01-01', startDate: '2020-01-01', endDate: '2020-01-01', playing: false },
  presentation: { ...DEFAULT_PRESENTATION_SETTINGS, startDate: '2020-01-01', endDate: '2020-01-01' },
  settings: { ...DEFAULT_SETTINGS },
})

const straight = (id: string, from: string, to: string): Segment => ({ id, lineId: 'L1', fromStationId: from, toStationId: to, mode: 'straight', structureType: 'underground', waypoints: [] })

describe('derived station spacing', () => {
  it('uses the real Segment path and converts with distanceScale', () => {
    const project = projectFor([['A', 0, 0], ['B', 100, 0]], ['A', 'B'], [straight('AB', 'A', 'B')])
    project.distanceScale = { metersPerWorldUnit: 10 }
    expect(getSegmentDistanceWorld(project, 'AB')).toBe(100)
    expect(getSegmentDistanceMeters(project, 'AB')).toBe(1000)
    expect(getSegmentDistanceKilometers(project, 'AB')).toBe(1)
    expect(getLineStationSpacings(project, 'L1')).toEqual([{ lineId: 'L1', segmentId: 'AB', fromStationId: 'A', toStationId: 'B', distanceWorld: 100, distanceMeters: 1000, distanceKilometers: 1 }])
  })

  it('follows a curved/waypoint path instead of endpoint Euclidean distance', () => {
    const segment = straight('AB', 'A', 'B'); segment.mode = 'smooth'; segment.waypoints = [{ id: 'W', x: 50, y: 50, type: 'smooth' }]
    const project = projectFor([['A', 0, 0], ['B', 100, 0]], ['A', 'B'], [segment])
    const spacing = getLineStationSpacings(project, 'L1')[0]
    expect(spacing.distanceWorld).toBeGreaterThan(100)
    expect(spacing.distanceWorld).toBe(getSegmentDistanceWorld(project, segment))
  })

  it('keeps station order and includes a topology-confirmed ring closing pair', () => {
    const project = projectFor([['A', 0, 0], ['B', 100, 0], ['C', 100, 100], ['D', 0, 100]], ['A', 'B', 'C', 'D'], [straight('AB', 'A', 'B'), straight('BC', 'B', 'C'), straight('CD', 'C', 'D'), straight('DA', 'D', 'A')])
    const spacings = getLineStationSpacings(project, 'L1')
    expect(spacings.map(item => `${item.fromStationId}-${item.toStationId}`)).toEqual(['A-B', 'B-C', 'C-D', 'D-A'])
    expect(spacings).toHaveLength(4)
  })

  it('returns empty for zero or one station and rejects missing geometry', () => {
    const empty = projectFor([], [], [])
    expect(getLineStationSpacings(empty, 'L1')).toEqual([])
    const single = projectFor([['A', 0, 0]], ['A'], [])
    expect(getLineStationSpacings(single, 'L1')).toEqual([])
    const broken = projectFor([['A', 0, 0], ['B', 100, 0]], ['A', 'B'], [])
    expect(() => getLineStationSpacings(broken, 'L1')).toThrow('缺少')
  })

  it('keeps shared stations and parallel line geometry independent', () => {
    const project = projectFor([['A', 0, 0], ['X', 100, 0], ['B', 100, 100]], ['A', 'X'], [straight('L1-AX', 'A', 'X')])
    project.lines.push({ id: 'L3', name: 'L3', color: '#35c', stationSequence: ['A', 'X'], lineOrder: 1, openedAt: '2020-01-01', visible: true, locked: false })
    project.stationLineRelations.push({ id: 'L3-A', stationId: 'A', lineId: 'L3', openedAt: '2020-01-01' }, { id: 'L3-X', stationId: 'X', lineId: 'L3', openedAt: '2020-01-01' })
    project.geometry.segments.push({ ...straight('L3-AX', 'A', 'X'), lineId: 'L3', mode: 'smooth', waypoints: [{ id: 'curve', x: 50, y: 50, type: 'smooth' }] })
    const one = getLineStationSpacings(project, 'L1')[0], three = getLineStationSpacings(project, 'L3')[0]
    expect(one.segmentId).toBe('L1-AX')
    expect(three.segmentId).toBe('L3-AX')
    expect(three.distanceWorld).toBeGreaterThan(one.distanceWorld)
  })

  it('derives again after geometry, station, scale, style, or structure changes', () => {
    const segment = straight('AB', 'A', 'B')
    const project = projectFor([['A', 0, 0], ['B', 100, 0]], ['A', 'B'], [segment])
    const before = getLineStationSpacings(project, 'L1')[0]
    segment.mode = 'smooth'; segment.waypoints = [{ id: 'W', x: 50, y: 60, type: 'smooth' }]
    const afterGeometry = getLineStationSpacings(project, 'L1')[0]
    expect(afterGeometry.distanceWorld).toBeGreaterThan(before.distanceWorld)
    project.stations.find(item => item.id === 'B')!.x = 120
    const afterStation = getLineStationSpacings(project, 'L1')[0]
    expect(afterStation.distanceWorld).not.toBe(afterGeometry.distanceWorld)
    project.distanceScale = { metersPerWorldUnit: 20 }
    expect(getLineStationSpacings(project, 'L1')[0].distanceWorld).toBe(afterStation.distanceWorld)
    expect(getLineStationSpacings(project, 'L1')[0].distanceMeters).toBe(afterStation.distanceWorld * 20)
    segment.structureType = 'elevated'; segment.structureNodes = [{ id: 'node', progress: .5, structureAfter: 'elevated' }]
    project.lines[0].locked = true
    project.lines[0].visible = false
    expect(getLineStationSpacings(project, 'L1')[0].distanceWorld).toBe(afterStation.distanceWorld)
  })

  it('sums to the same current Segment-length truth and adds no derived JSON fields', () => {
    const project = projectFor([['A', 0, 0], ['B', 100, 0], ['C', 180, 50]], ['A', 'B', 'C'], [straight('AB', 'A', 'B'), straight('BC', 'B', 'C')])
    const spacings = getLineStationSpacings(project, 'L1')
    expect(spacings.reduce((sum, item) => sum + item.distanceWorld, 0)).toBeCloseTo(project.geometry.segments.reduce((sum, segment) => sum + getSegmentDistanceWorld(project, segment), 0))
    const saved = JSON.parse(serializeProject(project)) as Record<string, unknown>
    expect(saved).not.toHaveProperty('stationSpacings')
    expect(JSON.stringify(saved)).not.toMatch(/distanceMeters|distanceKilometers|cachedLength/)
  })
})
