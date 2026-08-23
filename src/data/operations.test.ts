import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { appendStationToLine, connectExistingStation, createLine, deleteLineAndOrphans, insertStationIntoSegment } from './operations'

describe('line-driven editing operations', () => {
  it('makes the first created station a line member immediately', () => {
    const created = createLine(demoProject, { name: '测试线', color: '#123456', openedAt: '2025-01-01' })
    const result = appendStationToLine(created.project, created.lineId, { x: 10, y: 20 })
    expect(result.project.stationLineRelations.some((relation) => relation.stationId === result.stationId && relation.lineId === created.lineId)).toBe(true)
    expect(result.project.geometry.segments.filter((segment) => segment.lineId === created.lineId)).toHaveLength(0)
  })

  it('creates an extension and a branch from the requested station', () => {
    const extension = appendStationToLine(demoProject, 'line-a', { x: 900, y: 500 }, 's4')
    expect(extension.project.geometry.segments.some((segment) => segment.fromStationId === 's4' && segment.toStationId === extension.stationId)).toBe(true)
    const branch = appendStationToLine(demoProject, 'line-a', { x: 400, y: 600 }, 's2')
    expect(branch.project.geometry.segments.some((segment) => segment.fromStationId === 's2' && segment.toStationId === branch.stationId)).toBe(true)
  })

  it('splits a segment atomically when inserting a station', () => {
    const result = insertStationIntoSegment(demoProject, 'a-1', { x: 280, y: 430 })
    expect(result.project.geometry.segments.some((segment) => segment.id === 'a-1')).toBe(false)
    expect(result.project.geometry.segments.filter((segment) => segment.lineId === 'line-a')).toHaveLength(4)
    expect(result.project.stationLineRelations.some((relation) => relation.stationId === result.stationId && relation.lineId === 'line-a')).toBe(true)
  })

  it('connects an existing station without creating an overlapping station', () => {
    const created = createLine(demoProject, { name: '接入线', color: '#654321' })
    const before = created.project.stations.length
    const connected = connectExistingStation(created.project, created.lineId, 's2')
    expect(connected.stations).toHaveLength(before)
    expect(connected.stationLineRelations.some((relation) => relation.stationId === 's2' && relation.lineId === created.lineId)).toBe(true)
  })

  it('removes zero-line stations when deleting a line', () => {
    const next = deleteLineAndOrphans(demoProject, 'line-a')
    expect(next.stations.some((station) => station.id === 's1')).toBe(false)
    expect(next.stations.some((station) => station.id === 's2')).toBe(true)
    expect(next.stations.every((station) => next.stationLineRelations.some((relation) => relation.stationId === station.id))).toBe(true)
  })
})
