import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { getSegmentPath, sampleSegmentNearStation } from './path'
import { getStationLineTangent, getTransferMarkerRotation } from './tangent'

describe('geometry', () => {
  it('creates bounded bezier paths for smooth segments', () => {
    const path = getSegmentPath(demoProject, demoProject.geometry.segments[0])
    expect(path).toContain(' C ')
    expect(path).not.toMatch(/NaN|Infinity/)
  })

  it('keeps the tangent continuous across adjacent smooth segments', () => {
    const incoming = sampleSegmentNearStation(demoProject, demoProject.geometry.segments.find(segment => segment.id === 'a-1')!, 's2', .001)!
    const outgoing = sampleSegmentNearStation(demoProject, demoProject.geometry.segments.find(segment => segment.id === 'a-2')!, 's2', .001)!
    const station = demoProject.stations.find(item => item.id === 's2')!
    const cross = (station.x - incoming.x) * (outgoing.y - station.y) - (station.y - incoming.y) * (outgoing.x - station.x)
    expect(Math.abs(cross)).toBeLessThan(0.05)
  })

  it('keeps controls bounded for very uneven waypoint spacing', () => {
    const project = structuredClone(demoProject)
    const segment = project.geometry.segments.find(item => item.id === 'a-1')!
    segment.waypoints.push({ id: 'near', x: 389, y: 349, type: 'smooth' })
    expect(getSegmentPath(project, segment)).not.toMatch(/NaN|Infinity/)
  })

  it('uses the first line geometry as the transfer marker anchor', () => {
    const before = getTransferMarkerRotation(demoProject, 's2', '2025-01-01')
    const changed = structuredClone(demoProject)
    changed.geometry.segments.find(segment => segment.id === 'a-1')!.waypoints[0].y -= 180
    changed.geometry.segments.find(segment => segment.id === 'a-2')!.waypoints[0].y += 180
    const after = getTransferMarkerRotation(changed, 's2', '2025-01-01')
    expect(after).not.toBeCloseTo(before, 2)
    expect(after).toBeCloseTo(getStationLineTangent(changed, 's2', 'line-a'), 5)
  })

  it('does not change orientation when a later line becomes active', () => {
    expect(getTransferMarkerRotation(demoProject, 's2', '2015-01-01')).toBeCloseTo(getTransferMarkerRotation(demoProject, 's2', '2025-01-01'), 5)
  })
})
