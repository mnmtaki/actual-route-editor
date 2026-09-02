import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ActualRouteProject, Selection } from '../data/model'
import { findSegmentProgressForPoint, getSegmentPath, getSegmentRoundedCornerPlans } from '../geometry/path'
import { projectPointToSvgPath, screenPointToWorld } from '../geometry/screenPoint'
import { getActiveNetworkAtTime } from '../timeline/active'
import { StationMarker } from './StationMarker'
import { getStationHandleStyle } from './stationHandle'
import { SegmentArtwork, StructureRunArtwork } from './segmentStyles'
import { compileElevatedRuns, getStructureNodePoint } from '../data/structure'
import { MapElementsLayer } from './MapElements'
import { LineBadgesLayer } from './LineBadges'
import { effectiveLineWidth, effectiveStationStyle } from '../data/style'
import { getLineStyle, resolveLineStyle } from '../data/lineStyles'

type View = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }
type Gesture =
  | { kind: 'idle' }
  | { kind: 'panningCanvas'; pointerId: number; lastClient: Point }
  | { kind: 'pinchingCanvas'; pointerIds: [number, number]; initialDistance: number; startView: View; startWorld: Point }
  | { kind: 'draggingStation' | 'draggingWaypoint' | 'draggingStructureNode' | 'draggingLabel' | 'draggingLineBadge' | 'draggingMapElement' | 'draggingBackground'; pointerId: number; id?: string; segmentId?: string; ownerLineId?: string; startWorld: Point; origin: Point; before: ActualRouteProject; latest: ActualRouteProject; moved: boolean }

export function NetworkCanvas({ project, selection, drawing, phasePreview, onSelect, onCreatePoint, onConnectStation, onExtend, onSegmentPoint, onPreview, onDragCommit, view, setView }: {
  project: ActualRouteProject; selection: Selection; drawing: { lineId: string; anchorStationId: string | null; phaseId?: string } | null; phasePreview?: { segmentIds: string[]; stationIds: string[] } | null
  onSelect: (selection: Selection) => void; onCreatePoint: (point: Point) => void; onConnectStation: (id: string) => void; onExtend: (id: string) => void
  onSegmentPoint: (id: string, point: Point) => void; onPreview: (project: ActualRouteProject) => void; onDragCommit: (before: ActualRouteProject, next: ActualRouteProject) => void
  view: View; setView: React.Dispatch<React.SetStateAction<View>>
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const gesture = useRef<Gesture>({ kind: 'idle' })
  const pointers = useRef(new Map<number, Point>())
  const [preview, setPreview] = useState<ActualRouteProject | null>(null)
  const [canvasWidth, setCanvasWidth] = useState(920)
  const shown = preview ?? project
  const active = useMemo(() => getActiveNetworkAtTime(shown, shown.timeline.currentDate), [shown])
  const elevatedRuns = useMemo(() => compileElevatedRuns(shown, new Set(active.segments.map(segment => segment.id))), [shown, active.segments])
  const stationHitRadius = Math.max(20, 22 * view.width / canvasWidth)
  const structureHitRadius = Math.max(22, 22 * view.width / canvasWidth)

  useLayoutEffect(() => {
    const element = svgRef.current
    if (!element) return
    const update = () => setCanvasWidth(Math.max(1, element.getBoundingClientRect().width))
    update()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])

  const pointerToWorld = (clientX: number, clientY: number): Point => screenPointToWorld(svgRef.current!, clientX, clientY, view)
  const capture = (event: React.PointerEvent) => event.currentTarget.setPointerCapture?.(event.pointerId)
  const beginPinch = () => {
    const points = [...pointers.current.entries()].slice(0, 2)
    if (points.length < 2) return
    const [[firstId, first], [secondId, second]] = points
    const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
    const initialDistance = Math.hypot(second.x - first.x, second.y - first.y)
    if (initialDistance < 1) return
    const previous = gesture.current
    if (previous.kind !== 'idle') {
      if (previous.kind !== 'panningCanvas' && previous.kind !== 'pinchingCanvas') onPreview(previous.before)
      setPreview(null)
    }
    gesture.current = { kind: 'pinchingCanvas', pointerIds: [firstId, secondId], initialDistance, startView: view, startWorld: pointerToWorld(center.x, center.y) }
  }
  const startObjectDrag = (kind: Extract<Gesture, { before: ActualRouteProject }>['kind'], event: React.PointerEvent, origin: Point, id?: string, segmentId?: string, ownerLineId?: string) => {
    event.stopPropagation(); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); capture(event)
    if (pointers.current.size >= 2) { beginPinch(); return false }
    gesture.current = { kind, pointerId: event.pointerId, id, segmentId, ownerLineId, startWorld: pointerToWorld(event.clientX, event.clientY), origin, before: project, latest: project, moved: false }
    setPreview(project)
    return true
  }
  const handleCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size >= 2) { capture(event); beginPinch(); return }
    const target = event.target as Element
    if (drawing) { onCreatePoint(pointerToWorld(event.clientX, event.clientY)); return }
    if (target !== event.currentTarget && !target.classList.contains('canvas-bg')) return
    onSelect(null); capture(event)
    gesture.current = { kind: 'panningCanvas', pointerId: event.pointerId, lastClient: { x: event.clientX, y: event.clientY } }
  }
  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
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
      if (station) { station.x = current.origin.x + dx; station.y = current.origin.y + dy }
    } else if (current.kind === 'draggingWaypoint') {
      const waypoint = next.geometry.segments.find(item => item.id === current.segmentId)?.waypoints.find(item => item.id === current.id)
      if (waypoint) { waypoint.x = current.origin.x + dx; waypoint.y = current.origin.y + dy }
    } else if (current.kind === 'draggingStructureNode') {
      const segment = next.geometry.segments.find(item => item.id === current.segmentId), node = segment?.structureNodes?.find(item => item.id === current.id)
      if (segment && node && !node.waypointId) node.progress = findSegmentProgressForPoint(next, segment, point)
    } else if (current.kind === 'draggingLabel') {
      const station = next.stations.find(item => item.id === current.id)
      if (station) { station.labelOffsetX = current.origin.x + dx; station.labelOffsetY = current.origin.y + dy }
    } else if (current.kind === 'draggingLineBadge') {
      const badge = next.lines.find(line => line.id === current.ownerLineId)?.lineBadges?.find(item => item.id === current.id)
      if (badge) { badge.x = current.origin.x + dx; badge.y = current.origin.y + dy }
    } else if (current.kind === 'draggingMapElement') {
      const element = next.mapElements?.find(item => item.id === current.id)
      if (element) { element.x = current.origin.x + dx; element.y = current.origin.y + dy }
    } else if (next.background) {
      next.background.x = current.origin.x + dx; next.background.y = current.origin.y + dy
    }
    current.latest = next
    setPreview(next); onPreview(next)
  }
  const endGesture = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)
    const current = gesture.current
    if (current.kind === 'pinchingCanvas') { if (pointers.current.size < 2) gesture.current = { kind: 'idle' }; return }
    if (current.kind !== 'idle' && current.pointerId === event.pointerId && current.kind !== 'panningCanvas' && current.moved) onDragCommit(current.before, current.latest)
    gesture.current = { kind: 'idle' }; setPreview(null)
  }

  return <svg id="network-canvas" ref={svgRef} className={`network-canvas ${drawing ? 'is-drawing' : ''}`} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
    onPointerDown={handleCanvasPointerDown} onPointerMove={handlePointerMove} onPointerUp={endGesture} onPointerCancel={endGesture} onContextMenu={event=>event.preventDefault()}
    onWheel={event => { event.preventDefault(); const point = pointerToWorld(event.clientX, event.clientY); const factor = event.deltaY > 0 ? 1.12 : .88; setView(value => ({ x: point.x - (point.x - value.x) * factor, y: point.y - (point.y - value.y) * factor, width: value.width * factor, height: value.height * factor })) }}>
    <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0L0 0 0 40" fill="none" stroke="#c9c2b3" strokeWidth="1" opacity=".35" /></pattern></defs>
    <g data-layer="canvas-background"><rect className="canvas-bg" x={view.x - view.width} y={view.y - view.height} width={view.width * 3} height={view.height * 3} fill="#f3f0e9" />{shown.settings.gridVisible && <rect className="canvas-bg" x={view.x - view.width} y={view.y - view.height} width={view.width * 3} height={view.height * 3} fill="url(#grid)" />}</g>
    {shown.background?.visible && <image data-layer="background-image" href={shown.background.dataUrl} x={shown.background.x} y={shown.background.y} width={shown.background.width} height={shown.background.height} opacity={shown.background.opacity} onPointerDown={event => { if (drawing) return; if (!shown.background?.locked) { onSelect({ type: 'background' }); startObjectDrag('draggingBackground', event, { x: shown.background!.x, y: shown.background!.y }) } }} />}
    <g data-layer="segments">{active.segments.map(segment => { const line = active.lines.find(item => item.id === segment.lineId); if (!line) return null; const path = getSegmentPath(shown, segment); return <g key={segment.id} className={selection?.type === 'segment' && selection.id === segment.id ? 'segment-selected' : ''}><SegmentArtwork segment={segment} line={line} path={path} lineWidth={effectiveLineWidth(line, shown.settings)} renderLegacyStructure={false} style={resolveLineStyle(shown, line)} /><path d={path} className="segment-hit" onPointerDown={event => { if (drawing) return; event.stopPropagation(); onSelect({ type: 'segment', id: segment.id }); onSegmentPoint(segment.id, projectPointToSvgPath(event.currentTarget, pointerToWorld(event.clientX, event.clientY))) }} /></g> })}</g>
    <g data-layer="structure-runs">{elevatedRuns.map(run => { const line = shown.lines.find(item => item.id === run.lineId); return line ? <StructureRunArtwork key={run.id} run={run} line={line} lineWidth={effectiveLineWidth(line, shown.settings)} style={getLineStyle(shown, 'elevated')} /> : null })}</g>    {phasePreview && <g data-layer="opening-phase-preview" pointerEvents="none">{phasePreview.segmentIds.map(id => { const segment = shown.geometry.segments.find(item => item.id === id); const line = segment ? shown.lines.find(item => item.id === segment.lineId) : null; return segment && line ? <path key={id} d={getSegmentPath(shown, segment)} className="opening-phase-preview-segment" stroke={line.color} /> : null })}{phasePreview.stationIds.map(id => { const station = shown.stations.find(item => item.id === id); return station ? <circle key={id} cx={station.x} cy={station.y} r={effectiveStationStyle(station, shown.settings).stationSize * .9} className="opening-phase-preview-station" /> : null })}</g>}    <g data-layer="stations">{active.stations.map(station => <StationMarker key={station.id} project={shown} station={station} time={shown.timeline.currentDate} selected={selection?.type === 'station' && selection.id === station.id} hitRadius={stationHitRadius}
      onPointerDown={event => { event.stopPropagation(); if (drawing) { onConnectStation(station.id); return } if (startObjectDrag('draggingStation', event, { x: station.x, y: station.y }, station.id)) onSelect({ type: 'station', id: station.id }) }}
      onLabelPointerDown={event => { if (startObjectDrag('draggingLabel', event, { x: station.labelOffsetX, y: station.labelOffsetY }, station.id)) onSelect({ type: 'station', id: station.id }) }} />)}</g>
    <LineBadgesLayer project={shown} selectedId={selection?.type === 'lineBadge' ? selection.id : undefined} hitRadius={stationHitRadius} onPointerDown={(event, line, badge) => { if (drawing) return; if (startObjectDrag('draggingLineBadge', event, { x: badge.x, y: badge.y }, badge.id, undefined, line.id)) onSelect({ type: 'lineBadge', id: badge.id, lineId: line.id }) }} />
    <MapElementsLayer project={shown} selectedId={selection?.type === 'mapElement' ? selection.id : undefined} hitRadius={stationHitRadius} onPointerDown={(event, element) => { if (drawing) return; if (startObjectDrag('draggingMapElement', event, { x: element.x, y: element.y }, element.id)) onSelect({ type: 'mapElement', id: element.id }) }} />
    <g data-layer="structure-nodes" data-editor="true">{(selection?.type === 'segment' || selection?.type === 'waypoint' || selection?.type === 'structureNode') && (() => { const segmentId = selection.type === 'segment' ? selection.id : selection.segmentId; const segment = shown.geometry.segments.find(item => item.id === segmentId); if (!segment) return null; return (segment.structureNodes ?? []).map(node => { const point = getStructureNodePoint(shown, segment, node); if (!point) return null; const selected = selection.type === 'structureNode' && selection.id === node.id; return <g key={node.id} transform={`translate(${point.x} ${point.y})`} className={`structure-node ${node.waypointId ? 'attached' : 'independent'} ${selected ? 'selected' : ''}`} data-structure-node-id={node.id} data-attached-waypoint-id={node.waypointId ?? ''} onPointerDown={event => { event.stopPropagation(); if (drawing || node.waypointId) { onSelect({ type: 'structureNode', id: node.id, segmentId }); return }; if (startObjectDrag('draggingStructureNode', event, point, node.id, segmentId)) onSelect({ type: 'structureNode', id: node.id, segmentId }) }}><circle className="structure-node-hit" r={structureHitRadius} fill="transparent" pointerEvents="all" /><path className="structure-node-symbol" d="M -5 -7 H 5 M 0 -7 V 7 M -5 7 H 5" pointerEvents="none" /></g> }) })()}</g>    <g data-layer="waypoints" data-editor="true">{(selection?.type === 'segment' || selection?.type === 'waypoint') && (()=>{const segmentId=selection.type==='segment'?selection.id:selection.segmentId,segment=shown.geometry.segments.find(item=>item.id===segmentId);if(!segment)return null;const cornerIds=new Set(getSegmentRoundedCornerPlans(shown,segment).map(plan=>plan.waypointId));return segment.waypoints.map(waypoint=>{const isCorner=cornerIds.has(waypoint.id),selected=selection.type==='waypoint'&&selection.id===waypoint.id,selectWaypoint=(event:React.PointerEvent)=>{if(drawing)return;if(startObjectDrag('draggingWaypoint',event,{x:waypoint.x,y:waypoint.y},waypoint.id,segmentId))onSelect({type:'waypoint',id:waypoint.id,segmentId})};return <g key={waypoint.id} data-corner-handle={isCorner?'true':undefined} data-waypoint-id={waypoint.id} onPointerDown={selectWaypoint}><circle className="waypoint-hit" cx={waypoint.x} cy={waypoint.y} r={stationHitRadius} fill="transparent" pointerEvents="all"/><circle cx={waypoint.x} cy={waypoint.y} r={isCorner?7:8} className={`waypoint ${isCorner?'corner-waypoint':''} ${selected?'selected':''}`} pointerEvents="none"/></g>})})()}</g>
    <g data-layer="station-actions" data-editor="true">{selection?.type === 'station' && !drawing && (() => { const station = shown.stations.find(item => item.id === selection.id); if (!station) return null; const handle = getStationHandleStyle(shown, station.id, shown.timeline.currentDate); return <g className="station-extend" transform={`translate(${handle.x} ${handle.y})`} onPointerDown={event => { event.stopPropagation(); onExtend(station.id) }}><circle className="station-extend-hit" r={Math.max(stationHitRadius, 18)} fill="transparent" pointerEvents="all" /><circle className="station-extend-button" r="8.5" fill="white" stroke={handle.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none" /><path className="station-extend-plus" d="M -3.2 0 H 3.2 M 0 -3.2 V 3.2" stroke={handle.color} strokeWidth="1.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" /></g> })()}</g>
  </svg>
}


