import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { addWaypointToSegment } from '../data/operations'
import rawAarc from '../import-export/__fixtures__/木阳.aarc.json'
import { convertAarcToActualRouteProject } from '../import-export/aarc'
import { exportSvg } from '../import-export/svgExport'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { compilePresentation } from '../presentation/compiler'
import { PresentationScene } from '../presentation/PresentationScene'
import { SegmentArtwork } from '../renderer/segmentStyles'
import { buildRoundedPolylineSpans, getRoundedPolylineCornerPlans, getSegmentPath } from './path'

const skeleton = () => [
  { x: 0, y: 0 },
  { x: 100, y: 0, cornerRadius: 20 },
  { x: 100, y: 100, cornerRadius: 70 },
  { x: 200, y: 100 },
]

describe('per-corner rounded geometry', () => {
  it('keeps independent requested radii on two corners', () => {
    const points = skeleton(), plans = getRoundedPolylineCornerPlans(points)
    expect(plans.map(plan => plan.requestedRadius)).toEqual([20, 70])
    points[1].cornerRadius = 35
    expect(getRoundedPolylineCornerPlans(points).map(plan => plan.requestedRadius)).toEqual([35, 70])
  })

  it('renders radius zero as a hard corner and undefined exactly as the current default', () => {
    const hard = buildRoundedPolylineSpans([{ x: 0, y: 0 }, { x: 100, y: 0, cornerRadius: 0 }, { x: 100, y: 100 }])
    expect(hard).toHaveLength(2)
    expect(hard.every(span => span.linear)).toBe(true)
    const legacy = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]
    expect(buildRoundedPolylineSpans(legacy)).toEqual(buildRoundedPolylineSpans([{ ...legacy[0] }, { ...legacy[1], cornerRadius: 42 }, { ...legacy[2] }]))
  })

  it('clamps effective radius without mutating the persisted requested radius', () => {
    const points = [{ x: 0, y: 0 }, { x: 20, y: 0, cornerRadius: 80 }, { x: 20, y: 20, cornerRadius: 80 }, { x: 40, y: 20 }]
    const plans = getRoundedPolylineCornerPlans(points)
    expect(plans.every(plan => plan.requestedRadius === 80)).toBe(true)
    expect(plans.every(plan => plan.effectiveRadius < 80)).toBe(true)
    expect(points[1].cornerRadius).toBe(80)
    expect(points[2].cornerRadius).toBe(80)
  })

  it('persists radius by stable waypoint id and does not remap it after insertion', () => {
    const project = structuredClone(demoProject), segment = project.geometry.segments.find(item => item.id === 'a-1')!
    segment.mode = 'rounded'
    segment.waypoints = [{ id: 'corner-a', x: 260, y: 360, type: 'corner', cornerRadius: 20 }, { id: 'corner-b', x: 330, y: 420, type: 'corner', cornerRadius: 70 }]
    const restored = parseProjectJson(serializeProject(project)), restoredSegment = restored.geometry.segments.find(item => item.id === segment.id)!
    expect(restoredSegment.waypoints.map(item => [item.id, item.cornerRadius])).toEqual([['corner-a', 20], ['corner-b', 70]])
    const inserted = addWaypointToSegment(restored, segment.id, { x: 300, y: 390 }).project.geometry.segments.find(item => item.id === segment.id)!
    expect(inserted.waypoints.find(item => item.id === 'corner-a')?.cornerRadius).toBe(20)
    expect(inserted.waypoints.find(item => item.id === 'corner-b')?.cornerRadius).toBe(70)
  })

  it('persists local radii on AARC implicit and sta:0 explicit geometry points', () => {
    const project = convertAarcToActualRouteProject(rawAarc, '木阳.aarc.json').project
    const implicit = project.geometry.segments.flatMap(segment => segment.waypoints.map(waypoint => ({ segment, waypoint }))).find(item => item.waypoint.source?.kind === 'implicit-corner')!
    const explicit = project.geometry.segments.flatMap(segment => segment.waypoints.map(waypoint => ({ segment, waypoint }))).find(item => item.waypoint.source?.kind === 'explicit-control-point')!
    implicit.waypoint.cornerRadius = 20
    explicit.waypoint.cornerRadius = 60
    const restored = parseProjectJson(serializeProject(project))
    const byId = new Map(restored.geometry.segments.flatMap(segment => segment.waypoints).map(waypoint => [waypoint.id, waypoint]))
    expect(byId.get(implicit.waypoint.id)).toMatchObject({ cornerRadius: 20, source: { kind: 'implicit-corner' } })
    expect(byId.get(explicit.waypoint.id)).toMatchObject({ cornerRadius: 60, source: { kind: 'explicit-control-point' } })
  })

  it('uses one identical path in editor artwork, Presentation, SVG, and therefore video frames', () => {
    const project = structuredClone(demoProject), segment = project.geometry.segments.find(item => item.id === 'a-1')!, line = project.lines.find(item => item.id === segment.lineId)!
    segment.mode = 'rounded'; segment.waypoints = [{ id: 'shared-corner', x: 280, y: 350, type: 'corner', cornerRadius: 25 }]
    const path = getSegmentPath(project, segment)
    const editor = render(<svg><SegmentArtwork segment={segment} line={line} path={path} lineWidth={project.settings.lineWidth} /></svg>)
    expect(editor.container.querySelector('.segment-main')).toHaveAttribute('d', path)
    expect(exportSvg(editor.container.querySelector('svg')!, true)).toContain(`d="${path}"`)
    const sequence = compilePresentation(project), scene = render(<PresentationScene project={project} sequence={sequence} time={sequence.duration} width={1920} height={1080} />)
    expect(scene.container.querySelector(`[data-segment-id="${segment.id}"] .segment-main`)).toHaveAttribute('d', path)
  })

  it('keeps untouched AARC geometry identical through native save and reload', () => {
    const project = convertAarcToActualRouteProject(rawAarc, '木阳.aarc.json').project
    const before = project.geometry.segments.map(segment => [segment.id, getSegmentPath(project, segment)])
    const restored = parseProjectJson(serializeProject(project))
    expect(restored.geometry.segments.map(segment => [segment.id, getSegmentPath(restored, segment)])).toEqual(before)
    expect(project.geometry.segments.flatMap(segment => segment.waypoints).every(waypoint => waypoint.cornerRadius === undefined)).toBe(true)
  })
})
