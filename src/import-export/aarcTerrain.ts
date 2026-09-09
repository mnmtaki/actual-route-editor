import type { BasemapPathCategory } from '../data/model'
import { DEFAULT_BASEMAP_COLORS } from '../data/basemapPaths'

/** AARC terrain width is expressed in the source drawing coordinate system. */
export const AARC_TERRAIN_WORLD_WIDTH_PER_SOURCE_UNIT = 125 / 9

export interface AarcTerrainPreset {
  category: BasemapPathCategory
  color: string
}

const TERRAIN_PRESETS: Record<string, AarcTerrainPreset> = {
  '2': { category: 'water', color: '#C3E5EB' },
  '3': { category: 'terrain', color: '#CEEDA4' },
}

function finitePositive(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

export function resolveAarcTerrainPreset(colorPre: unknown): AarcTerrainPreset | null {
  const number = typeof colorPre === 'number' ? colorPre : Number(colorPre)
  if (!Number.isFinite(number)) return null
  return TERRAIN_PRESETS[String(number)] ?? null
}

export function parseAarcTerrainWidth(rawWidth: unknown): { raw: number; usedDefault: boolean } {
  const parsed = finitePositive(rawWidth)
  return parsed === null ? { raw: 1, usedDefault: true } : { raw: parsed, usedDefault: false }
}

export function resolveAarcTerrainWidth(rawWidth: unknown): number {
  return parseAarcTerrainWidth(rawWidth).raw * AARC_TERRAIN_WORLD_WIDTH_PER_SOURCE_UNIT
}

export function isValidAarcTerrainColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

export function resolveAarcTerrainAppearance(colorPre: unknown, rawColor: unknown): AarcTerrainPreset & { usedRawColor: boolean; usedFallbackColor: boolean } {
  const preset = resolveAarcTerrainPreset(colorPre)
  if (preset) return { ...preset, usedRawColor: false, usedFallbackColor: false }
  if (isValidAarcTerrainColor(rawColor)) return { category: 'other', color: rawColor, usedRawColor: true, usedFallbackColor: false }
  return { category: 'other', color: DEFAULT_BASEMAP_COLORS.other, usedRawColor: false, usedFallbackColor: true }
}
