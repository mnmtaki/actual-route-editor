import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../data/storage'
import { appendStationToLine, createLine } from '../data/operations'
import { getSegmentPath } from '../geometry/path'
import { SegmentArtwork } from './segmentStyles'

describe('five-station elevated workflow', () => {
  it('changes only one curved middle segment and keeps stations independent', () => {
    let created = createLine(createEmptyProject(), { name: '测试高架线', color: '#356fc5' })
    let project = created.project, anchor: string | null = null
    for (let index = 0; index < 5; index += 1) { const result = appendStationToLine(project, created.lineId, { x: 100 + index * 120, y: 180 + (index % 2) * 60 }, anchor); project = result.project; anchor = result.stationId }
    const target = project.geometry.segments[1]; target.structureType = 'elevated'; target.mode = 'smooth'; target.waypoints.push({ id: 'curve', x: 280, y: 310, type: 'smooth' })
    expect(project.stations).toHaveLength(5)
    expect(project.geometry.segments).toHaveLength(4)
    expect(project.geometry.segments.filter(segment => segment.structureType === 'elevated')).toEqual([target])
    const line = project.lines[0], path = getSegmentPath(project, target)
    const { container } = render(<svg><SegmentArtwork segment={target} line={line} path={path} lineWidth={project.settings.lineWidth} /></svg>)
    expect(container.querySelectorAll('[data-segment-artwork="elevated"] path')).toHaveLength(3)
  })
})
