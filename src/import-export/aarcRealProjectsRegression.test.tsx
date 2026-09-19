import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import rawChangling from './__fixtures__/常陵.aarc-9.json'
import rawPinglan from './__fixtures__/平岚.aarc (9).json'
import rawMuyang from './__fixtures__/木阳.aarc.json'
import rawTongzhou from './__fixtures__/桐洲地铁未来规划.aarc.json'
import { convertAarcToActualRouteProject } from './aarc'
import { parseProjectJson, serializeProject } from './projectJson'
import { getPassengerStationCountForLine } from '../data/passengerStats'
import { compilePresentation } from '../presentation/compiler'
import { PresentationScene } from '../presentation/PresentationScene'
import { AarcTextTagsLayer } from '../renderer/AarcTextTags'

type RawLine = { id?: unknown; type?: unknown; isFake?: unknown; pts?: unknown; parent?: unknown }
type RawTag = { id?: unknown; pos?: unknown; forId?: unknown }

const fixtures = [
  ['常陵', '常陵.aarc-9.json', rawChangling],
  ['平岚', '平岚.aarc (9).json', rawPinglan],
  ['木阳', '木阳.aarc.json', rawMuyang],
  ['桐洲', '桐洲地铁未来规划.aarc.json', rawTongzhou],
] as const

function finite(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}
function rawLines(raw: unknown): RawLine[] {
  const value = raw as { lines?: unknown }
  return Array.isArray(value.lines) ? value.lines.filter((line): line is RawLine => Boolean(line && typeof line === 'object')) : []
}
function rawTags(raw: unknown): RawTag[] {
  const value = raw as { textTags?: unknown }
  return Array.isArray(value.textTags) ? value.textTags.filter((tag): tag is RawTag => Boolean(tag && typeof tag === 'object')) : []
}
function validTagCount(raw: unknown) {
  return rawTags(raw).filter(tag => Array.isArray(tag.pos) && tag.pos.length >= 2 && tag.pos.slice(0, 2).every(value => Number.isFinite(Number(value)))).length
}
function fakeCommonSourceIds(raw: unknown) {
  return rawLines(raw)
    .filter(line => line.isFake === true && finite(line.type) !== 1 && Array.isArray(line.pts) && line.pts.length >= 2)
    .map(line => finite(line.id))
    .filter((id): id is number => id !== undefined)
    .sort((a, b) => a - b)
}

describe('real AARC project end-to-end regression', () => {
  for (const [label, filename, raw] of fixtures) {
    it(`${label}: import is complete before any UI panel mounts`, () => {
      const { project, summary } = convertAarcToActualRouteProject(raw, filename)
      const source = project.aarc?.raw as { lines?: unknown[]; points?: unknown[]; textTags?: unknown[] } | undefined

      expect(source).toBeTruthy()
      expect(source?.lines?.length).toBe((raw as { lines: unknown[] }).lines.length)
      expect(source?.points?.length).toBe((raw as { points: unknown[] }).points.length)
      expect(project.textTags).toHaveLength(validTagCount(raw))
      expect(summary.realLineCount).toBe(project.lines.filter(line => line.source?.format === 'aarc' && !line.isFake).length)

      const expectedFakeIds = fakeCommonSourceIds(raw)
      const actualFakeIds = project.lines
        .filter(line => line.isFake && line.source?.format === 'aarc')
        .map(line => finite(line.source?.sourceLineId ?? line.source?.lineId))
        .filter((id): id is number => id !== undefined)
        .sort((a, b) => a - b)
      expect(actualFakeIds).toEqual(expectedFakeIds)
      for (const line of project.lines.filter(line => line.isFake)) expect(getPassengerStationCountForLine(project, line.id)).toBe(0)
    })

    it(`${label}: native JSON round-trip preserves AARC provenance and fake/text/style semantics`, () => {
      const original = convertAarcToActualRouteProject(raw, filename).project
      const restored = parseProjectJson(serializeProject(original))

      expect(restored.aarc?.raw).toEqual(original.aarc?.raw)
      expect(restored.aarc?.pointLinks).toEqual(original.aarc?.pointLinks)
      expect(restored.aarc?.lineStyles).toEqual(original.aarc?.lineStyles)
      expect(restored.styles).toEqual(original.styles)
      expect(restored.basemapPaths).toEqual(original.basemapPaths)
      expect(restored.lines.map(line => ({
        id: line.id,
        isFake: Boolean(line.isFake),
        parentLineId: line.parentLineId,
        lineStyleId: line.lineStyleId,
        source: line.source,
      }))).toEqual(original.lines.map(line => ({
        id: line.id,
        isFake: Boolean(line.isFake),
        parentLineId: line.parentLineId,
        lineStyleId: line.lineStyleId,
        source: line.source,
      })))
      expect(restored.textTags).toEqual(original.textTags)
    })

    it(`${label}: every TextTag forId that still targets a source line renders as line/terrain instead of silently falling back to plain text`, () => {
      const project = convertAarcToActualRouteProject(raw, filename).project
      const lineById = new Map(rawLines(raw).flatMap(line => {
        const id = finite(line.id)
        return id === undefined ? [] : [[id, line] as const]
      }))
      const targeted = (project.textTags ?? []).filter(tag => tag.source?.forId !== undefined && lineById.has(Number(tag.source.forId)))
      if (!targeted.length) return

      const { container } = render(<svg><AarcTextTagsLayer project={{ ...project, textTags: targeted }} mode="notSunken" /></svg>)
      for (const tag of targeted.filter(tag => tag.sunken !== true)) {
        const sourceLine = lineById.get(Number(tag.source!.forId))!
        const expected = finite(sourceLine.type) === 1 ? 'terrain' : 'line'
        expect(container.querySelector(`[data-aarc-text-tag-id="${tag.id}"]`)).toHaveAttribute('data-aarc-text-tag-render-mode', expected)
      }
    })
  }

  it('all four real projects compile and render a finite Presentation final frame after round-trip', () => {
    for (const [, filename, raw] of fixtures) {
      const project = parseProjectJson(serializeProject(convertAarcToActualRouteProject(raw, filename).project))
      const sequence = compilePresentation(project)
      expect(Number.isFinite(sequence.duration)).toBe(true)
      const view = render(<PresentationScene project={project} sequence={sequence} time={sequence.duration} width={1280} height={720} />)
      const svg = view.container.querySelector('svg.presentation-scene')
      expect(svg).toBeTruthy()
      expect(svg?.outerHTML).not.toMatch(/\bNaN\b/)
      expect(svg?.outerHTML).not.toMatch(/\bInfinity\b/)
      view.unmount()
    }
  })
})
