import type { ActualRouteProject, Segment } from '../data/model'
import { getStationAnchorForLine } from '../data/stationAnchor'
import { effectiveLineWidth } from '../data/style'
import { resolveLineStyle, resolveLineStyleLayers } from '../data/lineStyles'
import { getStationLineTangent } from './tangent'

export type SideMarkerSide = 'left' | 'right'
export type SideMarkerPlacementMode = 'outward' | 'inward'

export interface SideMarkerOptions {
  placementMode?: SideMarkerPlacementMode
  preferredSide?: 'auto' | SideMarkerSide
  /** Override the measured body width only for deterministic previews/tests. */
  lineWidth?: number
  depth?: number
  thickness?: number
  depthRatio?: number
  thicknessRatio?: number
}

export interface SideMarkerPlacement {
  x: number
  y: number
  rotation: number
  side: SideMarkerSide
  normal: { x: number; y: number }
  anchorX: number
  anchorY: number
  lineWidth: number
  depth: number
  thickness: number
  placementMode: SideMarkerPlacementMode
}

/**
 * Resolve one stable, line-attached marker placement.  The numeric overload is
 * retained for the pre-preset helper contract: it returns a simple offset from
 * the station anchor.  New callers should pass SideMarkerOptions so the marker
 * is placed against the effective rendered line body.
 */
export function resolveSideMarkerPlacement(project: ActualRouteProject, stationId: string, lineId: string, offset?: number, preferredSide?: 'auto' | SideMarkerSide): SideMarkerPlacement
export function resolveSideMarkerPlacement(project: ActualRouteProject, stationId: string, lineId: string, options?: SideMarkerOptions): SideMarkerPlacement
export function resolveSideMarkerPlacement(project: ActualRouteProject, stationId: string, lineId: string, optionsOrOffset: SideMarkerOptions | number = {}, legacyPreferredSide: 'auto' | SideMarkerSide = 'auto'): SideMarkerPlacement {
  const station = project.stations.find(item => item.id === stationId)
  const fallbackAnchor = station ?? { x: 0, y: 0 }
  const anchor = station ? (getStationAnchorForLine(project, stationId, lineId) ?? station) : fallbackAnchor
  const angle = getStationLineTangent(project, stationId, lineId)
  const angleRadians = angle * Math.PI / 180
  let normal = canonicalNormal(angleRadians)
  const legacy = typeof optionsOrOffset === 'number'
  const options: SideMarkerOptions = legacy ? { depth: Math.max(0, optionsOrOffset), preferredSide: legacyPreferredSide } : optionsOrOffset
  const side: SideMarkerSide = options.preferredSide === 'left' ? 'left' : 'right'
  if (side === 'left') normal = { x: -normal.x, y: -normal.y }

  const lineWidth = Math.max(0.0001, finitePositive(options.lineWidth, getEffectiveRenderedLineWidthAtStation(project, stationId, lineId)))
  if (legacy) {
    const offset = Math.max(0, optionsOrOffset as number)
    return {
      x: anchor.x + normal.x * offset,
      y: anchor.y + normal.y * offset,
      // Preserve the legacy helper's pre-preset rotation contract.  New
      // option-based placements use the local tangent angle below.
      rotation: 0,
      side,
      normal,
      anchorX: anchor.x,
      anchorY: anchor.y,
      lineWidth,
      depth: 0,
      thickness: 0,
      placementMode: 'outward',
    }
  }

  const placementMode = options.placementMode === 'inward' ? 'inward' : 'outward'
  const depthRatio = finitePositive(options.depthRatio, 1)
  const thicknessRatio = finitePositive(options.thicknessRatio, .6)
  const requestedDepth = finitePositive(options.depth, lineWidth * depthRatio)
  // An inward marker must leave part of the line visible.  Keep this clamp in
  // the shared geometry primitive so every renderer enforces the same rule.
  const depth = placementMode === 'inward'
    ? Math.min(Math.max(0.01, requestedDepth), Math.max(0.01, lineWidth - 1e-6))
    : requestedDepth
  const thickness = finitePositive(options.thickness, lineWidth * thicknessRatio)
  const centerNormalOffset = placementMode === 'inward' ? lineWidth / 2 - depth / 2 : lineWidth / 2 + depth / 2
  return {
    x: anchor.x + normal.x * centerNormalOffset,
    y: anchor.y + normal.y * centerNormalOffset,
    rotation: angle,
    side,
    normal,
    anchorX: anchor.x,
    anchorY: anchor.y,
    lineWidth,
    depth,
    thickness,
    placementMode,
  }
}

/** Effective visible body width at a station, including segment style layers. */
export function getEffectiveRenderedLineWidthAtStation(project: ActualRouteProject, stationId: string, lineId: string): number {
  const line = project.lines.find(item => item.id === lineId)
  if (!line) return Math.max(0.0001, project.settings.lineWidth)
  const baseWidth = Math.max(0.0001, effectiveLineWidth(line, project.settings))
  const connected = project.geometry.segments.filter(segment => segment.lineId === lineId && (segment.fromStationId === stationId || segment.toStationId === stationId))
  const widths = [baseWidth]
  for (const segment of connected) {
    const style = resolveLineStyle(project, line, segment)
    if (!style) continue
    const layers = resolveLineStyleLayers(style, line.color, baseWidth)
    if (style.hideBaseLine !== true) widths.push(baseWidth)
    for (const layer of layers) widths.push(layer.resolvedWidth)
  }
  return Math.max(...widths)
}

function canonicalNormal(angle: number) {
  let normal = { x: -Math.sin(angle), y: Math.cos(angle) }
  // Keep auto placement on the screen-up side.  The axis angle is already
  // canonicalized, so this sign choice is stable across reversed geometry.
  if (normal.y > 1e-9 || (Math.abs(normal.y) <= 1e-9 && normal.x < 0)) normal = { x: -normal.x, y: -normal.y }
  return normal
}

function finitePositive(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export const getSideMarkerPlacement = resolveSideMarkerPlacement
