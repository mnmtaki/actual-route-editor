import type { ActualRouteProject } from '../data/model'

export type DragPreviewKind =
  | 'draggingStation'
  | 'draggingWaypoint'
  | 'draggingStructureNode'
  | 'draggingLabel'
  | 'draggingLineLabel'
  | 'draggingMapElement'
  | 'draggingLineLegend'
  | 'draggingBackground'
  | 'draggingBasemapPoint'
  | 'draggingBasemapPath'
  | 'draggingRoadPoint'

export interface DragPreviewTarget {
  kind: DragPreviewKind
  id?: string
  segmentId?: string
  ownerLineId?: string
  ownerPathId?: string
  ownerRoadId?: string
}

/**
 * Build a mutable preview shell for one drag without deep-cloning the whole
 * project. Unrelated collections and entities retain reference identity.
 *
 * This mirrors AARC's hot-path rule: mutate only the active editing surface
 * during pointer movement, and materialize the committed project once.
 */
export function cloneProjectForDrag(project: ActualRouteProject, target: DragPreviewTarget): ActualRouteProject {
  const next: ActualRouteProject = { ...project }

  if (target.kind === 'draggingStation' || target.kind === 'draggingLabel') {
    next.stations = project.stations.map(station => station.id === target.id ? { ...station } : station)
    if (target.kind === 'draggingStation') {
      next.stationLineRelations = project.stationLineRelations.map(relation =>
        relation.stationId === target.id
          ? { ...relation, anchor: relation.anchor ? { ...relation.anchor } : relation.anchor }
          : relation,
      )
    }
    return next
  }

  if (target.kind === 'draggingWaypoint' || target.kind === 'draggingStructureNode') {
    next.geometry = {
      ...project.geometry,
      segments: project.geometry.segments.map(segment => segment.id === target.segmentId
        ? {
            ...segment,
            waypoints: segment.waypoints.map(waypoint => ({ ...waypoint })),
            structureNodes: segment.structureNodes?.map(node => ({ ...node })),
          }
        : segment),
    }
    return next
  }

  if (target.kind === 'draggingLineLabel') {
    if (target.ownerLineId) {
      next.lines = project.lines.map(line => line.id === target.ownerLineId
        ? { ...line, lineBadges: line.lineBadges?.map(label => ({ ...label })) }
        : line)
    }
    if (project.textTags?.some(tag => tag.id === target.id)) {
      next.textTags = project.textTags.map(tag => tag.id === target.id ? { ...tag } : tag)
    }
    return next
  }

  if (target.kind === 'draggingMapElement') {
    next.mapElements = project.mapElements?.map(element => element.id === target.id ? { ...element } : element)
    return next
  }

  if (target.kind === 'draggingLineLegend') {
    next.lineLegend = project.lineLegend && project.lineLegend.id === target.id ? { ...project.lineLegend } : project.lineLegend
    return next
  }

  if (target.kind === 'draggingBackground') {
    next.background = project.background ? { ...project.background } : project.background
    return next
  }

  if (target.kind === 'draggingBasemapPoint' || target.kind === 'draggingBasemapPath') {
    next.basemapPaths = project.basemapPaths?.map(path => path.id === target.ownerPathId
      ? { ...path, points: path.points.map(point => ({ ...point })) }
      : path)
    return next
  }

  if (target.kind === 'draggingRoadPoint') {
    next.roads = project.roads?.map(road => road.id === target.ownerRoadId
      ? { ...road, points: road.points.map(point => ({ ...point })) }
      : road)
    return next
  }

  return next
}
