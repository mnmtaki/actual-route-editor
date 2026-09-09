import { describe, expect, it } from 'vitest'

// Vite exposes source text to tests without adding a Node-only dependency.
// This is intentionally a small guard: MobileShell may route input and render
// panels, but it must not grow a second project mutation implementation.
const sources = import.meta.glob('./MobileShell.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const mobileShellSource = Object.values(sources)[0] ?? ''

describe('desktop/mobile business-logic boundary', () => {
  it('keeps MobileShell as an input/layout adapter', () => {
    expect(mobileShellSource).not.toContain('structuredClone(')
    expect(mobileShellSource).not.toMatch(/project\.(stations|lines|geometry|mapElements|roads|basemapPaths)\s*=/)
    expect(mobileShellSource).not.toContain('next.lines')
    expect(mobileShellSource).not.toContain('next.stations')
    expect(mobileShellSource).toContain('onRemoveBackground')
  })

  it('keeps shared line state commands outside either shell', () => {
    const commandSource = import.meta.glob('../data/editorCommands.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const source = Object.values(commandSource)[0] ?? ''
    expect(source).toContain('setLineVisibility')
    expect(source).toContain('setLineLocked')
    expect(source).toContain('setLinesVisibility')
    expect(source).toContain('setLinesLocked')
    expect(source).toContain('removeBackground')
  })
})
