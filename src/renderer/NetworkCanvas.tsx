import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ActualRouteProject, Selection } from '../data/model'
import { getSegmentPath } from '../geometry/path'
import { getActiveNetworkAtTime } from '../timeline/active'
import { StationMarker } from './StationMarker'
import { getStationHandleStyle } from './stationHandle'

type View = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }
type Gesture =
  | { kind: 'idle' }
  | { kind: 'panningCanvas'; pointerId: number; lastClient: Point }
  | { kind: 'draggingStation' | 'draggingWaypoint' | 'draggingLabel' | 'draggingBackground'; pointerId: number; id?: string; segmentId?: string; startWorld: Point; origin: Point; before: ActualRouteProject; latest: ActualRouteProject; moved: boolean }

export function NetworkCanvas({ project, selection, drawing, onSelect, onCreatePoint, onConnectStation, onExtend, onSegmentPoint, onPreview, onDragCommit, view, setView }: {
  project: ActualRouteProject; selection: Selection; drawing: { lineId: string; anchorStationId: string | null } | null
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
  const stationHitRadius = Math.max(20, 22 * view.width / canvasWidth)

  useLayoutEffect(() => {
    const element = svgRef.current
    if (!element) return
    const update = () => setCanvasWidth(Math.max(1, element.getBoundingClientRect().width))
    update()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])

  const clientToWorld = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: view.x + (clientX - rect.left) / rect.width * view.width, y: view.y + (clientY - rect.top) / rect.height * view.height }
  }
  const capture = (event: React.PointerEvent) => event.currentTarget.setPointerCapture?.(event.pointerId)
  const startObjectDrag = (kind: Extract<Gesture, { before: ActualRouteProject }>['kind'], event: React.PointerEvent, origin: Point, id?: string, segmentId?: string) => {
    event.stopPropagation(); capture(event)
    gesture.current = { kind, pointerId: event.pointerId, id, segmentId, startWorld: clientToWorld(event.clientX, event.clientY), origin, before: project, latest: project, moved: false }
    setPreview(project)
  }
  const handleCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const target = event.target as Element
    if (target !== event.currentTarget && !target.classList.contains('canvas-bg')) return
    if (drawing) { onCreatePoint(clientToWorld(event.clientX, event.clientY)); return }
    onSelect(null); capture(event)
    gesture.current = { kind: 'panningCanvas', pointerId: event.pointerId, lastClient: { x: event.clientX, y: event.clientY } }
  }
  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const current = gesture.current
    if (current.kind === 'idle' || current.pointerId !== event.pointerId) return
    if (current.kind === 'panningCanvas') {
      const dx = event.clientX - current.lastClient.x, dy = event.clientY - current.lastClient.y
      current.lastClient = { x: event.clientX, y: event.clientY }
      setView(value => ({ ...value, x: value.x - dx * value.width / svgRef.current!.clientWidth, y: value.y - dy * value.height / svgRef.current!.clientHeight }))
      return
    }
    const point = clientToWorld(event.clientX, event.clientY)
    const dx = point.x - current.startWorld.x, dy = point.y - current.startWorld.y
    current.moved ||= Math.hypot(dx, dy) > 1
    const next = structuredClone(current.before)
    if (current.kind === 'draggingStation') {
      const station = next.stations.find(item => item.id === current.id)
      if (station) { station.x = current.origin.x + dx; station.y = current.origin.y + dy }
    } else if (current.kind === 'draggingWaypoint') {
      const waypoint = next.geometry.segments.find(item => item.id === current.segmentId)?.waypoints.find(item => item.id === current.id)
      if (waypoint) { waypoint.x = current.origin.x + dx; waypoint.y = current.origin.y + dy }
    } else if (current.kind === 'draggingLabel') {
      const station = next.stations.find(item => item.id === current.id)
      if (station) { station.labelOffsetX = current.origin.x + dx; station.labelOffsetY = current.origin.y + dy }
    } else if (next.background) {
      next.background.x = current.origin.x + dx; next.background.y = current.origin.y + dy
    }
    current.latest = next
    setPreview(next); onPreview(next)
  }
  const endGesture = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)
    const current = gesture.current
    if (current.kind !== 'idle' && current.pointerId === event.pointerId && current.kind !== 'panningCanvas' && current.moved) onDragCommit(current.before, current.latest)
    gesture.current = { kind: 'idle' }; setPreview(null)
  }

  return <svg id="network-canvas" ref={svgRef} className={`network-canvas ${drawing ? 'is-drawing' : ''}`} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
    onPointerDown={handleCanvasPointerDown} onPointerMove={handlePointerMove} onPointerUp={endGesture} onPointerCancel={endGesture}
    onWheel={event => { event.preventDefault(); const point = clientToWorld(event.clientX, event.clientY); const factor = event.deltaY > 0 ? 1.12 : .88; setView(value => ({ x: point.x - (point.x - value.x) * factor, y: point.y - (point.y - value.y) * factor, width: value.width * factor, height: value.height * factor })) }}>
    <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0L0 0 0 40" fill="none" stroke="#c9c2b3" strokeWidth="1" opacity=".35" /></pattern></defs>
    <g data-layer="canvas-background"><rect className="canvas-bg" x={view.x - view.width} y={view.y - view.height} width={view.width * 3} height={view.height * 3} fill="#f3f0e9" />{shown.settings.gridVisible && <rect className="canvas-bg" x={view.x - view.width} y={view.y - view.height} width={view.width * 3} height={view.height * 3} fill="url(#grid)" />}</g>
    {shown.background?.visible && <image data-layer="background-image" href={shown.background.dataUrl} x={shown.background.x} y={shown.background.y} width={shown.background.width} height={shown.background.height} opacity={shown.background.opacity} onPointerDown={event => { if (!shown.background?.locked) { onSelect({ type: 'background' }); startObjectDrag('draggingBackground', event, { x: shown.background!.x, y: shown.background!.y }) } }} />}
    <g data-layer="segments">{active.segments.map(segment => { const line = active.lines.find(item => item.id === segment.lineId); if (!line) return null; const path = getSegmentPath(shown, segment); return <g key={segment.id} className={selection?.type === 'segment' && selection.id === segment.id ? 'segment-selected' : ''}><path d={path} fill="none" stroke={line.color} strokeWidth={shown.settings.lineWidth} strokeLinecap="round" strokeLinejoin="round" /><path d={path} className="segment-hit" onPointerDown={event => { event.stopPropagation(); onSelect({ type: 'segment', id: segment.id }); onSegmentPoint(segment.id, clientToWorld(event.clientX, event.clientY)) }} /></g> })}</g>
    <g data-layer="stations">{active.stations.map(station => <StationMarker key={station.id} project={shown} station={station} time={shown.timeline.currentDate} selected={selection?.type === 'station' && selection.id === station.id} hitRadius={stationHitRadius}
      onPointerDown={event => { event.stopPropagation(); if (drawing) { onConnectStation(station.id); return } onSelect({ type: 'station', id: station.id }); startObjectDrag('draggingStation', event, { x: station.x, y: station.y }, station.id) }}
      onLabelPointerDown={event => { onSelect({ type: 'station', id: station.id }); startObjectDrag('draggingLabel', event, { x: station.labelOffsetX, y: station.labelOffsetY }, station.id) }} />)}</g>
    <g data-layer="waypoints" data-editor="true">{(selection?.type === 'segment' || selection?.type === 'waypoint') && shown.geometry.segments.find(segment => segment.id === (selection.type === 'segment' ? selection.id : selection.segmentId))?.waypoints.map(waypoint => <circle key={waypoint.id} cx={waypoint.x} cy={waypoint.y} r="8" className={`waypoint ${selection.type === 'waypoint' && selection.id === waypoint.id ? 'selected' : ''}`} onPointerDown={event => { const segmentId = selection.type === 'segment' ? selection.id : selection.segmentId; onSelect({ type: 'waypoint', id: waypoint.id, segmentId }); startObjectDrag('draggingWaypoint', event, { x: waypoint.x, y: waypoint.y }, waypoint.id, segmentId) }} />)}</g>
    <g data-layer="station-actions" data-editor="true">{selection?.type === 'station' && !drawing && (() => { const station = shown.stations.find(item => item.id === selection.id); if (!station) return null; const handle = getStationHandleStyle(shown, station.id, shown.timeline.currentDate); return <g className="station-extend" transform={`translate(${handle.x} ${handle.y})`} onPointerDown={event => { event.stopPropagation(); onExtend(station.id) }}><circle className="station-extend-hit" r={Math.max(stationHitRadius, 18)} fill="transparent" pointerEvents="all" /><circle className="station-extend-button" r="8.5" fill="white" stroke={handle.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none" /><path className="station-extend-plus" d="M -3.2 0 H 3.2 M 0 -3.2 V 3.2" stroke={handle.color} strokeWidth="1.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" /></g> })()}</g>
  </svg>
}



