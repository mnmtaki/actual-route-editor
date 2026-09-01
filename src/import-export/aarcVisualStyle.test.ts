import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../data/model'
import {
  AARC_BASE_CHINESE_LABEL_VISUAL_HEIGHT,
  AARC_FOREIGN_TO_CHINESE_VISUAL_RATIO,
  AARC_SVG_CHINESE_VISIBLE_HEIGHT_PER_FONT_SIZE,
  AARC_SVG_FOREIGN_VISIBLE_HEIGHT_PER_FONT_SIZE,
  convertAarcVisualStyle,
  getAarcLabelAlignmentOffset,
  getAarcLabelBlockMetrics,
  resolveAarcLabelAnchor,
  resolveAarcVisualMultipliers,
} from './aarcVisualStyle'

const config = { lineWidthMapped: { '1.5': { staSize: 0.9, staNameSize: 1.75 } } }

describe('AARC visual calibration', () => {
  it('reads lineWidthMapped and converts the measured 木阳 multipliers', () => {
    const multipliers = resolveAarcVisualMultipliers([{ width: 1.5 }], config)!
    expect(multipliers).toMatchObject({ lineWidth: 1.5, stationSize: 0.9, stationNameSize: 1.75, selectedWidthKey: '1.5' })
    const calibration = convertAarcVisualStyle([{ width: 1.5 }], config)!
    expect(calibration.settings.lineWidth).toBeCloseTo(22.035, 3)
    expect(calibration.settings.stationSize).toBeCloseTo(14, 6)
    expect(calibration.chineseVisualHeight).toBeCloseTo(44.485, 3)
    expect(calibration.foreignVisualHeight).toBeCloseTo(30.25, 2)
    expect(calibration.settings.stationLabelSize * AARC_SVG_CHINESE_VISIBLE_HEIGHT_PER_FONT_SIZE).toBeCloseTo(44.485, 3)
    expect(calibration.settings.stationForeignLabelSize * AARC_SVG_FOREIGN_VISIBLE_HEIGHT_PER_FONT_SIZE).toBeCloseTo(30.25, 2)
  })

  it('keeps the accepted transfer proportions relative to the calibrated global line width', () => {
    const settings = convertAarcVisualStyle([{ width: 1.5 }], config)!.settings
    expect(settings.transferMinorAxis / settings.lineWidth).toBeCloseTo(DEFAULT_SETTINGS.transferMinorAxis / DEFAULT_SETTINGS.lineWidth)
    expect(settings.transferEndPadding / settings.lineWidth).toBeCloseTo(DEFAULT_SETTINGS.transferEndPadding / DEFAULT_SETTINGS.lineWidth)
    expect(settings.transferDotGap).toBe(5)
  })

  it('returns no calibration when the AARC mapping is unavailable', () => {
    expect(convertAarcVisualStyle([{ width: 1.5 }], {})).toBeNull()
  })
})

describe('AARC bilingual label block anchors', () => {
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
    const resolved = resolveAarcLabelAnchor(nameP)
    expect(resolved).toEqual({ anchorX: nameP[0], anchorY: nameP[1], horizontalAlign, verticalAlign })
  })

  it('computes one block height for Chinese plus multiple foreign lines', () => {
    const labelSize = AARC_BASE_CHINESE_LABEL_VISUAL_HEIGHT * 1.75 / AARC_SVG_CHINESE_VISIBLE_HEIGHT_PER_FONT_SIZE
    const foreignSize = labelSize * AARC_FOREIGN_TO_CHINESE_VISUAL_RATIO
    const one = getAarcLabelBlockMetrics(labelSize, foreignSize, 3, 1)
    const two = getAarcLabelBlockMetrics(labelSize, foreignSize, 3, 2)
    expect(two.height).toBeGreaterThan(one.height)
    expect(two.foreignBaselines).toHaveLength(2)
    expect(two.primaryBaseline).toBe(one.primaryBaseline)
  })

  it('keeps font edge compensation separate from the untouched nameP vector', () => {
    expect(getAarcLabelAlignmentOffset('start', 'top')).toEqual({ x: 0, y: 0.412 })
    expect(getAarcLabelAlignmentOffset('end', 'bottom')).toEqual({ x: -0.326, y: 0.47 })
  })
})
