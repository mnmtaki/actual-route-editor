import { describe, expect, it } from 'vitest'
import { DEFAULT_METERS_PER_WORLD_UNIT, calibrationMetersPerWorldUnit, resolveMetersPerWorldUnit, worldUnitsToKilometers } from './distance'
import { DEFAULT_SETTINGS } from './model'

describe('distance scale', () => {
  it('keeps the legacy 100 world units per kilometre as 10 m/unit', () => {
    expect(resolveMetersPerWorldUnit({ settings: { ...DEFAULT_SETTINGS, worldUnitsPerKm: 100 } })).toBe(DEFAULT_METERS_PER_WORLD_UNIT)
  })
  it('prefers an explicit meters-per-world-unit scale', () => {
    const project = { settings: { ...DEFAULT_SETTINGS, worldUnitsPerKm: 100 }, distanceScale: { metersPerWorldUnit: 2.5 } }
    expect(resolveMetersPerWorldUnit(project)).toBe(2.5)
    expect(worldUnitsToKilometers(400, project)).toBe(1)
  })
  it('falls back safely for invalid explicit scales', () => {
    expect(resolveMetersPerWorldUnit({ settings: { ...DEFAULT_SETTINGS, worldUnitsPerKm: 50 }, distanceScale: { metersPerWorldUnit: 0 } })).toBe(20)
  })
  it('calculates calibration from world points without mutating coordinates', () => {
    const a = { x: 10, y: 20 }, b = { x: 110, y: 20 }
    expect(calibrationMetersPerWorldUnit(a, b, 250, 'm')).toBe(2.5)
    expect(calibrationMetersPerWorldUnit(a, b, 1, 'km')).toBe(10)
    expect(a).toEqual({ x: 10, y: 20 })
    expect(calibrationMetersPerWorldUnit(a, a, 10, 'm')).toBeNull()
  })
})
