import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GuangzhouStationPill, getGuangzhouStationPillMetrics } from './guangzhouArtwork'

describe('GuangzhouStationPill', () => {
  it('uses a white pill with service-colored border and divider and dark two-cell text', () => {
    const view = render(<svg>{<GuangzhouStationPill x={0} y={0} lineCode="1" stationCode="01" serviceColor="#df4e45" lineId="line-1" />}</svg>)
    const pill = view.container.querySelector('[data-guangzhou-pill="true"]')!
    expect(pill.querySelector('[data-guangzhou-pill-background="true"]')).toHaveAttribute('fill', 'white')
    expect(pill.querySelector('[data-guangzhou-pill-background="true"]')).toHaveAttribute('stroke', '#df4e45')
    expect(pill.querySelector('[data-guangzhou-divider="true"]')).toHaveAttribute('stroke', '#df4e45')
    expect(pill.querySelector('[data-guangzhou-pill-line="true"]')).toHaveTextContent('1')
    expect(pill.querySelector('[data-guangzhou-pill-station="true"]')).toHaveTextContent('01')
    expect(pill.querySelector('[data-guangzhou-pill-line="true"]')).toHaveAttribute('fill', '#202526')
    expect(pill.querySelector('[data-guangzhou-pill-station="true"]')).toHaveAttribute('fill', '#202526')
    expect(pill.querySelector('[data-guangzhou-pill-background="true"]')).not.toHaveAttribute('fill', '#df4e45')
  })

  it('keeps missing station codes empty and expands deterministically for longer codes', () => {
    const empty = render(<svg>{<GuangzhouStationPill x={0} y={0} lineCode="10" serviceColor="#3377aa" />}</svg>)
    expect(empty.container.querySelector('[data-guangzhou-pill-station="true"]')).toHaveTextContent('')
    const short = getGuangzhouStationPillMetrics('1', '01')
    const long = getGuangzhouStationPillMetrics('APM', '105')
    expect(short.width).toBeGreaterThanOrEqual(40)
    expect(long.width).toBeGreaterThan(short.width)
    expect(long.height).toBe(short.height)
  })
})

