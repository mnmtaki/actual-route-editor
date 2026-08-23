import type { ActualRouteProject } from './model'
import { DEFAULT_SETTINGS } from './model'

export const demoProject: ActualRouteProject = {
  version: 1,
  name: '澄川市轨道交通',
  stations: [
    { id: 's1', name: '云港', x: 180, y: 430, labelOffsetX: -12, labelOffsetY: 30, openedAt: '2000-01-01' },
    { id: 's2', name: '市民广场', x: 390, y: 350, labelOffsetX: -34, labelOffsetY: -26, openedAt: '2000-01-01', orientationAnchorLineId: 'line-a' },
    { id: 's3', name: '青塔', x: 620, y: 430, labelOffsetX: -16, labelOffsetY: 32, openedAt: '2000-01-01' },
    { id: 's4', name: '临江', x: 820, y: 280, labelOffsetX: 18, labelOffsetY: -14, openedAt: '2000-01-01' },
    { id: 's5', name: '北丘', x: 390, y: 130, labelOffsetX: 20, labelOffsetY: -6, openedAt: '2010-01-01' },
    { id: 's6', name: '南湖', x: 390, y: 610, labelOffsetX: 20, labelOffsetY: 6, openedAt: '2010-01-01' },
    { id: 's7', name: '西林', x: 160, y: 210, labelOffsetX: -12, labelOffsetY: -22, openedAt: '2020-01-01' },
    { id: 's8', name: '东苑', x: 660, y: 210, labelOffsetX: 18, labelOffsetY: -12, openedAt: '2020-01-01' },
  ],
  lines: [
    { id: 'line-a', name: '澄川线', color: '#e54b3f', stationSequence: ['s1', 's2', 's3', 's4'], lineOrder: 0, openedAt: '2000-01-01', visible: true, locked: false },
    { id: 'line-b', name: '南北线', color: '#2e78d2', stationSequence: ['s5', 's2', 's6'], lineOrder: 1, openedAt: '2010-01-01', visible: true, locked: false },
    { id: 'line-c', name: '山湖线', color: '#19a56f', stationSequence: ['s7', 's2', 's8'], lineOrder: 2, openedAt: '2020-01-01', visible: true, locked: false },
  ],
  stationLineRelations: [
    ...['s1', 's2', 's3', 's4'].map((stationId) => ({ id: `r-a-${stationId}`, stationId, lineId: 'line-a', openedAt: '2000-01-01' })),
    ...['s5', 's2', 's6'].map((stationId) => ({ id: `r-b-${stationId}`, stationId, lineId: 'line-b', openedAt: '2010-01-01' })),
    ...['s7', 's2', 's8'].map((stationId) => ({ id: `r-c-${stationId}`, stationId, lineId: 'line-c', openedAt: '2020-01-01' })),
  ],
  geometry: {
    segments: [
      { id: 'a-1', lineId: 'line-a', fromStationId: 's1', toStationId: 's2', mode: 'smooth', waypoints: [{ id: 'w1', x: 300, y: 455, type: 'smooth' }], openedAt: '2000-01-01' },
      { id: 'a-2', lineId: 'line-a', fromStationId: 's2', toStationId: 's3', mode: 'smooth', waypoints: [{ id: 'w2', x: 500, y: 300, type: 'smooth' }], openedAt: '2000-01-01' },
      { id: 'a-3', lineId: 'line-a', fromStationId: 's3', toStationId: 's4', mode: 'smooth', waypoints: [{ id: 'w3', x: 760, y: 430, type: 'smooth' }], openedAt: '2000-01-01' },
      { id: 'b-1', lineId: 'line-b', fromStationId: 's5', toStationId: 's2', mode: 'smooth', waypoints: [], openedAt: '2010-01-01' },
      { id: 'b-2', lineId: 'line-b', fromStationId: 's2', toStationId: 's6', mode: 'smooth', waypoints: [], openedAt: '2010-01-01' },
      { id: 'c-1', lineId: 'line-c', fromStationId: 's7', toStationId: 's2', mode: 'smooth', waypoints: [], openedAt: '2020-01-01' },
      { id: 'c-2', lineId: 'line-c', fromStationId: 's2', toStationId: 's8', mode: 'smooth', waypoints: [{ id: 'w4', x: 525, y: 185, type: 'smooth' }], openedAt: '2020-01-01' },
    ],
  },
  background: null,
  timeline: { currentDate: '2025-01-01', startDate: '2000-01-01', endDate: '2025-01-01', playing: false },
  settings: DEFAULT_SETTINGS,
}
