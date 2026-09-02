import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { BUILTIN_ELEVATED_STYLE_ID, BUILTIN_NORMAL_STYLE_ID, getLineStyle, getLineStyles, normalizeLineStyles, resolveLineStyle, resolveLineStyleLayers } from './lineStyles'
import { getElevatedStrokeStyle } from '../renderer/segmentStyles'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'

describe('LineStyle V1', () => {
  it('provides ordinary and elevated built-ins without mutating legacy projects', () => {
    const project = structuredClone(demoProject)
    const styles = getLineStyles(project)
    expect(styles.map(style => style.id)).toEqual([BUILTIN_NORMAL_STYLE_ID, BUILTIN_ELEVATED_STYLE_ID])
    expect(project.styles).toBeUndefined()
  })

  it('uses line color for ordinary layers and preserves custom layer properties', () => {
    const style = normalizeLineStyles([{ id: 'custom', name: '虚线', layers: [{ id: 'l', colorMode: 'custom', color: '#123456', width: 2, widthMode: 'absolute', opacity: .7, dash: [8, 4], lineCap: 'square', lineJoin: 'bevel' }] }])![0]
    const layer = resolveLineStyleLayers(style, '#ff0000', 18)[0]
    expect(layer.resolvedColor).toBe('#123456')
    expect(layer.resolvedWidth).toBe(2)
    expect(layer.resolvedOpacity).toBe(.7)
    expect(layer.resolvedDash).toBe('8 4')
    expect(layer.lineCap).toBe('square')
    expect(layer.lineJoin).toBe('bevel')
  })

  it('maps an elevated segment to the built-in elevated style while ordinary segments use the selected style', () => {
    const project = structuredClone(demoProject), line = project.lines[0], ordinary = project.geometry.segments[0], elevated = { ...ordinary, structureType: 'elevated' as const }
    project.styles = [{ id: 'custom', name: '自定义', layers: [{ id: 'main', colorMode: 'followLine', width: 1.2 }] }]
    line.lineStyleId = 'custom'
    expect(resolveLineStyle(project, line, ordinary).id).toBe('custom')
    expect(resolveLineStyle(project, line, elevated).id).toBe(BUILTIN_ELEVATED_STYLE_ID)
    const elevatedLayer = resolveLineStyleLayers(getLineStyle(project, BUILTIN_ELEVATED_STYLE_ID), line.color, 18)
    expect(elevatedLayer).toHaveLength(3)
    expect(elevatedLayer[0].resolvedWidth).toBeCloseTo(24.84)
    expect(elevatedLayer[0].resolvedColor).toBe(getElevatedStrokeStyle(line.color, 18).outerColor)
    expect(elevatedLayer[1].resolvedColor).toBe(getElevatedStrokeStyle(line.color, 18).separatorColor)
    expect(elevatedLayer[2].resolvedColor).toBe(line.color)
  })

  it('normalizes malformed styles and keeps optional project styles round-trippable', () => {
    expect(normalizeLineStyles([{ id: 'bad', layers: [{ id: 'x', width: -1 }] }, { id: 'ok', layers: [{ width: 1 }] }])).toMatchObject([{ id: 'bad', layers: [] }, { id: 'ok', layers: [{ id: 'layer-1', width: 1 }] }])
    const project = structuredClone(demoProject)
    project.styles = [{ id: 'custom', name: '自定义', layers: [{ id: 'layer', colorMode: 'followLine', width: 1.25, widthMode: 'ratio', opacity: .8, dash: [6, 3], lineCap: 'round', lineJoin: 'round' }] }]
    const restored = parseProjectJson(serializeProject(project))
    expect(restored.styles).toEqual(project.styles)
  })
})
