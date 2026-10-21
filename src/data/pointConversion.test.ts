import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './storage'
import { appendStationToLineWithWaypoints, createLine } from './operations'
import { convertStationToWaypoint, convertWaypointToStation } from './pointConversion'

function sample() {
  const created = createLine(createEmptyProject(), { name: '双向转换', color: '#229977' })
  const a = appendStationToLineWithWaypoints(created.project, created.lineId, { x: 0, y: 0 }, [])
  const b = appendStationToLineWithWaypoints(a.project, created.lineId, { x: 400, y: 200 }, [
    { id: 'left', x: 80, y: 25 },
    { id: 'middle', x: 200, y: 70 },
    { id: 'right', x: 300, y: 150 },
  ], a.stationId)
  return { project: b.project, lineId: created.lineId, first: a.stationId, last: b.stationId, segmentId: b.segmentId! }
}

describe('committed Station / control-point conversions', () => {
  it('converts selected existing waypoint without adding a duplicate control point', () => {
    const { project, lineId, first, last, segmentId } = sample()
    const snapshot = structuredClone(project)
    const result = convertWaypointToStation(project, segmentId, 'middle')
    expect(result.ok).toBe(true)
    if (!result.ok || result.selection.type !== 'station') return
    const id = result.selection.id
    expect(result.project.lines.find(line => line.id === lineId)?.stationSequence).toEqual([first, id, last])
    expect(result.project.stations.find(st => st.id === id)).toMatchObject({ x: 200, y: 70 })
    const [part1, part2] = result.project.geometry.segments
    expect(part1).toMatchObject({ fromStationId: first, toStationId: id, mode: 'smooth' })
    expect(part2).toMatchObject({ fromStationId: id, toStationId: last, mode: 'smooth' })
    expect(part1.waypoints.map(p => p.id)).toEqual(['left'])
    expect(part2.waypoints.map(p => p.id)).toEqual(['right'])
    expect(result.project.geometry.segments.flatMap(seg => seg.waypoints).map(w => w.id)).not.toContain('middle')
    expect(project).toEqual(snapshot)
  })

  it('converts a normal middle station back into a selected waypoint, preserving curve points', () => {
    const { project, first, last, segmentId } = sample()
    const intermediate = convertWaypointToStation(project, segmentId, 'middle')
    if (!intermediate.ok || intermediate.selection.type !== 'station') throw Error('split failed')
    const originalStationId = intermediate.selection.id
    const restored = convertStationToWaypoint(intermediate.project, originalStationId)
    expect(restored.ok).toBe(true)
    if (!restored.ok || restored.selection.type !== 'waypoint') return
    expect(restored.project.stations.map(st => st.id)).toEqual([first, last])
    expect(restored.project.geometry.segments).toHaveLength(1)
    expect(restored.project.geometry.segments[0].waypoints.map(p => [p.x, p.y])).toEqual([
      [80, 25], [200, 70], [300, 150],
    ])
    expect(restored.project.geometry.segments[0].id).toBe(restored.selection.segmentId)
  })

  it('preserves line, structure and time attributes on two split segments', () => {
    const { project, segmentId } = sample()
    const source = project.geometry.segments[0]
    source.lineStyleId = 'style-1'
    source.structureType = 'elevated'
    source.openedAt = '2026-01-01'
    source.closedAt = '2040-01-01'
    const converted = convertWaypointToStation(project, segmentId, 'middle')
    expect(converted.ok).toBe(true)
    if (!converted.ok) return
    for (const segment of converted.project.geometry.segments) {
      expect(segment).toMatchObject({ lineStyleId: 'style-1', structureType: 'elevated', openedAt: '2026-01-01', closedAt: '2040-01-01' })
    }
  })

  it('blocks locked and referenced segments without mutating the project', () => {
    const { project, lineId, segmentId } = sample()
    const locked = structuredClone(project)
    locked.lines.find(line => line.id === lineId)!.locked = true
    const noLock = convertWaypointToStation(locked, segmentId, 'middle')
    expect(noLock.ok).toBe(false)
    expect(noLock.project).toBe(locked)
    const stage = structuredClone(project)
    stage.openingPhases.push({ id: 'phase1', lineId, name: '一期', openedAt: '2026-01-01', segmentIds: [segmentId], stationRelationIds: [] })
    const snapshot = structuredClone(stage)
    const noStage = convertWaypointToStation(stage, segmentId, 'middle')
    expect(noStage.ok).toBe(false)
    expect(stage).toEqual(snapshot)
    expect(noStage.project).toBe(stage)
  })

  it('blocks waypoint conversion if it carries style point attachments', () => {
    const { project, segmentId } = sample()
    project.geometry.segments[0].structureNodes = [{ id: 'style-node', structureAfter: 'elevated', waypointId: 'middle' }]
    expect(convertWaypointToStation(project, segmentId, 'middle').ok).toBe(false)
  })

  it('blocks demotion of endpoints, interchanges and incompatible adjacent segments', () => {
    const { project, last, segmentId } = sample()
    expect(convertStationToWaypoint(project, last).ok).toBe(false)
    const firstSplit = convertWaypointToStation(project, segmentId, 'middle')
    if (!firstSplit.ok || firstSplit.selection.type !== 'station') throw Error('split failed')
    const id = firstSplit.selection.id
    const differentlyStyled = structuredClone(firstSplit.project)
    differentlyStyled.geometry.segments[0].structureType = 'elevated'
    expect(convertStationToWaypoint(differentlyStyled, id).ok).toBe(false)
    const transfer = structuredClone(firstSplit.project)
    const another = createLine(transfer, { name: '换乘线', color: '#ffcc22' })
    another.project.stationLineRelations.push({ id: 'transfer', lineId: another.lineId, stationId: id, openedAt: null, closedAt: null })
    expect(convertStationToWaypoint(another.project, id).ok).toBe(false)
  })
})
