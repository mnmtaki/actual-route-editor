from pathlib import Path

# SegmentMode: drop the redundant segment-level `corner` mode.
path = Path('src/data/model.ts')
text = path.read_text(encoding='utf-8')
old = "export type SegmentMode = 'straight' | 'smooth' | 'corner' | 'rounded'"
new = "export type SegmentMode = 'straight' | 'smooth' | 'rounded'"
if text.count(old) != 1:
    raise SystemExit(f'SegmentMode anchor mismatch: {text.count(old)}')
path.write_text(text.replace(old, new), encoding='utf-8')

# Legacy/native JSON: old mode:'corner' is intentionally normalized to straight.
path = Path('src/import-export/projectJsonLegacy.ts')
text = path.read_text(encoding='utf-8')
old = "mode: segment.mode === 'smooth' || segment.mode === 'corner' || segment.mode === 'rounded' ? segment.mode : 'straight'"
new = "mode: segment.mode === 'smooth' || segment.mode === 'rounded' ? segment.mode : 'straight'"
if text.count(old) != 1:
    raise SystemExit(f'project JSON segment mode anchor mismatch: {text.count(old)}')
path.write_text(text.replace(old, new), encoding='utf-8')

# Main geometry inspector: keep three genuinely distinct segment modes and use clearer labels.
path = Path('src/components/StyleGeometryInspector.tsx')
text = path.read_text(encoding='utf-8')
old = '<option value="straight">直线</option><option value="smooth">平滑</option><option value="corner">折角</option><option value="rounded">局部圆角</option>'
new = '<option value="straight">折线</option><option value="smooth">平滑曲线</option><option value="rounded">圆角折线</option>'
if text.count(old) != 1:
    raise SystemExit(f'StyleGeometryInspector segment mode options mismatch: {text.count(old)}')
path.write_text(text.replace(old, new), encoding='utf-8')

# Legacy inspector is still compiled; keep its UI/model in sync.
path = Path('src/components/InspectorLegacy.tsx')
text = path.read_text(encoding='utf-8')
old = '<option value="straight">直线</option><option value="smooth">平滑</option><option value="corner">折角</option><option value="rounded">局部圆角</option>'
new = '<option value="straight">折线</option><option value="smooth">平滑曲线</option><option value="rounded">圆角折线</option>'
count = text.count(old)
if count != 1:
    raise SystemExit(f'InspectorLegacy segment mode options mismatch: {count}')
path.write_text(text.replace(old, new), encoding='utf-8')

# README product wording: segment-level corner mode no longer exists.
path = Path('README.md')
text = path.read_text(encoding='utf-8')
old = '区间属性支持直线、平滑和折角，控制点可删除或清空。'
new = '区间属性支持折线、平滑曲线和圆角折线，控制点可删除或清空。'
if old in text:
    text = text.replace(old, new)
path.write_text(text, encoding='utf-8')

# Regression: old project JSON containing mode:'corner' must still load, as straight.
Path('src/import-export/segmentModeMigration.test.ts').write_text(r'''import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { parseProjectJson } from './projectJson'

describe('segment mode migration', () => {
  it('loads the removed legacy segment corner mode as straight', () => {
    const legacy = structuredClone(demoProject) as unknown as { geometry: { segments: Array<Record<string, unknown>> } }
    legacy.geometry.segments[0].mode = 'corner'
    const restored = parseProjectJson(JSON.stringify(legacy))
    expect(restored.geometry.segments[0].mode).toBe('straight')
  })
})
''', encoding='utf-8')

# Regression: the segment inspector exposes only the three distinct modes.
Path('src/components/segmentModeOptions.test.tsx').write_text(r'''import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { StyleGeometryInspector } from './StyleGeometryInspector'

describe('segment geometry mode options', () => {
  it('offers polyline, smooth curve and rounded polyline without redundant segment corner mode', () => {
    const project = structuredClone(demoProject)
    render(<StyleGeometryInspector project={project} selection={{ type: 'segment', id: project.geometry.segments[0].id }} onChange={() => {}} onDelete={() => {}} />)
    const select = screen.getByLabelText('绘制模式') as HTMLSelectElement
    expect([...select.options].map(option => [option.value, option.textContent])).toEqual([
      ['straight', '折线'],
      ['smooth', '平滑曲线'],
      ['rounded', '圆角折线'],
    ])
  })
})
''', encoding='utf-8')
