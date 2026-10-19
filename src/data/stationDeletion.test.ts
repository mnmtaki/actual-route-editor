import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './storage'
import { appendStationToLineWithWaypoints, createLine } from './operations'
import { deleteStationPreservingNetwork } from './stationDeletion'
import { getEditorVisibleStationsAtTime } from '../timeline/active'

function threeStations() {
  const created = createLine(createEmptyProject(), { name: '测试', color: '#44aaff' })
  const one = appendStationToLineWithWaypoints(created.project, created.lineId, { x: 10, y: 20 }, [])
  const two = appendStationToLineWithWaypoints(one.project, created.lineId, { x: 90, y: 120 }, [{ id: 'way-a', x: 50, y: 60 }], one.stationId)
  const three = appendStationToLineWithWaypoints(two.project, created.lineId, { x: 190, y: 220 }, [{ id: 'way-b', x: 140, y: 160 }], two.stationId)
  return { project: three.project, lineId: created.lineId, one: one.stationId, two: two.stationId, three: three.stationId }
}

describe('safe station removal', () => {
  it('removes only middle Station 2 and reconnects Stations 1 and 3 while preserving track geometry', () => {
    const { project, lineId, one, two, three } = threeStations()
    const result = deleteStationPreservingNetwork(project, two)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.reconnected).toBe(true)
    expect(result.project.stations.map(s => s.id)).toEqual([one, three])
    expect(result.project.lines.find(l => l.id === lineId)?.stationSequence).toEqual([one, three])
    const [segment] = result.project.geometry.segments
    expect(result.project.geometry.segments).toHaveLength(1)
    expect(segment).toMatchObject({ fromStationId: one, toStationId: three })
    expect(segment.waypoints.map(w => ({ x: w.x, y: w.y }))).toEqual([{ x: 50, y: 60 }, { x: 90, y: 120 }, { x: 140, y: 160 }])
    expect(getEditorVisibleStationsAtTime(result.project, result.project.timeline.currentDate).map(s => s.id)).toContain(three)
    expect(project.stations).toHaveLength(3)
  })

  it('deletes an endpoint without deleting the other station from storage', () => {
    const { project, one, two, three } = threeStations()
    const result = deleteStationPreservingNetwork(project, three)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.stations.map(s => s.id)).toEqual([one, two])
    expect(result.project.geometry.segments).toHaveLength(1)
  })

  it('keeps lone stations visible in editor after deleting the neighboring terminus', () => {
    const { project, one, two, three } = threeStations()
    const shortened = deleteStationPreservingNetwork(project, three)
    if (!shortened.ok) throw Error(shortened.reason)
    const result = deleteStationPreservingNetwork(shortened.project, two)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.stations.map(s => s.id)).toEqual([one])
    expect(getEditorVisibleStationsAtTime(result.project, result.project.timeline.currentDate).map(s => s.id)).toContain(one)
  })

  it('refuses to merge different structure styles without modifying the project', () => {
    const { project, two } = threeStations()
    project.geometry.segments[1].structureType = 'elevated'
    const snapshot = JSON.stringify(project)
    const result = deleteStationPreservingNetwork(project, two)
    expect(result.ok).toBe(false)
    expect(result.project).toBe(project)
    expect(JSON.stringify(project)).toBe(snapshot)
  })

  it('refuses a branching station without deleting any adjacent station', () => {
    const { project, lineId, one, two, three } = threeStations()
    const more = appendStationToLineWithWaypoints(project, lineId, { x: 250, y: 70 }, [], two)
    const result = deleteStationPreservingNetwork(more.project, two)
    expect(result.ok).toBe(false)
    expect(result.project.stations.some(s => s.id === three)).toBe(true)
    expect(result.project.stations.some(s => s.id === one)).toBe(true)
  })

  it('refuses shared-line stations, avoiding accidental deletion of transfers', () => {
    const { project, two } = threeStations()
    const extra = createLine(project, { name: '第二线', color: '#dd3322' })
    extra.project.stationLineRelations.push({ id: 'transfer', stationId: two, lineId: extra.lineId, openedAt: null, closedAt: null })
    const result = deleteStationPreservingNetwork(extra.project, two)
    expect(result.ok).toBe(false)
    expect(result.project.stations.some(s => s.id === two)).toBe(true)
  })
})
