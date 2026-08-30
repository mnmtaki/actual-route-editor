import { describe, expect, it } from 'vitest'
import { __fileIOTest } from './fileIO'

describe('platform file adapter', () => {
  it('round-trips UTF-8 project text', () => {
    const text = '{"name":"实际走向绘制器","station":"木阳站"}'
    expect(__fileIOTest.decodeUtf8(__fileIOTest.textToBase64(text))).toBe(text)
  })
})
