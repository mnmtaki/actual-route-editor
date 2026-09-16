import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../data/storage'
import { AarcFakeLinesLayer, buildAarcFakeLinePath, getAarcFakeSourceLines } from './AarcFakeLines'
import { AarcTextTagsLayer, resolveAarcTextTagContent } from './AarcTextTags'
import type { AarcTextTag } from '../data/model'

function projectWithFakeLine() {
  const project = createEmptyProject()
  project.aarc = {
    format: 'aarc',
    config: { lineWidth: 14, lineCarpetWiden: 7, lineTurnAreaRadius: 30, ptStaSize: 10, ptStaLineWidth: 4, ptStaFillColor: '#ffffff', ptStaExchangeLineColor: '#999999', staNameFontSize: 26, staNameSubFontSize: 16 },
    raw: {
      lines: [
        { id: 10, pts: [1, 2], name: '图例线', nameSub: 'LEGEND', color: '#336699', type: 0, isFake: true, width: 1 },
        { id: 20, pts: [2, 3], name: '运营线', nameSub: '', color: '#cc0000', type: 0, width: 1 },
      ],
      points: [
        { id: 1, pos: [0, 0], dir: 0, sta: 1, name: '仅伪线站', nameP: [0, -20] },
        { id: 2, pos: [100, 0], dir: 0, sta: 1, name: '共享点', nameP: [0, -20] },
        { id: 3, pos: [200, 0], dir: 0, sta: 1, name: '运营站', nameP: [0, -20] },
      ],
    },
  }
  return project
}

describe('AARC fake line visual fidelity', () => {
  it('keeps explicit isFake lines in a visual-only source set', () => {
    const project = projectWithFakeLine()
    expect(getAarcFakeSourceLines(project).map(line => line.id)).toEqual([10])
    expect(project.lines).toHaveLength(0)
    expect(project.stationLineRelations).toHaveLength(0)
  })

  it('formalizes and renders the fake line without creating passenger relations', () => {
    const project = projectWithFakeLine()
    const fake = getAarcFakeSourceLines(project)[0]
    expect(buildAarcFakeLinePath(project, fake)).toContain('M 0 0')
    const { container } = render(<svg><AarcFakeLinesLayer project={project} /></svg>)
    expect(container.querySelector('[data-aarc-fake-line-id="10"]')).not.toBeNull()
    expect(container.querySelector('[data-aarc-fake-line-body="true"]')).not.toBeNull()
    expect(container.querySelector('[data-aarc-fake-only-station-id="1"]')).not.toBeNull()
    expect(container.querySelector('[data-aarc-fake-only-station-id="2"]')).toBeNull()
    expect(project.lines).toHaveLength(0)
    expect(project.stationLineRelations).toHaveLength(0)
  })

  it('treats a TextTag for a fake line as a dynamic line-name label', () => {
    const project = projectWithFakeLine()
    const tag: AarcTextTag = {
      id: 'fake-label', kind: 'FreeMapText', x: 40, y: 40,
      source: { format: 'aarc', kind: 'text-tag', textTagId: 1, forId: 10, raw: { forId: 10 } },
      raw: { forId: 10 },
    }
    project.textTags = [tag]
    expect(resolveAarcTextTagContent(tag, project)).toBe('图例线')
    expect(resolveAarcTextTagContent(tag, project, true)).toBe('LEGEND')
    const { container } = render(<svg><AarcTextTagsLayer project={project} /></svg>)
    const node = container.querySelector('[data-aarc-fake-line-id="10"]')
    expect(node).not.toBeNull()
    expect(node?.getAttribute('data-aarc-text-tag-kind')).toBe('FakeLineNameLabel')
    expect(container.textContent).toContain('图例线')
  })
})
