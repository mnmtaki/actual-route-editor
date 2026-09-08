import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS, type ActualRouteProject } from '../data/model'
import { parseProjectJson, serializeProject } from './projectJson'

const base = (): ActualRouteProject => ({
  version: 1, name: 'json-anchor',
  stations: [{ id: 's', name: '站', x: 10, y: 20, labelOffsetX: 0, labelOffsetY: 0 }, { id: 't', name: '终', x: 100, y: 20, labelOffsetX: 0, labelOffsetY: 0 }],
  lines: [{ id: 'l', name: '1', color: '#111111', stationSequence: ['s', 't'], lineOrder: 0, visible: true, locked: false }],
  stationLineRelations: [{ id: 'r-s', stationId: 's', lineId: 'l', anchor: { x: 12, y: 23 } }, { id: 'r-t', stationId: 't', lineId: 'l' }], openingPhases: [],
  geometry: { segments: [{ id: 'seg', lineId: 'l', fromStationId: 's', toStationId: 't', mode: 'straight', structureType: 'underground', waypoints: [] }] }, mapElements: [], background: null,
  timeline: { currentDate: '2020-01-01', startDate: '2020-01-01', endDate: '2020-01-01', playing: false }, presentation: { ...DEFAULT_PRESENTATION_SETTINGS, startDate: '2020-01-01', endDate: '2020-01-01' }, settings: { ...DEFAULT_SETTINGS },
})

describe('station anchor JSON compatibility', () => {
  it('round-trips valid anchors and omits near-equal anchors', () => {
    const restored = parseProjectJson(serializeProject(base()))
    expect(restored.stationLineRelations[0].anchor).toEqual({ x: 12, y: 23 })
    const nearEqual = JSON.parse(serializeProject(base()))
    nearEqual.stationLineRelations[0].anchor = { x: 10.00000001, y: 20 }
    expect(parseProjectJson(JSON.stringify(nearEqual)).stationLineRelations[0].anchor).toBeUndefined()
  })

  it('drops invalid anchors while keeping legacy relations loadable', () => {
    const raw = JSON.parse(serializeProject(base()))
    raw.stationLineRelations[0].anchor = { x: 'bad', y: Infinity }
    const restored = parseProjectJson(JSON.stringify(raw))
    expect(restored.stationLineRelations[0]).not.toHaveProperty('anchor')
  })
})
