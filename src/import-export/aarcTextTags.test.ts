import { describe, expect, it } from 'vitest'
import rawSample from './__fixtures__/木阳.aarc.json'
import { convertAarcToActualRouteProject } from './aarc'
import { resolveAarcDropCap, resolveAarcTextBlockLayout, resolveAarcTextTagContent } from '../renderer/AarcTextTags'

describe('AARC TextTag semantic import', () => {
  it('classifies line labels and preserves source ids/layout fields', () => {
    const { project } = convertAarcToActualRouteProject(rawSample, '木阳.aarc.json')
    expect(project.textTags).toHaveLength(49)
    const lineLabels = project.textTags!.filter(tag => tag.kind === 'LineNameLabel')
    expect(lineLabels).toHaveLength(12)
    expect(lineLabels.every(tag => tag.lineId && tag.source?.textTagId !== undefined)).toBe(true)
    expect(lineLabels.find(tag => tag.source?.textTagId === 141)).toMatchObject({ lineId: 'aarc-line-8', x: 850, y: 2000, width: 60, padding: 0 })
  })

  it('keeps line-name labels dynamically linked unless source text is explicit', () => {
    const { project } = convertAarcToActualRouteProject(rawSample, '木阳.aarc.json')
    const tag = project.textTags!.find(item => item.source?.textTagId === 118)!
    const line = project.lines.find(item => item.id === tag.lineId)!
    expect(tag.textOverride).toBeUndefined()
    expect(resolveAarcTextTagContent(tag, project)).toBe(line.name)
    line.name = '改名线路'
    expect(resolveAarcTextTagContent(tag, project)).toBe('改名线路')
    const explicit = { ...tag, textOverride: '固定标签' }
    expect(resolveAarcTextTagContent(explicit, project)).toBe('固定标签')
  })

  it('resolves upstream-style dropCap without losing the dynamic line link', () => {
    const { project } = convertAarcToActualRouteProject(rawSample, '木阳.aarc.json')
    const tag = project.textTags!.find(item => item.kind === 'LineNameLabel')!
    expect(resolveAarcDropCap({ ...tag, dropCap: true }, '1号线', 'Metro')).toBe('1')
    expect(resolveAarcDropCap({ ...tag, dropCap: true, dropCapLength: 2 }, '12号线', 'Metro')).toBe('12')
    expect(resolveAarcDropCap({ ...tag, dropCap: true }, '地铁', '')).toBeUndefined()
  })
  it('preserves multiline free text and ignores sunken tags only at render time', () => {
    const raw = { cvsSize: [100, 100], points: [{ id: 1, pos: [0, 0], sta: 0 }, { id: 2, pos: [10, 0], sta: 0 }], lines: [{ id: 1, name: 'R', pts: [1, 2] }], textTags: [{ id: 7, pos: [2, 3], text: '甲\n乙', textOp: { size: 1 } }, { id: 8, pos: [3, 4], text: '隐藏', sunken: true }] }
    const { project } = convertAarcToActualRouteProject(raw)
    expect(project.textTags?.find(tag => tag.source?.textTagId === 7)?.text).toBe('甲\n乙')
    expect(project.textTags?.find(tag => tag.source?.textTagId === 8)?.sunken).toBe(true)
  })
  it('applies explicit upstream vertical anchors to the complete text block', () => {
    expect(resolveAarcTextBlockLayout(-1, 100, 30, 12)).toEqual({ top: 70, baseline: 82 })
    expect(resolveAarcTextBlockLayout(1, 100, 30, 12)).toEqual({ top: 100, baseline: 112 })
    expect(resolveAarcTextBlockLayout(0, 100, 30, 12)).toEqual({ top: 88, baseline: 100 })
  })
})
