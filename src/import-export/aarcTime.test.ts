import { describe, expect, it } from 'vitest'
import { aggregateAarcInterval, decodeAarcTimestamp, resolveAarcAtomicDates, resolveAarcStyleSliceForInterval, resolveAarcTimeSliceForInterval } from './aarcTime'

describe('AARC calendar time decoding', () => {
  it('decodes epoch milliseconds using the AARC UTC+8 calendar day', () => {
    expect(decodeAarcTimestamp(1704988800000)).toBe('2024-01-12')
    expect(decodeAarcTimestamp(1739116800000)).toBe('2025-02-10')
    expect(decodeAarcTimestamp(1739203200000)).toBe('2025-02-11')
    expect(decodeAarcTimestamp(1779206400000)).toBe('2026-05-20')
    expect(decodeAarcTimestamp(1780761600000)).toBe('2026-06-07')
  })

  it('ignores invalid/ancient values without manufacturing dates', () => {
    expect(decodeAarcTimestamp(-37458489943000)).toBeNull()
    expect(decodeAarcTimestamp(Number.NaN)).toBeNull()
    expect(decodeAarcTimestamp('not-a-date')).toBeNull()
    expect(decodeAarcTimestamp(253402300800001)).toBeNull()
  })

  it('applies reverse time slices to atomic legs and aggregates station intervals', () => {
    const warnings: string[] = []
    const legs = resolveAarcAtomicDates(
      { id: 282, pts: [289, 288, 287, 286, 285, 283, 280, 142, 495, 494, 496, 497, 498, 500, 501, 499, 502, 503, 504, 505, 506] },
      [
        { id: 507, line: 282, fromPt: 142, toPt: 289, time: { open: 1779206400000 } },
        { id: 508, line: 282, fromPt: 495, toPt: 506, time: { open: 1780761600000 } },
      ],
      '2026-05-20', null, warnings,
    )
    expect(warnings).toEqual([])
    expect(legs.slice(0, 7).every(item => item.openedAt === '2026-05-20')).toBe(true)
    expect(legs.slice(7, 8).every(item => item.openedAt === '2026-05-20')).toBe(true)
    expect(legs.slice(8).every(item => item.openedAt === '2026-06-07')).toBe(true)
    expect(aggregateAarcInterval(legs, 7, 9, { openedAt: '2026-05-20', closedAt: null }).openedAt).toBe('2026-06-07')
  })
  it('resolves the narrowest covering style slice deterministically', () => {
    const line = { id: 7, pts: [1, 2, 3, 4] }
    const slices = [
      { id: 1, line: 7, fromPt: 1, toPt: 4, style: 10 },
      { id: 2, line: 7, fromPt: 2, toPt: 3, style: 11 },
    ]
    expect(resolveAarcStyleSliceForInterval(line, slices, 2, 3)).toEqual({ id: 2, styleId: 11 })
    expect(resolveAarcStyleSliceForInterval(line, slices, 1, 2)).toEqual({ id: 1, styleId: 10 })
    expect(resolveAarcTimeSliceForInterval(line, slices, 2, 3)).toEqual({ id: 2 })
  })
})
