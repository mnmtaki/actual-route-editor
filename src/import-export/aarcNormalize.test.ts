import { describe, expect, it } from 'vitest'
import { DEFAULT_AARC_CONFIG, aggregateAarcPointMetrics, normalizeAarcSave, resolveAarcLineMetrics } from './aarcNormalize'

describe('AARC save normalization and source sizing', () => {
  it('applies defaults without mutating the raw save and normalizes singleton registries', () => {
    const raw = { lines: [{ id: 1, pts: ['1', '2'] }], points: [{ id: 1, pos: [0, 0] }, { id: 2, pos: [10, 0] }], cvsSize: [100, 200], dataSources: { id: 7, type: 'lineStyles' }, lineWidthMapped: undefined }
    const normalized = normalizeAarcSave(raw)
    expect(normalized.config.lineWidth).toBe(DEFAULT_AARC_CONFIG.lineWidth)
    expect(normalized.config.freePtClusterMode).toBe('loose')
    expect(normalized.lines[0].pts).toEqual([1, 2])
    expect(normalized.dataSources).toHaveLength(1)
    expect(raw.lines[0].pts).toEqual(['1', '2'])
  })

  it('preserves explicit zero mappings while using upstream fallback precedence', () => {
    const config = normalizeAarcSave({ lines: [], points: [], cvsSize: [1, 1], config: { lineWidth: 14, lineWidthMapped: { '2': { staSize: 3, staNameSize: 4, staSnapSize: 0, staNameSnapSize: 0 } } } }).config
    expect(resolveAarcLineMetrics({ width: 2 }, config)).toEqual({ widthRatio: 2, bodyWidth: 28, ptSize: 3, ptNameSize: 4, ptSnapSize: 0, ptNameSnapSize: 0 })
    expect(resolveAarcLineMetrics({ width: 0, ptSize: 0, ptNameSize: 0 }, config)).toMatchObject({ widthRatio: 1, bodyWidth: 14, ptSize: 1, ptNameSize: 1, ptSnapSize: 1, ptNameSnapSize: 1 })
  })

  it('resolves width ratios, line overrides and aggregate station metrics deterministically', () => {
    const config = normalizeAarcSave({ lines: [], points: [], cvsSize: [1, 1], config: { lineWidthMapped: { '1.5': { staSize: .9, staNameSize: 1.75 } } } }).config
    expect(resolveAarcLineMetrics({ width: .5 }, config).bodyWidth).toBe(7)
    expect(resolveAarcLineMetrics({ width: 1 }, config).bodyWidth).toBe(14)
    expect(resolveAarcLineMetrics({ width: 1.5 }, config)).toMatchObject({ bodyWidth: 21, ptSize: .9, ptNameSize: 1.75 })
    expect(resolveAarcLineMetrics({ width: 9 }, config).bodyWidth).toBe(126)
    expect(resolveAarcLineMetrics({ width: 12 }, config).bodyWidth).toBe(168)
    const lines = [{ id: 1, width: 1, ptSize: 2 }, { id: 2, width: 2, ptSize: 5 }]
    expect(aggregateAarcPointMetrics(10, lines, new Map([[10, [1, 2]]]), config)).toMatchObject({ ptSize: 5, ptSnapSize: 5, ptNameSnapSize: 5 })
  })
  it('mirrors upstream legacy icon migration without mutating the source save', () => {
    const raw = { idIncre: 9, lines: [], points: [], cvsSize: [1, 1], textTagIcons: [] as unknown[] }
    const normalized = normalizeAarcSave(raw)
    expect(normalized.textTagIcons.map(icon => icon.name)).toEqual(['a-机场', 'a-火车'])
    expect(normalized.textTagIcons.map(icon => icon.id)).toEqual(['10', '11'])
    expect(normalized.meta.textTagIconsVersion).toBe(1)
    expect(raw.textTagIcons).toEqual([])
  })
})
