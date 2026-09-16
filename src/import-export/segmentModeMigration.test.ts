import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { parseProjectJson } from './projectJson'

describe('segment mode migration', () => {
  it('loads the removed legacy segment corner mode as straight', () => {
    const legacy = structuredClone(demoProject) as unknown as { geometry: { segments: Array<Record<string, unknown>> } }
    legacy.geometry.segments[0].mode = 'corner'
    const restored = parseProjectJson(JSON.stringify(legacy))
    expect(restored.geometry.segments[0].mode).toBe('straight')
  })
})
