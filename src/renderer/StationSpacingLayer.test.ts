import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { buildStationSpacingLabels } from './StationSpacingLayer'
import { getEffectiveLineColor } from '../data/lineIdentity'
import { getSegmentDistanceMeters } from '../data/stationSpacing'

describe('station spacing map labels', () => {
  it('derives distance labels from segment length without mutating the project', () => {
    const project = structuredClone(demoProject)
    project.timeline.currentDate = '2099-01-01'
    const snapshot = JSON.stringify(project)
    const labels = buildStationSpacingLabels(project)
    for (const label of labels) {
      const segment = project.geometry.segments.find(item => item.id === label.segmentId)!
      const distance = getSegmentDistanceMeters(project, segment)
      expect(label.text).toBe(distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(2)} km`)
      expect(label.color).toBe(getEffectiveLineColor(project, segment.lineId, project.timeline.currentDate))
      expect(Number.isFinite(label.x) && Number.isFinite(label.y)).toBe(true)
    }
    expect(JSON.stringify(project)).toBe(snapshot)
  })

  it('excludes invisible lines', () => {
    const project = structuredClone(demoProject)
    project.timeline.currentDate = '2099-01-01'
    project.lines.forEach(line => { line.visible = false })
    expect(buildStationSpacingLabels(project)).toEqual([])
  })
})
