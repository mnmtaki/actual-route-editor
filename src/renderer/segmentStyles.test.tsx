import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import type { Line } from '../data/model'
import { getSegmentPath } from '../geometry/path'
import { SegmentArtwork, getElevatedStrokeStyle } from './segmentStyles'

describe('segment structure styles', () => {
  it('renders only the selected segment as three synchronized elevated strokes', () => {
    const project = structuredClone(demoProject)
    const segment = project.geometry.segments[1]
    segment.structureType = 'elevated'
    const line = project.lines.find(item => item.id === segment.lineId)!
    const path = getSegmentPath(project, segment)
    const { container } = render(<svg><SegmentArtwork segment={segment} line={line} path={path} lineWidth={project.settings.lineWidth} /></svg>)
    const strokes = [...container.querySelectorAll('[data-segment-artwork="elevated"] path')]
    expect(strokes).toHaveLength(3)
    expect(new Set(strokes.map(item => item.getAttribute('d')))).toEqual(new Set([path]))
    expect(strokes.at(-1)).toHaveAttribute('stroke', line.color)
    expect(project.geometry.segments.filter(item => item.structureType === 'elevated')).toHaveLength(1)
  })
  it('keeps all elevated layers synchronized after geometry changes', () => {
    const project = structuredClone(demoProject), segment = project.geometry.segments[0], line = project.lines[0]
    segment.structureType = 'elevated'; segment.waypoints[0].y += 80; project.stations.find(item => item.id === segment.toStationId)!.x += 40
    const path = getSegmentPath(project, segment)
    const { container } = render(<svg><SegmentArtwork segment={segment} line={line} path={path} lineWidth={18} /></svg>)
    expect([...container.querySelectorAll('path')].every(item => item.getAttribute('d') === path)).toBe(true)
  })
  it('uses an edited lineWidth directly for ordinary artwork and elevated layers',()=>{const project=structuredClone(demoProject),segment=project.geometry.segments[0],line=project.lines[0],path=getSegmentPath(project,segment),ordinary=render(<svg><SegmentArtwork segment={segment} line={line} path={path} lineWidth={24}/></svg>).container;expect(ordinary.querySelector('.segment-main')).toHaveAttribute('stroke-width','24');const elevated=getElevatedStrokeStyle(line.color,24);expect(elevated.mainWidth).toBe(24);expect(elevated.outerWidth).toBeCloseTo(33.12)})
  it('derives widths and colors from centralized style configuration', () => {
    const style = getElevatedStrokeStyle('#e54b3f', 10); expect(style.outerWidth).toBeCloseTo(13.8); expect(style.separatorWidth).toBeCloseTo(11.8); expect(style).toMatchObject({ mainWidth: 10, mainColor: '#e54b3f' })
  })

  it('renders AARC common lines with butt caps by default while native lines stay round', () => {
    const segment = structuredClone(demoProject.geometry.segments[0])
    const nativeLine = structuredClone(demoProject.lines[0])
    const aarcLine: Line = { ...nativeLine, id: 'aarc-line-1', source: { format: 'aarc', lineId: 1, sourceLineId: 1, raw: {} } }
    segment.lineId = aarcLine.id
    const aarc = render(<svg><SegmentArtwork segment={segment} line={aarcLine} path="M 0 0 L 100 0" lineWidth={10} renderLegacyStructure={false} /></svg>)
    expect(aarc.container.querySelector('.segment-main')).toHaveAttribute('stroke-linecap', 'butt')
    aarc.unmount()
    const native = render(<svg><SegmentArtwork segment={{ ...segment, lineId: nativeLine.id }} line={nativeLine} path="M 0 0 L 100 0" lineWidth={10} renderLegacyStructure={false} /></svg>)
    expect(native.container.querySelector('.segment-main')).toHaveAttribute('stroke-linecap', 'round')
  })

  it('renders an explicit AARC source cap on the ordinary common line', () => {
    const segment = structuredClone(demoProject.geometry.segments[0])
    const line: Line = { ...structuredClone(demoProject.lines[0]), id: 'aarc-line-1', source: { format: 'aarc', lineId: 1, sourceLineId: 1, raw: { cap: 'square' } } }
    segment.lineId = line.id
    const { container } = render(<svg><SegmentArtwork segment={segment} line={line} path="M 0 0 L 100 0" lineWidth={10} renderLegacyStructure={false} /></svg>)
    expect(container.querySelector('.segment-main')).toHaveAttribute('stroke-linecap', 'square')
  })
})
