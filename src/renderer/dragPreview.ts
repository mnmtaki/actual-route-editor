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


export function getDragAffectedLineIds(project: ActualRouteProject, target: DragPreviewTarget | null): Set<string> {
  const ids = new Set<string>()
  if (!target) return ids
  if (target.kind === 'draggingStation' && target.id) {
    for (const relation of project.stationLineRelations) if (relation.stationId === target.id) ids.add(relation.lineId)
    for (const line of project.lines) if (line.stationSequence.includes(target.id)) ids.add(line.id)
    for (const segment of project.geometry.segments) {
      if (segment.fromStationId === target.id || segment.toStationId === target.id) ids.add(segment.lineId)
    }
    return ids
  }
  if ((target.kind === 'draggingWaypoint' || target.kind === 'draggingStructureNode') && target.segmentId) {
    const lineId = project.geometry.segments.find(segment => segment.id === target.segmentId)?.lineId
    if (lineId) ids.add(lineId)
  }
  return ids
}


export interface DragStationOverlay {
  stationIds: Set<string>
  markers: boolean
  labels: boolean
}

export function getDragStationOverlay(_project: ActualRouteProject, target: DragPreviewTarget | null): DragStationOverlay {
  const stationIds = new Set<string>()
  if (!target?.id || (target.kind !== 'draggingStation' && target.kind !== 'draggingLabel')) {
    return { stationIds, markers: false, labels: false }
  }
  stationIds.add(target.id)
  return {
    stationIds,
    markers: target.kind === 'draggingStation',
    labels: true,
  }
}


export interface DragLineLabelOverlay {
  labelIds: Set<string>
  source: 'native' | 'aarc' | null
  ownerLineId?: string
}

export function getDragLineLabelOverlay(project: ActualRouteProject, target: DragPreviewTarget | null): DragLineLabelOverlay {
  const labelIds = new Set<string>()
  if (!target?.id || target.kind !== 'draggingLineLabel') return { labelIds, source: null }
  labelIds.add(target.id)
  const source = project.textTags?.some(tag => tag.id === target.id) ? 'aarc' as const : 'native' as const
  return { labelIds, source, ownerLineId: target.ownerLineId }
}


export interface DragMapElementOverlay {
  elementIds: Set<string>
}

export function getDragMapElementOverlay(target: DragPreviewTarget | null): DragMapElementOverlay {
  const elementIds = new Set<string>()
  if (target?.kind === 'draggingMapElement' && target.id) elementIds.add(target.id)
  return { elementIds }
}

export interface DragVectorBasemapOverlay {
  kind: 'road' | 'basemap' | null
  objectIds: Set<string>
}

export function getDragVectorBasemapOverlay(target: DragPreviewTarget | null): DragVectorBasemapOverlay {
  const objectIds = new Set<string>()
  if (!target) return { kind: null, objectIds }
  if (target.kind === 'draggingRoadPoint' && target.ownerRoadId) {
    objectIds.add(target.ownerRoadId)
    return { kind: 'road', objectIds }
  }
  if ((target.kind === 'draggingBasemapPoint' || target.kind === 'draggingBasemapPath') && target.ownerPathId) {
    objectIds.add(target.ownerPathId)
    return { kind: 'basemap', objectIds }
  }
  return { kind: null, objectIds }
}

export function dragTouchesVectorBasemap(target: DragPreviewTarget | null): boolean {
  return getDragVectorBasemapOverlay(target).kind !== null
}
