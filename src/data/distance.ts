import type { ActualRouteProject, DistanceScale } from './model'

/** The legacy default was 100 world units per kilometre, which is 10 m/unit. */
export const DEFAULT_METERS_PER_WORLD_UNIT = 10

type DistanceProject = Pick<ActualRouteProject, 'distanceScale' | 'settings'>

export function normalizeDistanceScale(value: unknown): DistanceScale | undefined {
  if (!value || typeof value !== 'object') return undefined
  const meters = (value as { metersPerWorldUnit?: unknown }).metersPerWorldUnit
  return typeof meters === 'number' && Number.isFinite(meters) && meters > 0 ? { metersPerWorldUnit: meters } : undefined
}

export function resolveMetersPerWorldUnit(project: DistanceProject): number {
  const explicit = normalizeDistanceScale(project.distanceScale)
  if (explicit) return explicit.metersPerWorldUnit
  const legacy = project.settings?.worldUnitsPerKm
  if (typeof legacy === 'number' && Number.isFinite(legacy) && legacy > 0) return 1000 / legacy
  return DEFAULT_METERS_PER_WORLD_UNIT
}

export function worldUnitsToMeters(distance: number, project: DistanceProject): number {
  return distance * resolveMetersPerWorldUnit(project)
}

export function worldUnitsToKilometers(distance: number, project: DistanceProject): number {
  return worldUnitsToMeters(distance, project) / 1000
}

export function calibrationMetersPerWorldUnit(a: { x: number; y: number }, b: { x: number; y: number }, actualDistance: number, unit: 'm' | 'km' = 'm'): number | null {
  const distance = Math.hypot(b.x - a.x, b.y - a.y)
  const meters = unit === 'km' ? actualDistance * 1000 : actualDistance
  if (!Number.isFinite(distance) || distance <= 1e-6 || !Number.isFinite(meters) || meters <= 0) return null
  return meters / distance
}
