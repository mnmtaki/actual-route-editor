import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { StationMarker } from './StationMarker'
import { getDefaultTransferMetrics, getStationStyle } from './stationStyles'

describe('station styles', () => {
  it('uses stationSize independently from lineWidth for ordinary stations', () => {
    const project = structuredClone(demoProject); project.settings.lineWidth = 30; project.settings.stationSize = 7
    const { getByTestId } = render(<svg><StationMarker project={project} station={project.stations[0]} time="2025-01-01" selected={false} onPointerDown={() => {}} onLabelPointerDown={() => {}} /></svg>)
    expect(getByTestId('station-s1')).toHaveAttribute('r', '3.5')
  })
  it('sizes transfer dots and container from stationSize', () => {
    const metrics = getDefaultTransferMetrics(6, 3, .18, .25)
    expect(metrics.dotDiameter).toBe(6)
    expect(metrics.width).toBeGreaterThan(18)
    expect(metrics.height).toBe(10)
  })
  it('falls back to the default style for future unknown style ids', () => { expect(getStationStyle('custom_x').id).toBe('default') })
})
