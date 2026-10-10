import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { moveSelectedMapObjects, deleteSelectedMapObjects } from './mapBatchOperations'

describe('map batch movement and deletion', () => {
  it('moves a selected segment with its endpoints and waypoints only once, preserving relative geometry', () => {
    const project = structuredClone(demoProject)
    const seg = project.geometry.segments[0]
    const from = project.stations.find(x => x.id === seg.fromStationId)!
    const to = project.stations.find(x => x.id === seg.toStationId)!
    const moved = moveSelectedMapObjects(project, [
      { type: 'segment', id: seg.id },
      { type: 'station', id: from.id },
    ], 30, -12)
    expect(moved.changed).toBe(true)
    expect(moved.project.stations.find(x => x.id === from.id)?.x).toBe(from.x + 30)
    expect(moved.project.stations.find(x => x.id === from.id)?.y).toBe(from.y - 12)
    expect(moved.project.stations.find(x => x.id === to.id)?.x).toBe(to.x + 30)
    expect(project.stations.find(x => x.id === from.id)?.x).toBe(from.x)
  })
  it('refuses the entire movement and deletion if a shared selected station belongs to a locked line', () => {
    const project = structuredClone(demoProject)
    const station = project.stationLineRelations.find(rel => project.stationLineRelations.some(other => other.stationId === rel.stationId && other.lineId !== rel.lineId))
    if (!station) throw new Error('demo project has no shared station')
    const owner = project.stationLineRelations.find(rel => rel.stationId === station.stationId)!
    project.lines.find(line => line.id === owner.lineId)!.locked = true
    const items = [{ type: 'station' as const, id: station.stationId }]
    const moved = moveSelectedMapObjects(project, items, 10, 10)
    const deleted = deleteSelectedMapObjects(project, items)
    expect(moved.changed).toBe(false)
    expect(deleted.changed).toBe(false)
    expect(moved.project).toBe(project)
    expect(deleted.project).toBe(project)
  })
  it('deletes a selected segment without silently removing all the other segments on its line', () => {
    const project = structuredClone(demoProject)
    const segment = project.geometry.segments[0]
    const before = project.geometry.segments.filter(item => item.lineId === segment.lineId)
    const result = deleteSelectedMapObjects(project, [{ type: 'segment', id: segment.id }])
    expect(result.changed).toBe(true)
    expect(result.project.geometry.segments.some(item => item.id === segment.id)).toBe(false)
    expect(result.project.lines.some(line => line.id === segment.lineId)).toBe(true)
    for (const other of before.slice(1)) expect(result.project.geometry.segments.some(item => item.id === other.id)).toBe(true)
  })
  it('deletes mixed non-network objects in one operation while leaving the original snapshot unchanged', () => {
    const project = structuredClone(demoProject)
    project.mapElements = [{ id: 'text-1', type: 'text', x: 1, y: 2, text: 'Hi', fontSize: 12, fontWeight: 'normal', textAlign: 'start', rotation: 0, visible: true }]
    project.roads = [{ id: 'road-1', points: [{ id: 'point-1', x: 5, y: 6 }, { id: 'point-2', x: 9, y: 10 }], styleId: 'road-local', zIndex: 0, visible: true, locked: false, createdOrder: 0 }]
    const result = deleteSelectedMapObjects(project, [{ type: 'mapElement', id: 'text-1' }, { type: 'road', id: 'road-1' }, { type: 'roadPoint', id: 'point-1', roadId: 'road-1' }])
    expect(result.changed).toBe(true)
    expect(result.project.mapElements).toHaveLength(0)
    expect(result.project.roads).toHaveLength(0)
    expect(project.mapElements).toHaveLength(1)
    expect(project.roads).toHaveLength(1)
  })
})
