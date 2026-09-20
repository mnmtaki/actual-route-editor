import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { cloneProjectForDrag } from './dragPreview'

describe('cloneProjectForDrag', () => {
  it('clones only the active Station and its anchored relations', () => {
    const project = structuredClone(demoProject)
    project.stationLineRelations[0].anchor = { x: 12, y: 34 }
    const target = project.stations[0]
    const next = cloneProjectForDrag(project, { kind: 'draggingStation', id: target.id })
    expect(next).not.toBe(project)
    expect(next.stations).not.toBe(project.stations)
    expect(next.stations[0]).not.toBe(project.stations[0])
    expect(next.lines).toBe(project.lines)
    expect(next.geometry).toBe(project.geometry)
    expect(next.stationLineRelations).not.toBe(project.stationLineRelations)
    const untouched = project.stationLineRelations.findIndex(item => item.stationId !== target.id)
    if (untouched >= 0) expect(next.stationLineRelations[untouched]).toBe(project.stationLineRelations[untouched])
  })

  it('clones only the active Segment geometry for a waypoint drag', () => {
    const project = structuredClone(demoProject)
    const segment = project.geometry.segments[0]
    segment.waypoints = [{ id: 'drag-waypoint', x: 1, y: 2, type: 'smooth' }]
    const next = cloneProjectForDrag(project, { kind: 'draggingWaypoint', id: 'drag-waypoint', segmentId: segment.id })
    expect(next.geometry).not.toBe(project.geometry)
    expect(next.geometry.segments[0]).not.toBe(segment)
    expect(next.geometry.segments[0].waypoints[0]).not.toBe(segment.waypoints[0])
    expect(next.stations).toBe(project.stations)
    expect(next.lines).toBe(project.lines)
  })

  it('keeps unrelated collections shared when an imported line label moves', () => {
    const project = structuredClone(demoProject)
    project.textTags = [{ id: 'tag-a', kind: 'LineNameLabel', x: 10, y: 20, lineId: project.lines[0].id }]
    const next = cloneProjectForDrag(project, { kind: 'draggingLineLabel', id: 'tag-a', ownerLineId: project.lines[0].id })
    expect(next.textTags).not.toBe(project.textTags)
    expect(next.textTags![0]).not.toBe(project.textTags![0])
    expect(next.stations).toBe(project.stations)
    expect(next.geometry).toBe(project.geometry)
  })
})
