import { describe, expect, it } from 'vitest'
import css from '../ui-system.css?raw'

describe('unified editor visual system', () => {
  it('defines one shared set of editor tokens', () => {
    for (const token of [
      '--ui-bg:',
      '--ui-surface:',
      '--ui-text:',
      '--ui-border:',
      '--ui-accent:',
      '--ui-radius-sm:',
      '--ui-radius-lg:',
      '--ui-control-h:',
      '--ui-shadow-float:',
    ]) expect(css).toContain(token)
  })

  it('uses the same visual language for core editor surfaces', () => {
    for (const selector of [
      '.toolbar {',
      '.panel,',
      '.line-row {',
      '.canvas-status {',
      '.style-drawer,',
      '.line-dialog {',
      '.presentation-mode {',
      '.mobile-topbar {',
    ]) expect(css).toContain(selector)
  })

  it('keeps the compatibility aliases mapped to the unified tokens', () => {
    expect(css).toContain('--panel: var(--ui-surface)')
    expect(css).toContain('--line: var(--ui-border)')
    expect(css).toContain('--accent: var(--ui-accent)')
    expect(css).toContain('--ui-radius-button: var(--ui-radius-sm)')
  })
})
