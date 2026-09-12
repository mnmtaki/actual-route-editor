import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PresetShowcase, PRESET_SHOWCASE_CASES } from './PresetShowcase'

describe('built-in preset visual showcase fixture', () => {
  it('covers every required symbol and supported service-count variant', () => {
    const { container } = render(<PresetShowcase />)
    expect(container.querySelectorAll('[data-testid="preset-showcase"] article')).toHaveLength(PRESET_SHOWCASE_CASES.length)
    expect(container.querySelectorAll('[data-preset-id="transfer.guangzhou.classic"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-preset-id="transfer.guangzhou.2024"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-preset-id="transfer.kunming"]')).toHaveLength(4)
    expect(container.querySelector('[data-preset-id="station.shanghai.basic"]')).toBeTruthy()
    expect(container.querySelector('[data-preset-id="station.metroman.basic"]')).toBeTruthy()
    expect(container.querySelector('[data-preset-id="station.shanghai.basic"] [data-side-marker-mode="outward"]')).toBeTruthy()
    expect(container.querySelector('[data-preset-id="station.metroman.basic"] [data-side-marker-mode="inward"]')).toBeTruthy()
  })
})
