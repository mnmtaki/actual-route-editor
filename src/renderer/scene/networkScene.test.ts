import { describe, expect, it } from 'vitest'
import { demoProject } from '../../data/demo'
import { getActiveNetworkAtTime } from '../../timeline/active'
import { compileNetworkLineScene, compileNetworkStationScene } from './networkScene'

describe('network scene compiler', () => {
  it('compiles active line hit geometry independently from SVG', () => {
    const project = structuredClone(demoProject)
    const active = getActiveNetworkAtTime(project, project.timeline.currentDate)
    const scene = compileNetworkLineScene(project)
    const hitIds = scene.lines
      .filter(item => item.kind === 'line')
      .flatMap(item => item.hits.map(hit => hit.segment.id))

    expect(new Set(hitIds)).toEqual(new Set(active.segments.map(segment => segment.id)))
    expect(scene.lines.some(item => item.kind === 'line' && item.artworks.length > 0)).toBe(true)
  })

  it('keeps artwork filtering separate from interaction geometry', () => {
    const project = structuredClone(demoProject)
    const lineId = project.lines[0].id
    const scene = compileNetworkLineScene(project, new Set([lineId]), new Set([lineId]))
    const lineItems = scene.lines.filter(item => item.kind === 'line')

    expect(lineItems.length).toBeGreaterThan(0)
    expect(lineItems.every(item => item.lineId === lineId)).toBe(true)
    expect(lineItems.flatMap(item => item.artworks)).toHaveLength(0)
    expect(lineItems.flatMap(item => item.hits).length).toBeGreaterThan(0)
  })

  it('compiles station visibility, filtering and selection outside JSX', () => {
    const project = structuredClone(demoProject)
    const station = project.stations[0]
    const scene = compileNetworkStationScene(
      project,
      { type: 'station', id: station.id },
      [],
      new Set([station.id]),
    )

    expect(scene.markers.map(item => item.station.id)).toEqual([station.id])
    expect(scene.labels.map(item => item.id)).toEqual([station.id])
    expect(scene.markers[0].selected).toBe(true)

    const withoutMarker = compileNetworkStationScene(
      project,
      null,
      [],
      new Set([station.id]),
      new Set([station.id]),
    )
    expect(withoutMarker.markers).toHaveLength(0)
    expect(withoutMarker.labels.map(item => item.id)).toEqual([station.id])
  })
})
