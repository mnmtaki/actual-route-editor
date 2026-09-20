import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { compileAarcLineArtworkRuns } from './lineArtworkRuns'

function aarcProject() {
  const project = structuredClone(demoProject)
  const line = project.lines.find(item => item.id === 'line-a')!
  line.source = { format: 'aarc', lineId: 1, sourceLineId: 1, raw: { cap: 'square' } }
  project.geometry.segments.filter(segment => segment.lineId === line.id).forEach((segment, index) => {
    segment.source = { format: 'aarc', lineId: 1, sourceLineId: 1, pointIds: [index + 1, index + 2], raw: { sourceSegmentIndex: index } }
    segment.mode = 'straight'
    segment.waypoints = []
    segment.structureType = 'underground'
    segment.structureNodes = []
    delete segment.lineStyleId
  })
  return { project, line }
}

describe('continuous AARC line artwork runs', () => {
  it('joins same-style station-to-station segments into one stroked path', () => {
    const { project, line } = aarcProject()
    const segments = project.geometry.segments.filter(segment => segment.lineId === line.id)
    const runs = compileAarcLineArtworkRuns(project, line, segments)
    expect(runs).toHaveLength(1)
    expect(runs[0].segmentIds).toEqual(segments.map(segment => segment.id))
    expect((runs[0].path.match(/ M /g) ?? []).length).toBeLessThanOrEqual(1)
  })

  it('keeps a real style boundary as a cap boundary instead of joining through it', () => {
    const { project, line } = aarcProject()
    project.styles = [
      { id: 'style-a', name: 'A', layers: [{ id: 'a', colorMode: 'followLine', width: 1, widthMode: 'ratio', lineCap: 'butt' }] },
      { id: 'style-b', name: 'B', layers: [{ id: 'b', colorMode: 'followLine', width: 1, widthMode: 'ratio', lineCap: 'square' }] },
    ]
    const segments = project.geometry.segments.filter(segment => segment.lineId === line.id)
    segments[0].lineStyleId = 'style-a'
    segments[1].lineStyleId = 'style-b'
    segments[2].lineStyleId = 'style-b'
    const runs = compileAarcLineArtworkRuns(project, line, segments)
    expect(runs).toHaveLength(2)
    expect(runs.map(run => run.segmentIds)).toContainEqual([segments[1].id, segments[2].id])
  })
})
