import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { parseProjectJson, serializeProject } from './projectJson'
import { exportSvg } from './svgExport'

describe('project and SVG export', () => {
  it('round-trips the complete project schema', () => {
    const restored = parseProjectJson(serializeProject(demoProject))
    expect(restored).toEqual(demoProject)
    expect(restored.stationLineRelations[0].openedAt).toBe('2000-01-01')
    expect(restored.geometry.segments[0].waypoints).toHaveLength(1)
  })

  it('removes editor handles and optionally removes the background', () => {
    document.body.innerHTML = '<svg viewBox="0 0 100 100"><image href="x"/><path class="art"/><g data-editor="true"><circle/></g><path class="segment-hit"/></svg>'
    const result = exportSvg(document.querySelector('svg')!, false)
    expect(result).toContain('class="art"')
    expect(result).not.toContain('data-editor')
    expect(result).not.toContain('segment-hit')
    expect(result).not.toContain('<image')
  })
})
