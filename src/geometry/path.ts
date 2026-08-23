import type { ActualRouteProject, Segment } from '../data/model'

export interface Point { x: number; y: number }
interface BezierSpan { start: Point; control1: Point; control2: Point; end: Point; linear: boolean }

const HANDLE_RATIO = 0.32
const MAX_CHORD_RATIO = 0.42
const EPSILON = 0.0001

export function getSegmentPoints(project: ActualRouteProject, segment: Segment): Point[] {
  const from = project.stations.find(station => station.id === segment.fromStationId)
  const to = project.stations.find(station => station.id === segment.toStationId)
  if (!from || !to) return []
  return [from, ...segment.waypoints, to]
}

export function getSegmentPath(project: ActualRouteProject, segment: Segment): string {
  const points = getSegmentPoints(project, segment)
  if (points.length < 2) return ''
  if (segment.mode !== 'smooth') return points.map((point, index) => `${index ? 'L' : 'M'} ${round(point.x)} ${round(point.y)}`).join(' ')
  const spans = getBezierSpans(project, segment)
  if (!spans.length) return ''
  let path = `M ${round(spans[0].start.x)} ${round(spans[0].start.y)}`
  for (const span of spans) {
    path += span.linear
      ? ` L ${round(span.end.x)} ${round(span.end.y)}`
      : ` C ${round(span.control1.x)} ${round(span.control1.y)}, ${round(span.control2.x)} ${round(span.control2.y)}, ${round(span.end.x)} ${round(span.end.y)}`
  }
  return path
}

function getBezierSpans(project: ActualRouteProject, segment: Segment): BezierSpan[] {
  const points = getSegmentPoints(project, segment)
  if (points.length < 2) return []
  const before = getContinuationPoint(project, segment, segment.fromStationId, points[1]) ?? reflect(points[1], points[0])
  const after = getContinuationPoint(project, segment, segment.toStationId, points.at(-2)!) ?? reflect(points.at(-2)!, points.at(-1)!)
  const extended = [before, ...points, after]
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1]
    const startType = 'type' in start ? start.type : 'smooth'
    const endType = 'type' in end ? end.type : 'smooth'
    if (startType === 'corner' || endType === 'corner') return { start, end, control1: start, control2: end, linear: true }
    const previous = extended[index]
    const following = extended[index + 3]
    const chord = distance(start, end)
    const control1 = add(start, limitedTangent(previous, start, end, chord))
    const control2 = subtract(end, limitedTangent(start, end, following, chord))
    return { start, end, control1, control2, linear: false }
  })
}

function limitedTangent(previous: Point, current: Point, next: Point, chord: number): Point {
  const incoming = distance(previous, current)
  const outgoing = distance(current, next)
  const direction = normalize({ x: next.x - previous.x, y: next.y - previous.y }, { x: next.x - current.x, y: next.y - current.y })
  const localLimit = Math.min(incoming, outgoing) * HANDLE_RATIO
  const handleLength = Math.min(chord * MAX_CHORD_RATIO, localLimit)
  return { x: direction.x * handleLength, y: direction.y * handleLength }
}

function getContinuationPoint(project: ActualRouteProject, segment: Segment, stationId: string, currentInnerPoint: Point): Point | null {
  const station = project.stations.find(item => item.id === stationId)
  if (!station) return null
  const currentDirection = normalize({ x: currentInnerPoint.x - station.x, y: currentInnerPoint.y - station.y })
  const candidates = project.geometry.segments
    .filter(item => item.id !== segment.id && item.lineId === segment.lineId && (item.fromStationId === stationId || item.toStationId === stationId))
    .map(item => ({ point: nearestInnerPoint(project, item, stationId), item }))
    .filter((value): value is { point: Point; item: Segment } => Boolean(value.point))
    .map(value => ({ ...value, alignment: dot(currentDirection, normalize({ x: value.point.x - station.x, y: value.point.y - station.y })) }))
    .sort((a, b) => a.alignment - b.alignment)
  return candidates[0]?.point ?? null
}

function nearestInnerPoint(project: ActualRouteProject, segment: Segment, stationId: string): Point | null {
  const points = getSegmentPoints(project, segment)
  if (points.length < 2) return null
  if (segment.fromStationId === stationId) return points[1]
  if (segment.toStationId === stationId) return points.at(-2)!
  return null
}

export function sampleSegmentNearStation(project: ActualRouteProject, segment: Segment, stationId: string, epsilon = 0.025): Point | null {
  const points = getSegmentPoints(project, segment)
  if (points.length < 2 || (segment.fromStationId !== stationId && segment.toStationId !== stationId)) return null
  if (segment.mode !== 'smooth') {
    const start = segment.fromStationId === stationId ? points[0] : points.at(-1)!
    const inner = segment.fromStationId === stationId ? points[1] : points.at(-2)!
    return lerp(start, inner, epsilon)
  }
  const spans = getBezierSpans(project, segment)
  const fromSide = segment.fromStationId === stationId
  const span = fromSide ? spans[0] : spans.at(-1)!
  if (span.linear) return fromSide ? lerp(span.start, span.end, epsilon) : lerp(span.end, span.start, epsilon)
  return fromSide
    ? cubic(span.start, span.control1, span.control2, span.end, epsilon)
    : cubic(span.end, span.control2, span.control1, span.start, epsilon)
}

const reflect = (inner: Point, endpoint: Point): Point => ({ x: endpoint.x * 2 - inner.x, y: endpoint.y * 2 - inner.y })
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const normalize = (value: Point, fallback: Point = { x: 1, y: 0 }): Point => { const length = Math.hypot(value.x, value.y); if (length > EPSILON) return { x: value.x / length, y: value.y / length }; const fallbackLength = Math.hypot(fallback.x, fallback.y) || 1; return { x: fallback.x / fallbackLength, y: fallback.y / fallbackLength } }
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const cubic = (a: Point, b: Point, c: Point, d: Point, t: number): Point => { const u = 1 - t; return { x: u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x, y: u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y } }
const round = (value: number) => Number(value.toFixed(2))
