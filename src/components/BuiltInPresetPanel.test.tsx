import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { BuiltInPresetPanel } from './BuiltInPresetPanel'

describe('built-in transfer preset previews', () => {
  it('offers deterministic 2/3/4 service preview switching for both Guangzhou transfers', () => {
    const view = render(<BuiltInPresetPanel project={structuredClone(demoProject)} onChange={() => {}} />)
    for (const presetId of ['transfer.guangzhou.classic', 'transfer.guangzhou.2024']) {
      const card = view.container.querySelector(`[data-testid="preset-card-${presetId}"]`)!
      const buttons = [...card.querySelectorAll<HTMLButtonElement>('.preset-preview-counts button')]
      expect(buttons.map(button => button.textContent)).toEqual(['2线', '3线', '4线'])
      fireEvent.click(buttons[1])
      expect(card.querySelector(`[data-transfer-template="${presetId.endsWith('classic') ? 'guangzhouClassic' : 'guangzhou2024'}"][data-service-count="3"]`)).toBeTruthy()
      fireEvent.click(buttons[2])
      expect(card.querySelector(`[data-transfer-template="${presetId.endsWith('classic') ? 'guangzhouClassic' : 'guangzhou2024'}"][data-service-count="4"]`)).toBeTruthy()
    }
  })

  it('offers one dynamic Kunming card with 2/3/4 service preview switching', () => {
    const view = render(<BuiltInPresetPanel project={structuredClone(demoProject)} onChange={() => {}} />)
    const card = view.container.querySelector('[data-testid="preset-card-transfer.kunming"]')!
    expect(view.container.querySelector('[data-testid="preset-card-transfer.kunming.two"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="preset-card-transfer.kunming.three"]')).toBeNull()
    expect(card.querySelector('h4')).toHaveTextContent('昆明地铁换乘站')
    const buttons = [...card.querySelectorAll<HTMLButtonElement>('.preset-preview-counts button')]
    expect(buttons.map(button => button.textContent)).toEqual(['2线', '3线', '4线'])
    fireEvent.click(buttons[2])
    expect(card.querySelector('[data-transfer-template="kunming"][data-service-count="4"]')).toBeTruthy()
  })
})
