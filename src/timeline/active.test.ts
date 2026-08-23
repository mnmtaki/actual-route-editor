import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { getActiveLinesAtStation, getActiveNetworkAtTime, getFirstLineAtStation, isActiveAt } from './active'

describe('timeline', () => {
  it('uses opened inclusive and closed exclusive dates', () => {
    expect(isActiveAt('2010-01-01', '2020-01-01', '2010-01-01')).toBe(true)
    expect(isActiveAt('2010-01-01', '2020-01-01', '2020-01-01')).toBe(false)
  })

  it('changes a shared station from one to two to three active lines', () => {
    expect(getActiveLinesAtStation(demoProject, 's2', '2005-01-01')).toHaveLength(1)
    expect(getActiveLinesAtStation(demoProject, 's2', '2015-01-01')).toHaveLength(2)
    expect(getActiveLinesAtStation(demoProject, 's2', '2025-01-01')).toHaveLength(3)
  })

  it('orders lines by station relation date, then stable lineOrder', () => {
    expect(getFirstLineAtStation(demoProject, 's2')?.id).toBe('line-a')
    expect(getActiveLinesAtStation(demoProject, 's2', '2025-01-01').map((line) => line.id)).toEqual(['line-a', 'line-b', 'line-c'])
  })

  it('filters segments and stations for a historical date', () => {
    const network = getActiveNetworkAtTime(demoProject, '2005-01-01')
    expect(network.lines.map((line) => line.id)).toEqual(['line-a'])
    expect(network.stations).toHaveLength(4)
  })
})
