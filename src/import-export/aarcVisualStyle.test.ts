import { describe, expect, it } from 'vitest'
import {
  AARC_DEFAULT_LINE_WIDTH,
  AARC_DEFAULT_STATION_NAME_FONT_SIZE,
  AARC_DEFAULT_STATION_RADIUS,
  AARC_DEFAULT_STATION_STROKE_WIDTH,
  convertAarcVisualStyle,
  getAarcLabelAlignmentOffset,
  getAarcLabelBlockMetrics,
  resolveAarcLabelAnchor,
  resolveAarcVisualMultipliers,
} from './aarcVisualStyle'

const config = { lineWidthMapped: { '1.5': { staSize: 0.9, staNameSize: 1.75 } } }

describe('AARC source visual semantics', () => {
  it('uses current upstream defaults and lineWidthMapped without measured magic numbers', () => {
    const multipliers = resolveAarcVisualMultipliers([{ width: 1.5 }], config)!
    expect(multipliers).toMatchObject({ lineWidth: 1.5, stationSize: 0.9, stationNameSize: 1.75, selectedWidthKey: '1.5' })
    const calibration = convertAarcVisualStyle([{ width: 1.5 }], config)!
    expect(calibration.settings.lineWidth).toBe(AARC_DEFAULT_LINE_WIDTH)
    expect(calibration.settings.aarcLineWidthReferenceRatio).toBe(1)
    expect(calibration.settings.stationSize).toBe(AARC_DEFAULT_STATION_RADIUS * 0.9 * 2)
    expect(calibration.stationStrokeWidth).toBe(AARC_DEFAULT_STATION_STROKE_WIDTH * 0.9)
    expect(calibration.settings.stationLabelSize).toBe(AARC_DEFAULT_STATION_NAME_FONT_SIZE * 1.75)
    expect(calibration.settings.stationForeignLabelSize).toBe(18 * 1.75)
  })

  it('honors explicit AARC config bases exactly', () => {
    const calibration = convertAarcVisualStyle([{ width: 2 }], {
      lineWidth: 16,
      ptStaSize: 12,
      ptStaLineWidth: 5,
      staNameFontSize: 30,
      staNameRowHeight: 36,
      staNameSubFontSize: 20,
      staNameSubRowHeight: 24,
      lineWidthMapped: { '2': { staSize: 1.25, staNameSize: 0.8 } },
    })!
    expect(calibration.settings.lineWidth).toBe(16)
    expect(calibration.settings.stationSize).toBe(30)
    expect(calibration.stationStrokeWidth).toBe(6.25)
    expect(calibration.settings.stationLabelSize).toBe(24)
    expect(calibration.settings.stationForeignLabelSize).toBe(16)
    expect(calibration.mainRowHeight).toBe(28.8)
    expect(calibration.subRowHeight).toBe(19.2)
  })

  it('falls back exactly like AARC saveStore when lineWidthMapped is absent', () => {
    const calibration = convertAarcVisualStyle([{ width: 1.5 }], {})!
    expect(calibration.multipliers.stationSize).toBe(1.5)
    expect(calibration.multipliers.stationNameSize).toBe(1.5)
    expect(calibration.settings.lineWidth).toBe(14)
    expect(calibration.settings.stationSize).toBe(30)
    expect(calibration.settings.stationLabelSize).toBe(39)
  })
})

describe('AARC station-label anchors', () => {
  it.each([
    [[16.2, 0], 'start', 'middle'],
    [[-16.2, 0], 'end', 'middle'],
    [[0, -16.2], 'middle', 'bottom'],
    [[0, 16.2], 'middle', 'top'],
    [[16.2, -16.2], 'start', 'bottom'],
    [[-16.2, -16.2], 'end', 'bottom'],
    [[16.2, 16.2], 'start', 'top'],
    [[-16.2, 16.2], 'end', 'top'],
  ] as const)('maps %j to %s/%s without changing the vector', (nameP, horizontalAlign, verticalAlign) => {
    expect(resolveAarcLabelAnchor(nameP)).toEqual({ anchorX: nameP[0], anchorY: nameP[1], horizontalAlign, verticalAlign })
  })

  it('uses AARC row heights instead of browser glyph measurements', () => {
    const metrics = getAarcLabelBlockMetrics(45.5, 31.5, 0, 2, 52.5, 35)
    expect(metrics).toEqual({ height: 122.5, primaryBaseline: 26.25, foreignBaselines: [70, 105] })
  })

  it('does not apply browser-measured anchor compensation', () => {
    expect(getAarcLabelAlignmentOffset('start', 'top')).toEqual({ x: 0, y: 0 })
    expect(getAarcLabelAlignmentOffset('end', 'bottom')).toEqual({ x: 0, y: 0 })
  })
})
