import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { StationMarker } from './StationMarker'

describe('station markers', () => {
  const station = demoProject.stations.find((item) => item.id === 's2')!
  const renderAt = (time: string) => render(<svg><StationMarker project={demoProject} station={station} time={time} selected={false} onPointerDown={() => {}} onLabelPointerDown={() => {}} /></svg>)
  it('renders a white ordinary marker in 2005', () => {
    const { getByTestId } = renderAt('2005-01-01')
    expect(getByTestId('station-s2')).toHaveAttribute('fill', 'white')
    expect(getByTestId('station-s2')).toHaveAttribute('r', String(demoProject.settings.stationSize / 2))
  })
  it('renders two and three colored lamps at later dates', () => {
    const twoRender = renderAt('2015-01-01')
    const two = twoRender.getByTestId('transfer-s2')
    expect(two.querySelectorAll('circle')).toHaveLength(2)
    twoRender.unmount()
    const three = renderAt('2025-01-01').getByTestId('transfer-s2')
    expect(three.querySelectorAll('circle')).toHaveLength(3)
  })
})

