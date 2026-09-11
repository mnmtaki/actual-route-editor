import type { ActualRouteProject } from '../data/model'
import { getStationLineTangent } from './tangent'

export type SideMarkerSide = 'left' | 'right'
export interface SideMarkerPlacement { x: number; y: number; rotation: number; side: SideMarkerSide; normal: { x: number; y: number } }

/**
 * Place a side marker from the local line tangent.  The normal is canonicalized
 * to screen-up first, so a marker does not flip sides when a segment heading is
 * represented in the opposite direction.
 */
export function resolveSideMarkerPlacement(project: ActualRouteProject, stationId: string, lineId: string, offset = 14, preferredSide: 'auto' | SideMarkerSide = 'auto'): SideMarkerPlacement {
  const station = project.stations.find(item => item.id === stationId)
  if (!station) return { x: 0, y: 0, rotation: 0, side: 'right', normal: { x: 0, y: -1 } }
  const angle = getStationLineTangent(project, stationId, lineId) * Math.PI / 180
  let normal = { x: -Math.sin(angle), y: Math.cos(angle) }
  if (normal.y > 1e-9 || (Math.abs(normal.y) <= 1e-9 && normal.x < 0)) normal = { x: -normal.x, y: -normal.y }
  const side: SideMarkerSide = preferredSide === 'left' ? 'left' : preferredSide === 'right' ? 'right' : 'right'
  if (side === 'left') normal = { x: -normal.x, y: -normal.y }
  return { x: station.x + normal.x * Math.max(0, offset), y: station.y + normal.y * Math.max(0, offset), rotation: 0, side, normal }
}

export const getSideMarkerPlacement = resolveSideMarkerPlacement
