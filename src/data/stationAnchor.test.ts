import { describe, expect, it } from 'vitest'
import type { ActualRouteProject } from './model'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS } from './model'
import { getSegmentPath, getSegmentPoints } from '../geometry/path'
import { getStationAnchorForLine, normalizeStationAnchor, translateStationWithAnchors } from './stationAnchor'

const project = (): ActualRouteProject => ({
  version: 1, name: 'anchor',
  stations: [{ id: 'shared', name: '共享站', x: 100, y: 100, labelOffsetX: 0, labelOffsetY: 0 }, { id: 'end', name: '终点', x: 200, y: 100, labelOffsetX: 0, labelOffsetY: 0 }],
  lines: [{ id: 'line-a', name: 'A', color: '#f00', stationSequence: ['shared', 'end'], lineOrder: 0, visible: true, locked: false }, { id: 'line-b', name: 'B', color: '#00f', stationSequence: ['shared', 'end'], lineOrder: 1, visible: true, locked: false }],
  stationLineRelations: [{ id: 'r-a', stationId: 'shared', lineId: 'line-a' }, { id: 'r-b', stationId: 'shared', lineId: 'line-b', anchor: { x: 100, y: 120 } }, { id: 'r-end-a', stationId: 'end', lineId: 'line-a' }, { id: 'r-end-b', stationId: 'end', lineId: 'line-b' }],
  openingPhases: [], geometry: { segments: [{ id: 'seg', lineId: 'line-b', fromStationId: 'shared', toStationId: 'end', mode: 'straight', structureType: 'underground', waypoints: [] }] }, mapElements: [], background: null,
  timeline: { currentDate: '2020-01-01', startDate: '2020-01-01', endDate: '2020-01-01', playing: false }, presentation: { ...DEFAULT_PRESENTATION_SETTINGS, startDate: '2020-01-01', endDate: '2020-01-01' }, settings: { ...DEFAULT_SETTINGS },
})

describe('station line anchors', () => {
  it('resolves a relation anchor per line and falls back to the shared Station position', () => {
    const value = project()
    expect(getStationAnchorForLine(value, 'shared', 'line-a')).toEqual({ x: 100, y: 100 })
    expect(getStationAnchorForLine(value, 'shared', 'line-b')).toEqual({ x: 100, y: 120 })
    expect(getSegmentPoints(value, value.geometry.segments[0])).toEqual([{ x: 100, y: 120 }, { x: 200, y: 100 }])
    expect(getSegmentPath(value, value.geometry.segments[0])).toBe('M 100 120 L 200 100')
  })

  it('normalizes invalid and near-equal anchors without changing source positions', () => {
    expect(normalizeStationAnchor({ x: Number.NaN, y: 2 }, { x: 0, y: 0 })).toBeUndefined()
    expect(normalizeStationAnchor({ x: 1e-8, y: 0 }, { x: 0, y: 0 })).toBeUndefined()
    expect(normalizeStationAnchor({ x: 3, y: 4 }, { x: 0, y: 0 })).toEqual({ x: 3, y: 4 })
  })

  it('moves all line occurrence anchors with one logical Station drag', () => {
    const value = project()
    translateStationWithAnchors(value, 'shared', 7, -3)
    expect(value.stations.find(station => station.id === 'shared')).toMatchObject({ x: 107, y: 97 })
    expect(value.stationLineRelations.find(relation => relation.id === 'r-b')?.anchor).toEqual({ x: 107, y: 117 })
    expect(value.stationLineRelations.find(relation => relation.id === 'r-a')?.anchor).toBeUndefined()
  })
})
