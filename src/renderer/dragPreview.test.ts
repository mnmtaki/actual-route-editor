import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { cloneProjectForDrag, dragTouchesVectorBasemap, getDragAffectedLineIds, getDragLineLabelOverlay, getDragMapElementOverlay, getDragStationOverlay, getDragVectorBasemapOverlay } from './dragPreview'

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
  it('scopes station drags to their connected line artwork and station overlay', () => {
    const project = structuredClone(demoProject)
    const station = project.stations.find(item => item.id === 's2')!
    const lineIds = getDragAffectedLineIds(project, { kind: 'draggingStation', id: station.id })
    expect(lineIds.size).toBeGreaterThan(0)
    for (const segment of project.geometry.segments.filter(segment => segment.fromStationId === station.id || segment.toStationId === station.id)) {
      expect(lineIds.has(segment.lineId)).toBe(true)
    }
    expect(getDragStationOverlay(project, { kind: 'draggingStation', id: station.id })).toEqual({
      stationIds: new Set([station.id]),
      markers: true,
      labels: true,
    })
    expect(getDragStationOverlay(project, { kind: 'draggingLabel', id: station.id })).toEqual({
      stationIds: new Set([station.id]),
      markers: false,
      labels: true,
    })
  })

  it('scopes native and imported line labels to one active overlay', () => {
    const project = structuredClone(demoProject)
    const line = project.lines[0]
    line.lineBadges = [{ id: 'native-label', x: 10, y: 20, size: 40, rotation: 0, visible: true }]
    project.textTags = [{ id: 'aarc-label', kind: 'LineNameLabel', x: 30, y: 40, lineId: line.id }]
    expect(getDragLineLabelOverlay(project, { kind: 'draggingLineLabel', id: 'native-label', ownerLineId: line.id })).toEqual({
      labelIds: new Set(['native-label']),
      source: 'native',
      ownerLineId: line.id,
    })
    expect(getDragLineLabelOverlay(project, { kind: 'draggingLineLabel', id: 'aarc-label', ownerLineId: line.id })).toEqual({
      labelIds: new Set(['aarc-label']),
      source: 'aarc',
      ownerLineId: line.id,
    })
  })

  it('scopes free text and vector basemap drags to active overlays', () => {
    expect(getDragMapElementOverlay({ kind: 'draggingMapElement', id: 'note' })).toEqual({ elementIds: new Set(['note']) })
    expect(getDragMapElementOverlay({ kind: 'draggingStation', id: 's1' })).toEqual({ elementIds: new Set() })
    expect(getDragVectorBasemapOverlay({ kind: 'draggingRoadPoint', id: 'p', ownerRoadId: 'road' })).toEqual({ kind: 'road', objectIds: new Set(['road']) })
    expect(getDragVectorBasemapOverlay({ kind: 'draggingBasemapPoint', id: 'p', ownerPathId: 'path' })).toEqual({ kind: 'basemap', objectIds: new Set(['path']) })
    expect(getDragVectorBasemapOverlay({ kind: 'draggingStation', id: 's1' })).toEqual({ kind: null, objectIds: new Set() })
    expect(dragTouchesVectorBasemap({ kind: 'draggingStation', id: 's1' })).toBe(false)
    expect(dragTouchesVectorBasemap({ kind: 'draggingRoadPoint', id: 'p', ownerRoadId: 'road' })).toBe(true)
  })
})
