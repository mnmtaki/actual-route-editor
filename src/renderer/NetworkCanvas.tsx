import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ActualRouteProject, Road, Selection } from '../data/model'
import { uid } from '../data/model'
import { findSegmentProgressForPoint, getSegmentPath, getSegmentRoundedCornerPlans, getSegmentSubpathSpans, pathSpansToSvgPath } from '../geometry/path'
import { projectPointToSvgPath, screenPointToWorld } from '../geometry/screenPoint'
import { getActiveNetworkAtTime, getEditorVisibleStationsAtTime } from '../timeline/active'
import { StationMarker } from './StationMarker'
import { getStationHandleStyle } from './stationHandle'
import { SegmentArtwork, StructureRunArtwork } from './segmentStyles'
import { compileElevatedRuns, getSegmentStyleIntervalAtProgress, getSegmentStyleIntervals, getStructureNodePoint } from '../data/structure'
import { MapElementsLayer } from './MapElements'
import { AarcTextTagsLayer } from './AarcTextTags'
import { AarcPointLinksLayer } from './AarcPointLinks'
import { LineLegendLayer } from './LineLegend'
import { LineBadgesLayer } from './LineBadges'
import { VectorBasemapLayer } from './VectorBasemap'
import { AarcFakeLinesLayer } from './AarcFakeLines'
import { compileAarcLineArtworkRuns } from './lineArtworkRuns'
import { isFakeLine } from '../data/fakeLines'
import type { DrawingMode, LineDraftPoint } from '../data/basemapPaths'
import { effectiveLineWidth, effectiveStationStyle, snapLabelOffset } from '../data/style'
import { getLineStyle, resolveLineStyle } from '../data/lineStyles'
import { isSegmentGeometryLocked, isStationGeometryLocked, lockedStationMessage } from '../data/lineLock'
import { translateStationWithAnchors } from '../data/stationAnchor'
import { lineWithEffectiveColor } from '../data/lineIdentity'
import { projectWithLineParentsAt } from '../data/lineParentHistory'
import { projectWithLineColorsAt } from '../data/lineColorHistory'
import { getCompoundStationCanonical, isCompoundStationCanonical } from '../data/compoundStation'
import { appendStationToLineWithWaypoints, connectExistingStationWithWaypoints, demoteTerminalStationToDrawingPoint } from '../data/operations'

type View = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }
type Gesture =
  | { kind: 'idle' }
  | { kind: 'panningCanvas'; pointerId: number; lastClient: Point }
  | { kind: 'calibrationTap'; pointerId: number; startClient: Point; lastClient: Point; moved: boolean }
  | { kind: 'pinchingCanvas'; pointerIds: [number, number]; initialDistance: number; startView: View; startWorld: Point }
  | { kind: 'draggingStation' | 'draggingWaypoint' | 'draggingStructureNode' | 'draggingLabel' | 'draggingLineLabel' | 'draggingMapElement' | 'draggingLineLegend' | 'draggingBackground' | 'draggingBasemapPoint' | 'draggingBasemapPath' | 'draggingRoadPoint'; pointerId: number; id?: string; segmentId?: string; ownerLineId?: string; ownerPathId?: string; ownerRoadId?: string; startWorld: Point; origin: Point; before: ActualRouteProject; latest: ActualRouteProject; moved: boolean }

type LineDraftState = { lineId: string; phaseId?: string; anchorStationId: string | null; points: LineDraftPoint[]; lastCreatedStationId?: string }
type DrawingPointSelection = { kind: 'draft'; id: string } | { kind: 'station'; id: string } | null
type DrawingCanvasPointer = { pointerId: number; startClient: Point; lastClient: Point; moved: boolean }

export function NetworkCanvas({ project, selection, selectedStationIds = [], onToggleStationSelection, drawing, roadDraft, phasePreview, calibration, onCalibrationPoint, onSelect, onCreatePoint, onConnectStation, onExtend, onFinishDrawing, onSegmentPoint, onPreview, onDragCommit, onEditBlocked, view, setView }: {
  project: ActualRouteProject; selection: Selection; drawing: DrawingMode | null; roadDraft?: Road | null; phasePreview?: { segmentIds: string[]; stationIds: string[] } | null
  calibration?: { points: Point[] } | null; onCalibrationPoint?: (point: Point) => void
  selectedStationIds?: string[]; onToggleStationSelection?: (stationId: string) => void
  onSelect: (selection: Selection) => void; onCreatePoint: (point: Point) => void; onConnectStation: (id: string) => void; onExtend: (id: string) => void; onFinishDrawing?: () => void
  onSegmentPoint: (id: string, point: Point) => void; onPreview: (project: ActualRouteProject) => void; onDragCommit: (before: ActualRouteProject, next: ActualRouteProject) => void; onEditBlocked?: (message: string) => void
  view: View; setView: React.Dispatch<React.SetStateAction<View>>
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const gesture = useRef<Gesture>({ kind: 'idle' })
  const pointers = useRef(new Map<number, Point>())
  const drawingClick = useRef<{ time: number; x: number; y: number } | null>(null)
  const pointerDoubleFinish = useRef(false)
  const draftDrag = useRef<{ pointerId: number; id: string } | null>(null)
  const lineCanvasPointer = useRef<DrawingCanvasPointer | null>(null)
  const basemapCanvasPointer = useRef<DrawingCanvasPointer | null>(null)
  const [preview, setPreview] = useState<ActualRouteProject | null>(null)
  const [canvasWidth, setCanvasWidth] = useState(920)
  const [lineDraft, setLineDraft] = useState<LineDraftState | null>(null)
  const [drawingPointSelection, setDrawingPointSelection] = useState<DrawingPointSelection>(null)
  const shown = preview ?? project
  const active = useMemo(() => getActiveNetworkAtTime(shown, shown.timeline.currentDate), [shown])
  const editorStations = useMemo(() => getEditorVisibleStationsAtTime(shown, shown.timeline.currentDate), [shown])
  const historicalIdentityProject = useMemo(() => projectWithLineColorsAt(projectWithLineParentsAt(shown, shown.timeline.currentDate), shown.timeline.currentDate), [shown])
  const activeProject = useMemo(() => {
    const effectiveById = new Map(active.segments.map(segment => [segment.id, segment]))
    return { ...historicalIdentityProject, geometry: { ...shown.geometry, segments: shown.geometry.segments.map(segment => effectiveById.get(segment.id) ?? segment) } }
  }, [shown.geometry, historicalIdentityProject, active.segments])
  const elevatedRuns = useMemo(() => compileElevatedRuns(activeProject, new Set(active.segments.map(segment => segment.id))), [activeProject, active.segments])
  const touchHitPixels = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 699px)').matches ? 44 : 28
  const stationHitRadius = Math.max(20, touchHitPixels * view.width / canvasWidth)
  const structureHitRadius = Math.max(22, touchHitPixels * view.width / canvasWidth)

  useLayoutEffect(() => {
    const element = svgRef.current
    if (!element) return
    const update = () => setCanvasWidth(Math.max(1, element.getBoundingClientRect().width))
    update()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])
  useEffect(() => { if (!drawing) drawingClick.current = null }, [drawing])
  useEffect(() => {
    if (drawing?.kind === 'line') {
      setLineDraft({ lineId: drawing.lineId, phaseId: drawing.phaseId, anchorStationId: drawing.anchorStationId, points: drawing.draftPoints ?? [], lastCreatedStationId: drawing.lastCreatedStationId })
    } else setLineDraft(null)
    setDrawingPointSelection(null)
  }, [drawing?.kind, drawing?.kind === 'line' ? drawing.lineId : undefined, drawing?.kind === 'line' ? drawing.phaseId : undefined, drawing?.kind === 'line' ? drawing.anchorStationId : undefined])

  const pointerToWorld = (clientX: number, clientY: number): Point => screenPointToWorld(svgRef.current!, clientX, clientY, view)
  const capture = (event: React.PointerEvent) => event.currentTarget.setPointerCapture?.(event.pointerId)
  const beginPinch = () => {
    const points = [...pointers.current.entries()].slice(0, 2)
    if (points.length < 2) return
    lineCanvasPointer.current = null
    basemapCanvasPointer.current = null
    const [[firstId, first], [secondId, second]] = points
    const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
    const initialDistance = Math.hypot(second.x - first.x, second.y - first.y)
    if (initialDistance < 1) return
    const previous = gesture.current
    if (previous.kind !== 'idle') {
      if (previous.kind !== 'panningCanvas' && previous.kind !== 'pinchingCanvas' && 'before' in previous) onPreview(previous.before)
      setPreview(null)
    }
    gesture.current = { kind: 'pinchingCanvas', pointerIds: [firstId, secondId], initialDistance, startView: view, startWorld: pointerToWorld(center.x, center.y) }
  }
  const startObjectDrag = (kind: Extract<Gesture, { before: ActualRouteProject }>['kind'], event: React.PointerEvent, origin: Point, id?: string, segmentId?: string, ownerLineId?: string, ownerPathId?: string, ownerRoadId?: string) => {
    event.stopPropagation(); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); capture(event)
    if (pointers.current.size >= 2) { beginPinch(); return false }
    gesture.current = { kind, pointerId: event.pointerId, id, segmentId, ownerLineId, ownerPathId, ownerRoadId, startWorld: pointerToWorld(event.clientX, event.clientY), origin, before: project, latest: project, moved: false }
    setPreview(project)
    return true
  }

  const addDraftPointAt = (position: Point) => {
    if (!lineDraft?.anchorStationId) return
    const point = { id: uid('draft-waypoint'), x: position.x, y: position.y }
    setLineDraft(current => current ? { ...current, points: [...current.points, point] } : current)
    setDrawingPointSelection({ kind: 'draft', id: point.id })
  }

  const addDraftPoint = () => {
    if (!lineDraft?.anchorStationId) return
    const anchor = shown.stations.find(item => item.id === lineDraft.anchorStationId)
    if (!anchor) return
    const existing = lineDraft.points
    const last = existing.at(-1) ?? anchor
    const previous = existing.length >= 2 ? existing[existing.length - 2] : existing.length === 1 ? anchor : null
    let dx = previous ? last.x - previous.x : 0, dy = previous ? last.y - previous.y : 0
    if (!previous || Math.hypot(dx, dy) < 1e-6) {
      const handle = getStationHandleStyle(shown, anchor.id, shown.timeline.currentDate)
      dx = handle.x - anchor.x; dy = handle.y - anchor.y
    }
    if (Math.hypot(dx, dy) < 1e-6) { dx = 1; dy = 0 }
    const length = Math.hypot(dx, dy), distance = 86
    addDraftPointAt({ x: last.x + dx / length * distance, y: last.y + dy / length * distance })
  }

  const promoteDraftPoint = (id: string) => {
    if (!lineDraft?.anchorStationId) return
    const index = lineDraft.points.findIndex(item => item.id === id)
    if (index < 0) return
    const point = lineDraft.points[index]
    const before = lineDraft.points.slice(0, index)
    const after = lineDraft.points.slice(index + 1)
    const result = appendStationToLineWithWaypoints(project, lineDraft.lineId, point, before, lineDraft.anchorStationId, lineDraft.phaseId)
    onDragCommit(project, result.project)
    setLineDraft({ ...lineDraft, anchorStationId: result.stationId, points: after, lastCreatedStationId: result.stationId })
    setDrawingPointSelection(null)
    onSelect({ type: 'station', id: result.stationId })
  }

  const removeDraftPoint = (id: string) => {
    setLineDraft(current => current ? { ...current, points: current.points.filter(item => item.id !== id) } : current)
    setDrawingPointSelection(null)
  }

  const demoteCurrentStation = (stationId: string) => {
    if (!lineDraft || lineDraft.lastCreatedStationId !== stationId) return
    const result = demoteTerminalStationToDrawingPoint(project, lineDraft.lineId, stationId)
    if (!result) return
    onDragCommit(project, result.project)
    setLineDraft({ ...lineDraft, anchorStationId: result.anchorStationId, points: [...result.draftPoints, ...lineDraft.points], lastCreatedStationId: undefined })
    setDrawingPointSelection({ kind: 'draft', id: result.draftPoints.at(-1)!.id })
    onSelect(null)
  }

  const connectDrawingToStation = (stationId: string) => {
    if (!lineDraft?.anchorStationId || stationId === lineDraft.anchorStationId) {
      if (lineDraft?.lastCreatedStationId === stationId) setDrawingPointSelection({ kind: 'station', id: stationId })
      return
    }
    const station = project.stations.find(item => item.id === stationId)
    if (!station || !confirm(`连接到已有站“${station.name ?? '未命名站'}”？`)) return
    const result = connectExistingStationWithWaypoints(project, lineDraft.lineId, stationId, lineDraft.points, lineDraft.anchorStationId, lineDraft.phaseId)
    onDragCommit(project, result.project)
    setLineDraft({ ...lineDraft, anchorStationId: stationId, points: [], lastCreatedStationId: undefined })
    setDrawingPointSelection(null)
    onSelect({ type: 'station', id: stationId })
  }

  const handleCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size >= 2) { capture(event); beginPinch(); return }
    if (calibration) { capture(event); gesture.current = { kind: 'calibrationTap', pointerId: event.pointerId, startClient: { x: event.clientX, y: event.clientY }, lastClient: { x: event.clientX, y: event.clientY }, moved: false }; return }
    const target = event.target as Element
    if (drawing?.kind === 'line') {
      const isCanvasBlank = target === event.currentTarget || target.classList.contains('canvas-bg')
      if (!isCanvasBlank) return
      if (!lineDraft?.anchorStationId) {
        const point = pointerToWorld(event.clientX, event.clientY)
        const result = appendStationToLineWithWaypoints(project, drawing.lineId, point, [], null, drawing.phaseId)
        onDragCommit(project, result.project)
        setLineDraft({ lineId: drawing.lineId, phaseId: drawing.phaseId, anchorStationId: result.stationId, points: [], lastCreatedStationId: result.stationId })
        onSelect({ type: 'station', id: result.stationId })
        return
      }
      capture(event)
      lineCanvasPointer.current = { pointerId: event.pointerId, startClient: { x: event.clientX, y: event.clientY }, lastClient: { x: event.clientX, y: event.clientY }, moved: false }
      return
    }
    if (drawing?.kind === 'basemap') {
      const isCanvasBlank = target === event.currentTarget || target.classList.contains('canvas-bg')
      if (!isCanvasBlank) return
      const now = Date.now(), previous = drawingClick.current
      const isDouble = previous && now - previous.time < 360 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 12
      if (isDouble) { drawingClick.current = null; pointerDoubleFinish.current = true; onFinishDrawing?.(); return }
      drawingClick.current = { time: now, x: event.clientX, y: event.clientY }
      capture(event)
      basemapCanvasPointer.current = { pointerId: event.pointerId, startClient: { x: event.clientX, y: event.clientY }, lastClient: { x: event.clientX, y: event.clientY }, moved: false }
      return
    }
    if (drawing) {
      const now = Date.now(), previous = drawingClick.current
      const isDouble = previous && now - previous.time < 360 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 12
      if (isDouble) { drawingClick.current = null; pointerDoubleFinish.current = true; onFinishDrawing?.(); return }
      drawingClick.current = { time: now, x: event.clientX, y: event.clientY }
      onCreatePoint(pointerToWorld(event.clientX, event.clientY)); return
    }
    if (target !== event.currentTarget && !target.classList.contains('canvas-bg')) return
    onSelect(null); capture(event)
    gesture.current = { kind: 'panningCanvas', pointerId: event.pointerId, lastClient: { x: event.clientX, y: event.clientY } }
  }
  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (draftDrag.current?.pointerId === event.pointerId) {
      const point = pointerToWorld(event.clientX, event.clientY)
      const id = draftDrag.current.id
      setLineDraft(current => current ? { ...current, points: current.points.map(item => item.id === id ? { ...item, x: point.x, y: point.y } : item) } : current)
      return
    }
    if (lineCanvasPointer.current?.pointerId === event.pointerId) {
      const current = lineCanvasPointer.current
      const dx = event.clientX - current.startClient.x, dy = event.clientY - current.startClient.y
      current.moved ||= Math.hypot(dx, dy) > 6
      if (current.moved) {
        const before = pointerToWorld(current.lastClient.x, current.lastClient.y), after = pointerToWorld(event.clientX, event.clientY)
        current.lastClient = { x: event.clientX, y: event.clientY }
        setView(value => ({ ...value, x: value.x - (after.x - before.x), y: value.y - (after.y - before.y) }))
      }
      return
    }
    if (basemapCanvasPointer.current?.pointerId === event.pointerId) {
      const current = basemapCanvasPointer.current
      const dx = event.clientX - current.startClient.x, dy = event.clientY - current.startClient.y
      current.moved ||= Math.hypot(dx, dy) > 6
      if (current.moved) {
        const before = pointerToWorld(current.lastClient.x, current.lastClient.y), after = pointerToWorld(event.clientX, event.clientY)
        current.lastClient = { x: event.clientX, y: event.clientY }
        setView(value => ({ ...value, x: value.x - (after.x - before.x), y: value.y - (after.y - before.y) }))
      }
      return
    }
    const current = gesture.current
    if (current.kind === 'pinchingCanvas') {
      const first = pointers.current.get(current.pointerIds[0]), second = pointers.current.get(current.pointerIds[1])
      if (!first || !second) return
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      if (distance < 1) return
      const scale = Math.max(.2, Math.min(5, current.initialDistance / distance))
      const width = current.startView.width * scale, height = current.startView.height * scale
      const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      const underStart = screenPointToWorld(svgRef.current!, center.x, center.y, current.startView)
      setView({ x: current.startWorld.x - (underStart.x - current.startView.x) * scale, y: current.startWorld.y - (underStart.y - current.startView.y) * scale, width, height })
      return
    }
    if (current.kind === 'calibrationTap') {
      if (current.pointerId !== event.pointerId) return
      const dx = event.clientX - current.startClient.x, dy = event.clientY - current.startClient.y
      current.moved ||= Math.hypot(dx, dy) > 6
      if (current.moved) {
        const before = pointerToWorld(current.lastClient.x, current.lastClient.y), after = pointerToWorld(event.clientX, event.clientY)
        current.lastClient = { x: event.clientX, y: event.clientY }
        setView(value => ({ ...value, x: value.x - (after.x - before.x), y: value.y - (after.y - before.y) }))
      }
      return
    }
    if (current.kind === 'idle' || current.pointerId !== event.pointerId) return
    if (current.kind === 'panningCanvas') {
      const before = pointerToWorld(current.lastClient.x, current.lastClient.y)
      const after = pointerToWorld(event.clientX, event.clientY)
      current.lastClient = { x: event.clientX, y: event.clientY }
      setView(value => ({ ...value, x: value.x - (after.x - before.x), y: value.y - (after.y - before.y) }))
      return
    }
    const point = pointerToWorld(event.clientX, event.clientY)
    const dx = point.x - current.startWorld.x, dy = point.y - current.startWorld.y
    current.moved ||= Math.hypot(dx, dy) > 1
    const next = structuredClone(current.before)
    if (current.kind === 'draggingStation') {
      const station = next.stations.find(item => item.id === current.id)
      if (station) translateStationWithAnchors(next, station.id, dx, dy)
    } else if (current.kind === 'draggingWaypoint') {
      const waypoint = next.geometry.segments.find(item => item.id === current.segmentId)?.waypoints.find(item => item.id === current.id)
      if (waypoint) { waypoint.x = current.origin.x + dx; waypoint.y = current.origin.y + dy }
    } else if (current.kind === 'draggingStructureNode') {
      const segment = next.geometry.segments.find(item => item.id === current.segmentId), node = segment?.structureNodes?.find(item => item.id === current.id)
      if (segment && node && !node.waypointId) {
        const threshold = Math.min(12, Math.max(5, 6 * view.width / canvasWidth))
        const nearest = segment.waypoints.map(waypoint => ({ waypoint, distance: Math.hypot(waypoint.x - point.x, waypoint.y - point.y) })).sort((a, b) => a.distance - b.distance)[0]
        if (nearest && nearest.distance <= threshold) { node.waypointId = nearest.waypoint.id; delete node.progress }
        else { delete node.waypointId; node.progress = findSegmentProgressForPoint(next, segment, point) }
      }
    } else if (current.kind === 'draggingLabel') {
      const station = next.stations.find(item => item.id === current.id)
      if (station) { const offset=snapLabelOffset(current.origin.x + dx, current.origin.y + dy); station.labelOffsetX = offset.x; station.labelOffsetY = offset.y }
    } else if (current.kind === 'draggingLineBadge') {
      const badge = next.lines.find(line => line.id === current.ownerLineId)?.lineBadges?.find(item => item.id === current.id)
      if (badge) { badge.x = current.origin.x + dx; badge.y = current.origin.y + dy }
    } else if (current.kind === 'draggingMapElement') {
      const element = next.mapElements?.find(item => item.id === current.id)
      if (element) { element.x = current.origin.x + dx; element.y = current.origin.y + dy }
    } else if (current.kind === 'draggingLineLegend') {
      const legend = next.lineLegend
      if (legend && legend.id === current.id) { legend.x = current.origin.x + dx; legend.y = current.origin.y + dy }
    } else if (current.kind === 'draggingBasemapPoint') {
      const point = next.basemapPaths?.find(path => path.id === current.ownerPathId)?.points.find(item => item.id === current.id)
      if (point) { point.x = current.origin.x + dx; point.y = current.origin.y + dy }
    } else if (current.kind === 'draggingBasemapPath') {
      const path = next.basemapPaths?.find(item => item.id === current.ownerPathId)
      if (path) path.points.forEach(item => { item.x += dx; item.y += dy })
    } else if (current.kind === 'draggingRoadPoint') {
      const point = next.roads?.find(road => road.id === current.ownerRoadId)?.points.find(item => item.id === current.id)
      if (point) { point.x = current.origin.x + dx; point.y = current.origin.y + dy }
    } else if (next.background) {
      next.background.x = current.origin.x + dx; next.background.y = current.origin.y + dy
    }
    current.latest = next
    setPreview(next); onPreview(next)
  }
  const endGesture = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)
    if (draftDrag.current?.pointerId === event.pointerId) { draftDrag.current = null; return }
    if (lineCanvasPointer.current?.pointerId === event.pointerId) {
      const current = lineCanvasPointer.current
      lineCanvasPointer.current = null
      if (!current.moved && event.type === 'pointerup') addDraftPointAt(pointerToWorld(event.clientX, event.clientY))
      return
    }
    if (basemapCanvasPointer.current?.pointerId === event.pointerId) {
      const current = basemapCanvasPointer.current
      basemapCanvasPointer.current = null
      if (!current.moved && event.type === 'pointerup') onCreatePoint(pointerToWorld(event.clientX, event.clientY))
      return
    }
    const current = gesture.current
    if (current.kind === 'pinchingCanvas') { if (pointers.current.size < 2) gesture.current = { kind: 'idle' }; return }
    if (current.kind === 'calibrationTap' && current.pointerId === event.pointerId) { if (!current.moved) onCalibrationPoint?.(pointerToWorld(event.clientX, event.clientY)); gesture.current = { kind: 'idle' }; pointers.current.clear(); return }
    if (current.kind !== 'idle' && current.pointerId === event.pointerId && current.kind !== 'panningCanvas' && current.kind !== 'calibrationTap' && current.moved) onDragCommit(current.before, current.latest)
    gesture.current = { kind: 'idle' }; setPreview(null)
  }

  const selectedInterval = selection?.type === 'segment' ? (() => {
    const segment = shown.geometry.segments.find(item => item.id === selection.id)
    if (!segment) return null
    const interval = getSegmentStyleIntervalAtProgress(shown, segment, selection.progress ?? .5)
    const spans = getSegmentSubpathSpans(shown, segment, interval.start, interval.end)
    return spans.length ? { segment, interval, path: pathSpansToSvgPath(spans) } : null
  })() : null

  const lineDrawingOverlay = (() => {
    if (!lineDraft?.anchorStationId) return null
    const anchor = shown.stations.find(item => item.id === lineDraft.anchorStationId)
    const rawLine = shown.lines.find(item => item.id === lineDraft.lineId)
    if (!anchor || !rawLine) return null
    const line = lineWithEffectiveColor(shown, rawLine, shown.timeline.currentDate), points = lineDraft.points
    const path = points.length ? (() => {
      const endpoint = points.at(-1)!
      const draftStation = { id: '__drawing-preview-end__', name: '', x: endpoint.x, y: endpoint.y, labelOffsetX: 0, labelOffsetY: 0 }
      const draftSegment = { id: '__drawing-preview-segment__', lineId: lineDraft.lineId, fromStationId: anchor.id, toStationId: draftStation.id, mode: 'smooth' as const, structureType: 'underground' as const, structureNodes: [], waypoints: points.slice(0, -1).map(point => ({ id: point.id, x: point.x, y: point.y, type: 'smooth' as const })) }
      return getSegmentPath({ ...shown, stations: [...shown.stations, draftStation] }, draftSegment)
    })() : ''
    const last = points.at(-1) ?? anchor
    const previous = points.length >= 2 ? points[points.length - 2] : points.length === 1 ? anchor : null
    let dx = previous ? last.x - previous.x : 0, dy = previous ? last.y - previous.y : 0
    if (!previous || Math.hypot(dx, dy) < 1e-6) { const handle = getStationHandleStyle(shown, anchor.id, shown.timeline.currentDate); dx = handle.x - anchor.x; dy = handle.y - anchor.y }
    if (Math.hypot(dx, dy) < 1e-6) { dx = 1; dy = 0 }
    const length = Math.hypot(dx, dy), plus = { x: last.x + dx / length * 86, y: last.y + dy / length * 86 }
    return <g data-layer="line-drawing-overlay" data-editor="true">
      {path && <path d={path} fill="none" stroke={line.color} strokeWidth={effectiveLineWidth(line, shown.settings)} strokeLinecap="round" strokeLinejoin="round" opacity=".76" pointerEvents="none" />}
      {points.map(point => <g key={point.id} data-draft-point-id={point.id} onDoubleClick={event=>event.stopPropagation()} onPointerDown={event => { event.stopPropagation(); capture(event); draftDrag.current = { pointerId: event.pointerId, id: point.id }; setDrawingPointSelection({ kind: 'draft', id: point.id }) }}><circle cx={point.x} cy={point.y} r={stationHitRadius} fill="transparent" pointerEvents="all"/><circle cx={point.x} cy={point.y} r="8" fill="#fff" stroke={drawingPointSelection?.kind==='draft'&&drawingPointSelection.id===point.id?'#b98700':'#353b38'} strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none"/></g>)}
      <g data-line-draft-add="true" transform={`translate(${plus.x} ${plus.y})`} onDoubleClick={event=>event.stopPropagation()} onPointerDown={event => { event.stopPropagation(); addDraftPoint() }}><circle r={Math.max(18, stationHitRadius)} fill="transparent" pointerEvents="all"/><circle r="14" fill="#d9edf2" stroke={line.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none"/><path d="M -6 0 H 6 M 0 -6 V 6" stroke={line.color} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none"/></g>
      {drawingPointSelection?.kind === 'draft' && (() => { const point=points.find(item=>item.id===drawingPointSelection.id); if(!point)return null; return <g transform={`translate(${point.x+16} ${point.y-18})`} onDoubleClick={event=>event.stopPropagation()}><g onPointerDown={event=>{event.stopPropagation();promoteDraftPoint(point.id)}}><rect x="0" y="0" width="78" height="28" rx="7" fill="#fff" stroke="#9aa19d"/><text x="39" y="19" textAnchor="middle" fontSize="13" fill="#252a27" pointerEvents="none">切换为站点</text></g><g transform="translate(0 32)" onPointerDown={event=>{event.stopPropagation();removeDraftPoint(point.id)}}><rect x="0" y="0" width="78" height="28" rx="7" fill="#fff" stroke="#9aa19d"/><text x="39" y="19" textAnchor="middle" fontSize="13" fill="#252a27" pointerEvents="none">移除</text></g></g> })()}
      {drawingPointSelection?.kind === 'station' && drawingPointSelection.id === lineDraft.lastCreatedStationId && (()=>{const station=shown.stations.find(item=>item.id===drawingPointSelection.id);if(!station)return null;return <g transform={`translate(${station.x+16} ${station.y-18})`} onDoubleClick={event=>event.stopPropagation()} onPointerDown={event=>{event.stopPropagation();demoteCurrentStation(station.id)}}><rect x="0" y="0" width="92" height="28" rx="7" fill="#fff" stroke="#9aa19d"/><text x="46" y="19" textAnchor="middle" fontSize="13" fill="#252a27" pointerEvents="none">切换为控制点</text></g>})()}
    </g>
  })()

  const basemapDrawingOverlay = (() => {
    if (drawing?.kind !== 'basemap') return null
    const path = shown.basemapPaths?.find(item => item.id === drawing.pathId)
    if (!path?.points.length) return null
    const last = path.points.at(-1)!
    const previous = path.points.length >= 2 ? path.points[path.points.length - 2] : null
    let dx = previous ? last.x - previous.x : 1, dy = previous ? last.y - previous.y : 0
    if (Math.hypot(dx, dy) < 1e-6) { dx = 1; dy = 0 }
    const length = Math.hypot(dx, dy), plus = { x: last.x + dx / length * 86, y: last.y + dy / length * 86 }
    return <g data-layer="basemap-drawing-overlay" data-editor="true">
      <g data-basemap-draft-add="true" transform={`translate(${plus.x} ${plus.y})`} onDoubleClick={event=>event.stopPropagation()} onPointerDown={event => { event.stopPropagation(); onCreatePoint(plus) }}>
        <circle r={Math.max(18, stationHitRadius)} fill="transparent" pointerEvents="all" />
        <circle r="14" fill="#fffdf8" stroke={path.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <path d="M -6 0 H 6 M 0 -6 V 6" stroke={path.color} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
      </g>
    </g>
  })()

  return <svg id="network-canvas" ref={svgRef} className={`network-canvas ${drawing ? 'is-drawing' : ''}`} tabIndex={0} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
    onPointerDown={handleCanvasPointerDown} onPointerMove={handlePointerMove} onPointerUp={endGesture} onPointerCancel={endGesture} onContextMenu={event=>event.preventDefault()}
    onDoubleClick={event => { if (drawing && drawing.kind !== 'line') { event.preventDefault(); drawingClick.current = null; if (pointerDoubleFinish.current) { pointerDoubleFinish.current = false; return } onFinishDrawing?.() } }}
    onWheel={event => { event.preventDefault(); const point = pointerToWorld(event.clientX, event.clientY); const factor = event.deltaY > 0 ? 1.12 : .88; setView(value => ({ x: point.x - (point.x - value.x) * factor, y: point.y - (point.y - value.y) * factor, width: value.width * factor, height: value.height * factor })) }}>
    <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0L0 0 0 40" fill="none" stroke="#c9c2b3" strokeWidth="1" opacity=".35" /></pattern></defs>
    <g data-layer="canvas-background"><rect className="canvas-bg" x={view.x - view.width} y={view.y - view.height} width={view.width * 3} height={view.height * 3} fill="#f3f0e9" />{shown.settings.gridVisible && <rect className="canvas-bg" x={view.x - view.width} y={view.y - view.height} width={view.width * 3} height={view.height * 3} fill="url(#grid)" />}</g>
    {shown.background?.visible && <image data-layer="background-image" href={shown.background.dataUrl} x={shown.background.x} y={shown.background.y} width={shown.background.width} height={shown.background.height} opacity={shown.background.opacity} onPointerDown={event => { if (drawing) return; if (!shown.background?.locked) { onSelect({ type: 'background' }); startObjectDrag('draggingBackground', event, { x: shown.background!.x, y: shown.background!.y }) } }} />}
    <VectorBasemapLayer project={shown} draft={roadDraft} selectedId={selection?.type === 'road' || selection?.type === 'roadPoint' ? (selection.type === 'road' ? selection.id : selection.roadId) : selection?.type === 'basemapPath' ? selection.id : undefined} hitRadius={stationHitRadius}
      onRoadPointerDown={(event, road) => { if (drawing) return; event.stopPropagation(); if (road.locked) return; onSelect({ type: 'road', id: road.id }) }}
      onRoadPointPointerDown={(event, road, pointId) => { if (drawing || road.locked) return; event.stopPropagation(); const point=road.points.find(item=>item.id===pointId); if(point && startObjectDrag('draggingRoadPoint', event, point, point.id, undefined, undefined, undefined, road.id)) onSelect({type:'roadPoint',id:pointId,roadId:road.id}) }}
      onPathPointerDown={(event, path) => { if (drawing) return; event.stopPropagation(); onSelect({ type: 'basemapPath', id: path.id }); if (!path.locked && path.points.length) startObjectDrag('draggingBasemapPath', event, path.points[0], undefined, undefined, undefined, path.id) }}
      onPointPointerDown={(event, path, pointId) => { const drawingThisBasemap = drawing?.kind === 'basemap' && drawing.pathId === path.id; if ((drawing && !drawingThisBasemap) || path.locked) return; event.stopPropagation(); const point = path.points.find(item => item.id === pointId); if (point && startObjectDrag('draggingBasemapPoint', event, point, pointId, undefined, undefined, path.id)) onSelect({ type: 'basemapPath', id: path.id }) }} />
    {basemapDrawingOverlay}
    <g data-layer="segments">{active.lines.flatMap(rawLine => {
      const sourceId = Number(rawLine.source?.sourceLineId ?? rawLine.source?.lineId)
      if (isFakeLine(rawLine) && rawLine.source?.format === 'aarc' && Number.isFinite(sourceId)) {
        return [<AarcFakeLinesLayer key={`fake-common-${rawLine.id}`} project={shown} part="common" sourceLineId={sourceId} />]
      }
      const line = lineWithEffectiveColor(shown, rawLine, shown.timeline.currentDate)
      const lineSegments = active.segments.filter(segment => segment.lineId === rawLine.id)
      const hitPaths = lineSegments.map(segment => {
        const path = getSegmentPath(shown, segment)
        return <path key={`hit:${segment.id}`} d={path} className="segment-hit" onPointerDown={event => { if (drawing) return; event.stopPropagation(); const projected=projectPointToSvgPath(event.currentTarget,pointerToWorld(event.clientX,event.clientY)), progress=findSegmentProgressForPoint(shown,segment,projected); onSelect({ type: 'segment', id: segment.id, progress }); onSegmentPoint(segment.id, projected) }} />
      })
      if (rawLine.source?.format === 'aarc') {
        const runs = compileAarcLineArtworkRuns(shown, line, lineSegments)
        return [<g key={rawLine.id} data-aarc-continuous-line={rawLine.id}>
          {runs.map(run => <SegmentArtwork key={run.id} segment={run.segment} line={line} path={run.path} lineWidth={effectiveLineWidth(line, shown.settings)} renderLegacyStructure={false} style={resolveLineStyle(shown,line,run.segment)}/>)}
          {hitPaths}
        </g>]
      }
      return lineSegments.map(segment => {
        const path = getSegmentPath(shown, segment)
        const intervals = getSegmentStyleIntervals(shown, segment)
        return <g key={segment.id}>{intervals.map((interval,index) => { const spans=getSegmentSubpathSpans(shown,segment,interval.start,interval.end); if(!spans.length)return null; const intervalPath=pathSpansToSvgPath(spans), intervalSegment={...segment,structureType:interval.structureType,lineStyleId:interval.lineStyleId}; return <SegmentArtwork key={`${segment.id}:${index}`} segment={intervalSegment} line={line} path={intervalPath} lineWidth={effectiveLineWidth(line, shown.settings)} renderLegacyStructure={false} style={resolveLineStyle(shown,line,interval.lineStyleId===undefined?undefined:intervalSegment)}/> })}{hitPaths.find(item=>item.key===`hit:${segment.id}`)}</g>
      })
    })}</g>
    <g data-layer="structure-runs">{elevatedRuns.map(run => { const rawLine = shown.lines.find(item => item.id === run.lineId); const line = rawLine ? lineWithEffectiveColor(shown, rawLine, shown.timeline.currentDate) : undefined; return line ? <StructureRunArtwork key={run.id} run={run} line={line} lineWidth={effectiveLineWidth(line, shown.settings)} style={getLineStyle(shown, 'elevated')} /> : null })}</g>
    {selectedInterval&&<g data-layer="style-interval-selection" data-editor="true" pointerEvents="none"><path d={selectedInterval.path} fill="none" stroke="#d2a72f" strokeWidth={(shown.lines.find(line=>line.id===selectedInterval.segment.lineId)?.lineWidth??shown.settings.lineWidth)+7} strokeLinecap="round" strokeLinejoin="round" opacity=".24" vectorEffect="non-scaling-stroke"/></g>}
    {phasePreview && <g data-layer="opening-phase-preview" pointerEvents="none">{phasePreview.segmentIds.map(id => { const segment = shown.geometry.segments.find(item => item.id === id); const rawLine = segment ? shown.lines.find(item => item.id === segment.lineId) : null; const line = rawLine ? lineWithEffectiveColor(shown, rawLine, shown.timeline.currentDate) : null; return segment && line ? <path key={id} d={getSegmentPath(shown, segment)} className="opening-phase-preview-segment" stroke={line.color} /> : null })}{phasePreview.stationIds.map(id => { const station = shown.stations.find(item => item.id === id); return station && isCompoundStationCanonical(shown, station) ? <circle key={id} cx={station.x} cy={station.y} r={effectiveStationStyle(station, shown.settings).stationSize * .9} className="opening-phase-preview-station" /> : null })}</g>}
    <g data-layer="stations">{editorStations.map(station => <StationMarker key={station.id} part="marker" project={shown} station={station} time={shown.timeline.currentDate} selected={(selection?.type === 'station' && (selection.id === station.id || getCompoundStationCanonical(shown, selection.id)?.id === station.id)) || selectedStationIds.includes(station.id)} hitRadius={stationHitRadius}
      onPointerDown={event => { event.stopPropagation(); if (drawing?.kind === 'line') { connectDrawingToStation(station.id); return } if (drawing) { onConnectStation(station.id); return } if (isStationGeometryLocked(shown, station.id)) { onSelect({ type: 'station', id: station.id }); onEditBlocked?.(lockedStationMessage(shown, station.id)); return } if (startObjectDrag('draggingStation', event, { x: station.x, y: station.y }, station.id)) { const additive = event.ctrlKey || event.metaKey || event.shiftKey; if (additive && onToggleStationSelection) onToggleStationSelection(station.id); else onSelect({ type: 'station', id: station.id }) } }}
      onLabelPointerDown={event => { if (drawing) return; if (startObjectDrag('draggingLabel', event, { x: station.labelOffsetX, y: station.labelOffsetY }, station.id)) onSelect({ type: 'station', id: station.id }) }} />)}</g>
    <AarcFakeLinesLayer project={shown} part="stations" />
    <AarcPointLinksLayer project={shown} />
    <g data-layer="station-labels">{editorStations.map(station => <StationMarker key={station.id} part="label" project={shown} station={station} time={shown.timeline.currentDate} selected={false} hitRadius={stationHitRadius} onPointerDown={() => {}} onLabelPointerDown={event => { if (drawing) return; if (startObjectDrag('draggingLabel', event, { x: station.labelOffsetX, y: station.labelOffsetY }, station.id)) onSelect({ type: 'station', id: station.id }) }} />)}</g>
    {lineDrawingOverlay}
    <LineBadgesLayer project={historicalIdentityProject} selectedId={selection?.type === 'lineLabel' && selection.source === 'native' ? selection.id : undefined} hitRadius={stationHitRadius} onPointerDown={(event, line, badge) => { if (drawing) return; if (startObjectDrag('draggingLineLabel', event, { x: badge.x, y: badge.y }, badge.id, undefined, line.id)) onSelect({ type: 'lineLabel', id: badge.id, lineId: line.id, source: 'native' }) }} />
    <AarcTextTagsLayer project={historicalIdentityProject} selectedId={selection?.type === 'lineLabel' && selection.source === 'aarc' ? selection.id : undefined} hitRadius={stationHitRadius} onLineLabelPointerDown={(event, tag, lineId) => { if (drawing) return; event.stopPropagation(); if (startObjectDrag('draggingLineLabel', event, { x: tag.x, y: tag.y }, tag.id, undefined, lineId)) onSelect({ type: 'lineLabel', id: tag.id, lineId, source: 'aarc' }) }} />
    <MapElementsLayer project={shown} selectedId={selection?.type === 'mapElement' ? selection.id : undefined} hitRadius={stationHitRadius} onPointerDown={(event, element) => { if (drawing) return; if (startObjectDrag('draggingMapElement', event, { x: element.x, y: element.y }, element.id)) onSelect({ type: 'mapElement', id: element.id }) }} />
    <LineLegendLayer project={historicalIdentityProject} selectedId={selection?.type === 'lineLegend' ? selection.id : undefined} hitRadius={stationHitRadius} onPointerDown={(event, legend) => { if (drawing) return; if (legend.locked) { onSelect({ type: 'lineLegend', id: legend.id }); return } if (startObjectDrag('draggingLineLegend', event, { x: legend.x, y: legend.y }, legend.id)) onSelect({ type: 'lineLegend', id: legend.id }) }} />
    <g data-layer="waypoints" data-editor="true">{!drawing && (selection?.type === 'segment' || selection?.type === 'waypoint' || selection?.type === 'structureNode') && (()=>{const segmentId=selection.type==='segment'?selection.id:selection.segmentId,segment=shown.geometry.segments.find(item=>item.id===segmentId);if(!segment)return null;const cornerIds=new Set(getSegmentRoundedCornerPlans(shown,segment).map(plan=>plan.waypointId));return segment.waypoints.map(waypoint=>{const isCorner=cornerIds.has(waypoint.id),selected=selection.type==='waypoint'&&selection.id===waypoint.id,selectWaypoint=(event:React.PointerEvent)=>{if(isSegmentGeometryLocked(shown,segmentId)){onSelect({type:'waypoint',id:waypoint.id,segmentId});onEditBlocked?.('线路已锁定');return}if(startObjectDrag('draggingWaypoint',event,{x:waypoint.x,y:waypoint.y},waypoint.id,segmentId))onSelect({type:'waypoint',id:waypoint.id,segmentId})};return <g key={waypoint.id} data-corner-handle={isCorner?'true':undefined} data-waypoint-id={waypoint.id} onPointerDown={selectWaypoint}><circle className="waypoint-hit" cx={waypoint.x} cy={waypoint.y} r={stationHitRadius} fill="transparent" pointerEvents="all"/><circle cx={waypoint.x} cy={waypoint.y} r={isCorner?7:8} className={`waypoint ${isCorner?'corner-waypoint':''} ${selected?'selected':''}`} pointerEvents="none"/></g>})})()}</g>
    <g data-layer="style-points" data-editor="true">{!drawing && (selection?.type === 'segment' || selection?.type === 'waypoint' || selection?.type === 'structureNode') && (() => { const segmentId = selection.type === 'segment' ? selection.id : selection.segmentId; const segment = shown.geometry.segments.find(item=>item.id===segmentId); if (!segment) return null; return (segment.structureNodes ?? []).map(node => { const point = getStructureNodePoint(shown, segment, node); if (!point) return null; const selected = selection.type === 'structureNode' && selection.id === node.id, attached=Boolean(node.waypointId); return <g key={node.id} transform={`translate(${point.x} ${point.y})`} data-style-point-id={node.id} data-structure-node-id={node.id} data-attached-waypoint-id={node.waypointId ?? ''} onPointerDown={event => { event.stopPropagation(); if (attached) { onSelect({ type: 'structureNode', id: node.id, segmentId }); return }; if (isSegmentGeometryLocked(shown, segmentId)) { onSelect({ type: 'structureNode', id: node.id, segmentId }); onEditBlocked?.('线路已锁定'); return }; if (startObjectDrag('draggingStructureNode', event, point, node.id, segmentId)) onSelect({ type: 'structureNode', id: node.id, segmentId }) }}><circle r={attached?6:structureHitRadius} fill="transparent" pointerEvents="all" /><path d="M 0 -5 L 5 0 L 0 5 L -5 0 Z" fill={selected?'#fff4c9':'#fffdf9'} stroke={selected?'#b98700':'#353b38'} strokeWidth={selected?2:1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" /></g> }) })()}</g>
    <g data-layer="station-actions" data-editor="true">{selection?.type === 'station' && !drawing && (() => { const station = shown.stations.find(item => item.id === selection.id); if (!station) return null; const handle = getStationHandleStyle(shown, station.id, shown.timeline.currentDate); return <g className="station-extend" transform={`translate(${handle.x} ${handle.y})`} onPointerDown={event => { event.stopPropagation(); onExtend(station.id) }}><circle className="station-extend-hit" r={Math.max(stationHitRadius, 18)} fill="transparent" pointerEvents="all" /><circle className="station-extend-button" r="8.5" fill="white" stroke={handle.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none" /><path className="station-extend-plus" d="M -3.2 0 H 3.2 M 0 -3.2 V 3.2" stroke={handle.color} strokeWidth="1.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" /></g> })()}</g>
    {drawing?.kind === 'line' && !lineDraft?.anchorStationId && <g data-editor="true" pointerEvents="none"><text x={view.x + view.width / 2} y={view.y + 34} textAnchor="middle" fill="#557981" fontSize="16">点击空白位置放置起点站</text></g>}
    {drawing?.kind === 'basemap' && !(shown.basemapPaths?.find(path => path.id === drawing.pathId)?.points.length) && <g data-editor="true" pointerEvents="none"><text x={view.x + view.width / 2} y={view.y + 34} textAnchor="middle" fill="#557981" fontSize="16">点击空白位置放置第一个地形节点</text></g>}
    {calibration && <g data-editor="true" data-layer="calibration-overlay"><rect x={view.x - view.width} y={view.y - view.height} width={view.width * 3} height={view.height * 3} fill="transparent" pointerEvents="all" onPointerDown={event => handleCanvasPointerDown(event as unknown as React.PointerEvent<SVGSVGElement>)} /><line x1={calibration.points[0]?.x ?? 0} y1={calibration.points[0]?.y ?? 0} x2={calibration.points[1]?.x ?? calibration.points[0]?.x ?? 0} y2={calibration.points[1]?.y ?? calibration.points[0]?.y ?? 0} stroke="#c89521" strokeWidth="2" strokeDasharray="8 5" pointerEvents="none" />{calibration.points.map((point,index)=><circle key={index} cx={point.x} cy={point.y} r="8" fill="#fff9e8" stroke="#c89521" strokeWidth="2" pointerEvents="none" />)}<text x={view.x + view.width / 2} y={view.y + 34} textAnchor="middle" fill="#765c1a" fontSize="16" pointerEvents="none">{calibration.points.length ? '再点一下选择第二个点' : '点击地图上的第一个点'}</text></g>}
  </svg>
}
