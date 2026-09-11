import { describe, expect, it } from 'vitest'
import { chooseAarcStyleId, convertAarcLineStyles, resolveAarcLayerGeometry, resolveAarcSegmentStyleId, resolveAarcStyle, resolveAarcStyleLayers } from './aarcStyle'
import type { AarcLineStyle } from '../data/model'

const styles: AarcLineStyle[] = [
  { id: '10', name: 'parent', layers: [{ color: '#123456', colorMode: 'fixed' as const, width: 1, dash: '2 1', cap: 'butt', join: 'round' }] },
  { id: '11', name: 'child', noBase: true, layers: [{ colorMode: 'line' as const, width: .5, opacity: .8, patternId: '4' }] },
]

describe('AARC line style semantic resolver', () => {
  it('resolves style -1 from the declared parent without mutating the registry', () => {
    const resolved = resolveAarcStyle('-1', styles, '10')
    expect(resolved?.id).toBe('10')
    expect(resolveAarcStyleLayers('-1', styles, '10')[0]).toMatchObject({ sourceStyleId: '10', inherited: true })
    expect(styles[0].layers[0].dash).toBe('2 1')
  })

  it('keeps multilayer width, dash, cap/join and pattern semantics', () => {
    const geometry = resolveAarcLayerGeometry(styles[0].layers[0], 14)
    expect(geometry).toMatchObject({ width: 14, dash: [28, 14], cap: 'butt', join: 'round' })
    expect(resolveAarcStyle('11', styles)?.noBase).toBe(true)
    expect(resolveAarcStyle('11', styles)?.layers[0].patternId).toBe('4')
  })

  it('normalizes numeric style references deterministically', () => {
    expect(chooseAarcStyleId(-1)).toBe('-1')
    expect(chooseAarcStyleId('2')).toBe('2')
    expect(chooseAarcStyleId(undefined)).toBeUndefined()
  })
  it('keeps AARC style-slice sentinels distinct in the shared Segment model', () => {
    expect(resolveAarcSegmentStyleId(0)).toBeNull()
    expect(resolveAarcSegmentStyleId(-1)).toBeUndefined()
    expect(resolveAarcSegmentStyleId(11)).toBe('11')
  })
  it('converts the source registry into shared ratio-based render layers', () => {
    const converted = convertAarcLineStyles(styles)
    expect(converted[0]).toMatchObject({ id: '10', name: 'parent' })
    expect(converted[0].layers[0]).toMatchObject({ width: 1, widthMode: 'ratio', dash: [2, 1], dashMode: 'ratio', lineCap: 'butt' })
    expect(converted[1]).toMatchObject({ id: '11', hideBaseLine: true })
    expect(converted[1].layers[0]).toMatchObject({ colorMode: 'followLine', sourcePatternId: '4' })
  })

  it('treats an omitted source colorMode as the upstream fixed default', () => {
    const converted = convertAarcLineStyles([{ id: '12', layers: [{ color: '#abcdef', width: 1 }] }])
    expect(converted[0].layers[0]).toMatchObject({ colorMode: 'custom', color: '#abcdef' })
  })

})
