import type { ActualRouteProject, Segment, Waypoint } from '../data/model'

export interface Point { x: number; y: number }
export interface PathSpan { start: Point; control1: Point; control2: Point; end: Point; linear: boolean }
export interface RoundedPoint extends Point { cornerRadius?: number }
export interface RoundedCornerPlan {
  pointIndex: number
  corner: RoundedPoint
  requestedRadius: number
  effectiveRadius: number
  turnAngle: number
  trimDistance: number
  handleLength: number
}
export interface SegmentRoundedCornerPlan extends RoundedCornerPlan { waypointId: string }

const HANDLE_RATIO = 0.32
const MAX_CHORD_RATIO = 0.42
const EPSILON = 0.0001
export const DEFAULT_CORNER_RADIUS = 42

export function getSegmentPoints(project: ActualRouteProject, segment: Segment): Point[] {
  const from = project.stations.find(station => station.id === segment.fromStationId)
  const to = project.stations.find(station => station.id === segment.toStationId)
  if (!from || !to) return []
  return [from, ...segment.waypoints, to]
}

export function getSegmentPath(project: ActualRouteProject, segment: Segment): string {
  return pathSpansToSvgPath(getSegmentPathSpans(project, segment))
}

export function getSegmentPathSpans(project: ActualRouteProject, segment: Segment): PathSpan[] {
  const points = getSegmentPoints(project, segment)
  if (points.length < 2) return []
  if (segment.mode === 'rounded') return buildRoundedPolylineSpans(points, segment.cornerRadius ?? DEFAULT_CORNER_RADIUS)
  if (segment.mode !== 'smooth') return points.slice(0, -1).map((start, index) => ({ start, end: points[index + 1], control1: start, control2: points[index + 1], linear: true }))
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

export function pathSpansToSvgPath(spans: PathSpan[]): string {
  if (!spans.length) return ''
  let path = `M ${round(spans[0].start.x)} ${round(spans[0].start.y)}`
  for (const span of spans) path += span.linear
    ? ` L ${round(span.end.x)} ${round(span.end.y)}`
    : ` C ${round(span.control1.x)} ${round(span.control1.y)} ${round(span.control2.x)} ${round(span.control2.y)} ${round(span.end.x)} ${round(span.end.y)}`
  return path
}

export function reversePathSpans(spans: PathSpan[]): PathSpan[] {
  return [...spans].reverse().map(span => ({ start: span.end, control1: span.control2, control2: span.control1, end: span.start, linear: span.linear }))
}

export function getSegmentSubpathSpans(project: ActualRouteProject, segment: Segment, startProgress: number, endProgress: number): PathSpan[] {
  const start = clamp01(Math.min(startProgress, endProgress)), end = clamp01(Math.max(startProgress, endProgress))
  if (end - start < EPSILON) return []
  const spans = getSegmentPathSpans(project, segment), lengths = spans.map(measurePathSpan), total = lengths.reduce((sum, value) => sum + value, 0)
  if (!spans.length || total < EPSILON) return []
  const targetStart = start * total, targetEnd = end * total
  const result: PathSpan[] = []; let cursor = 0
  spans.forEach((span, index) => {
    const spanLength = lengths[index], overlapStart = Math.max(targetStart, cursor), overlapEnd = Math.min(targetEnd, cursor + spanLength)
    if (overlapEnd - overlapStart > EPSILON) {
      const localStart = solveSpanDistanceRatio(span, (overlapStart - cursor) / spanLength)
      const localEnd = solveSpanDistanceRatio(span, (overlapEnd - cursor) / spanLength)
      result.push(slicePathSpan(span, localStart, localEnd))
    }
    cursor += spanLength
  })
  return result
}

function measurePathSpan(span: PathSpan): number {
  if (span.linear) return distance(span.start, span.end)
  return adaptiveCubicLength(span.start, span.control1, span.control2, span.end, 0)
}
function adaptiveCubicLength(a: Point, b: Point, c: Point, d: Point, depth: number): number {
  const chord = distance(a, d), polygon = distance(a, b) + distance(b, c) + distance(c, d)
  if (depth >= 12 || polygon - chord < .01) return (polygon + chord) / 2
  const [left, right] = splitPathSpan({ start: a, control1: b, control2: c, end: d, linear: false }, .5)
  return adaptiveCubicLength(left.start, left.control1, left.control2, left.end, depth + 1) + adaptiveCubicLength(right.start, right.control1, right.control2, right.end, depth + 1)
}
function solveSpanDistanceRatio(span: PathSpan, distanceRatio: number): number {
  const target = clamp01(distanceRatio)
  if (span.linear || target <= 0 || target >= 1) return target
  const total = measurePathSpan(span); let low = 0, high = 1
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const middle = (low + high) / 2, [left] = splitPathSpan(span, middle)
    if (measurePathSpan(left) / total < target) low = middle
    else high = middle
  }
  return (low + high) / 2
}
function slicePathSpan(span: PathSpan, start: number, end: number): PathSpan {
  const from = clamp01(start), to = clamp01(end)
  if (from <= EPSILON && to >= 1 - EPSILON) return span
  const [left] = splitPathSpan(span, to)
  if (from <= EPSILON) return left
  return splitPathSpan(left, from / Math.max(EPSILON, to))[1]
}
function splitPathSpan(span: PathSpan, t: number): [PathSpan, PathSpan] {
  const progress = clamp01(t)
  if (span.linear) {
    const middle = lerp(span.start, span.end, progress)
    return [{ start: span.start, control1: span.start, control2: middle, end: middle, linear: true }, { start: middle, control1: middle, control2: span.end, end: span.end, linear: true }]
  }
  const ab = lerp(span.start, span.control1, progress), bc = lerp(span.control1, span.control2, progress), cd = lerp(span.control2, span.end, progress)
  const abc = lerp(ab, bc, progress), bcd = lerp(bc, cd, progress), middle = lerp(abc, bcd, progress)
  return [{ start: span.start, control1: ab, control2: abc, end: middle, linear: false }, { start: middle, control1: bcd, control2: cd, end: span.end, linear: false }]
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

export function getSegmentCurveSamples(project: ActualRouteProject, segment: Segment, samplesPerSpan = 18): Point[] {
  const points = getSegmentPoints(project, segment)
  if (points.length < 2 || (segment.mode !== 'smooth' && segment.mode !== 'rounded')) return points
  const result: Point[] = []
  for (const span of getSegmentPathSpans(project, segment)) {
    if (!result.length) result.push(span.start)
    if (span.linear) { result.push(span.end); continue }
    for (let index = 1; index <= samplesPerSpan; index += 1) result.push(cubic(span.start, span.control1, span.control2, span.end, index / samplesPerSpan))
  }
  return result
}

export function getSegmentCurveLength(project: ActualRouteProject, segment: Segment, samplesPerSpan = 18): number {
  const samples = getSegmentCurveSamples(project, segment, samplesPerSpan)
  return Math.max(1, samples.slice(1).reduce((sum, point, index) => sum + distance(samples[index], point), 0))
}

export function sampleSegmentAtLengthRatio(project: ActualRouteProject, segment: Segment, ratio: number): { point: Point; tangent: Point } | null {
  const samples = getSegmentCurveSamples(project, segment)
  if (samples.length < 2) return null
  const lengths = samples.slice(1).map((point, index) => distance(samples[index], point))
  const total = lengths.reduce((sum, value) => sum + value, 0)
  const target = clamp01(ratio) * total
  let cursor = 0
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]
    if (target <= cursor + length || index === lengths.length - 1) {
      const local = length > EPSILON ? (target - cursor) / length : 0
      const start = samples[index], end = samples[index + 1]
      return { point: lerp(start, end, clamp01(local)), tangent: normalize({ x: end.x - start.x, y: end.y - start.y }) }
    }
    cursor += length
  }
  return null
}

export function findSegmentProgressForPoint(project: ActualRouteProject, segment: Segment, point: Point): number {
  const spans = getSegmentPathSpans(project, segment), lengths = spans.map(measurePathSpan), total = lengths.reduce((sum, value) => sum + value, 0) || 1
  if (!spans.length) return 0
  let bestDistance = Number.POSITIVE_INFINITY, bestProgress = 0, cursor = 0
  spans.forEach((span, index) => {
    const t = closestParameterOnSpan(span, point), projected = span.linear ? lerp(span.start, span.end, t) : cubic(span.start, span.control1, span.control2, span.end, t)
    const candidate = distance(projected, point)
    if (candidate < bestDistance) {
      bestDistance = candidate
      const partial = t <= EPSILON ? 0 : t >= 1 - EPSILON ? lengths[index] : measurePathSpan(slicePathSpan(span, 0, t))
      bestProgress = (cursor + partial) / total
    }
    cursor += lengths[index]
  })
  return clamp01(bestProgress)
}
function closestParameterOnSpan(span: PathSpan, point: Point): number {
  if (span.linear) {
    const dx = span.end.x - span.start.x, dy = span.end.y - span.start.y, squared = dx * dx + dy * dy
    return squared ? clamp01(((point.x - span.start.x) * dx + (point.y - span.start.y) * dy) / squared) : 0
  }
  const candidates = [0, 1]
  for (let seedIndex = 0; seedIndex <= 12; seedIndex += 1) {
    let t = seedIndex / 12
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const position = cubic(span.start, span.control1, span.control2, span.end, t), first = cubicDerivative(span, t), second = cubicSecondDerivative(span, t)
      const offset = { x: position.x - point.x, y: position.y - point.y }
      const numerator = offset.x * first.x + offset.y * first.y
      const denominator = first.x * first.x + first.y * first.y + offset.x * second.x + offset.y * second.y
      if (Math.abs(denominator) < EPSILON) break
      const next = clamp01(t - numerator / denominator)
      if (Math.abs(next - t) < 1e-7) { t = next; break }
      t = next
    }
    candidates.push(t)
  }
  return candidates.reduce((best, value) => squaredDistance(cubic(span.start, span.control1, span.control2, span.end, value), point) < squaredDistance(cubic(span.start, span.control1, span.control2, span.end, best), point) ? value : best, 0)
}
function cubicDerivative(span: PathSpan, t: number): Point {
  const u = 1 - t
  return { x: 3 * u * u * (span.control1.x - span.start.x) + 6 * u * t * (span.control2.x - span.control1.x) + 3 * t * t * (span.end.x - span.control2.x), y: 3 * u * u * (span.control1.y - span.start.y) + 6 * u * t * (span.control2.y - span.control1.y) + 3 * t * t * (span.end.y - span.control2.y) }
}
function cubicSecondDerivative(span: PathSpan, t: number): Point {
  const u = 1 - t
  return { x: 6 * u * (span.control2.x - 2 * span.control1.x + span.start.x) + 6 * t * (span.end.x - 2 * span.control2.x + span.control1.x), y: 6 * u * (span.control2.y - 2 * span.control1.y + span.start.y) + 6 * t * (span.end.y - 2 * span.control2.y + span.control1.y) }
}
const squaredDistance = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2
export function getSegmentSubpathSamples(project: ActualRouteProject, segment: Segment, startProgress: number, endProgress: number): Point[] {
  const start = clamp01(Math.min(startProgress, endProgress)), end = clamp01(Math.max(startProgress, endProgress))
  if (end - start < EPSILON) return []
  const length = getSegmentCurveLength(project, segment), steps = Math.max(2, Math.ceil(length * (end - start) / 12))
  return Array.from({ length: steps + 1 }, (_, index) => sampleSegmentAtLengthRatio(project, segment, start + (end - start) * index / steps)?.point).filter((point): point is Point => Boolean(point))
}
export function sampleSegmentNearStation(project: ActualRouteProject, segment: Segment, stationId: string, epsilon = 0.025): Point | null {
  const points = getSegmentPoints(project, segment)
  if (points.length < 2 || (segment.fromStationId !== stationId && segment.toStationId !== stationId)) return null
  if (segment.mode !== 'smooth' && segment.mode !== 'rounded') {
    const start = segment.fromStationId === stationId ? points[0] : points.at(-1)!
    const inner = segment.fromStationId === stationId ? points[1] : points.at(-2)!
    return lerp(start, inner, epsilon)
  }
  const spans = getSegmentPathSpans(project, segment)
  const fromSide = segment.fromStationId === stationId
  const span = fromSide ? spans[0] : spans.at(-1)!
  if (span.linear) return fromSide ? lerp(span.start, span.end, epsilon) : lerp(span.end, span.start, epsilon)
  return fromSide
    ? cubic(span.start, span.control1, span.control2, span.end, epsilon)
    : cubic(span.end, span.control2, span.control1, span.start, epsilon)
}

export interface CircularFilletMetrics { radius: number; turnAngle: number; trimDistance: number; handleLength: number }

export function getCircularFilletMetrics(radius: number, turnAngle: number): CircularFilletMetrics {
  const safeRadius = Math.max(0, radius)
  const safeAngle = Math.max(0, Math.min(Math.PI - 1e-7, turnAngle))
  return { radius: safeRadius, turnAngle: safeAngle, trimDistance: safeRadius * Math.tan(safeAngle / 2), handleLength: (4 / 3) * safeRadius * Math.tan(safeAngle / 4) }
}

export function getRoundedPolylineCornerPlans(points: RoundedPoint[], defaultRadius = DEFAULT_CORNER_RADIUS): RoundedCornerPlan[] {
  const plans = points.map((corner, index): RoundedCornerPlan | null => {
    if (index === 0 || index === points.length - 1) return null
    const previous = points[index - 1], next = points[index + 1]
    const incomingLength = distance(previous, corner), outgoingLength = distance(corner, next)
    if (incomingLength < EPSILON || outgoingLength < EPSILON) return null
    const incoming = normalize({ x: corner.x - previous.x, y: corner.y - previous.y })
    const outgoing = normalize({ x: next.x - corner.x, y: next.y - corner.y })
    const turnCosine = Math.max(-1, Math.min(1, dot(incoming, outgoing)))
    if (Math.abs(1 - Math.abs(turnCosine)) < 1e-7) return null
    const localRadius = Number.isFinite(corner.cornerRadius) ? Math.max(0, corner.cornerRadius!) : Math.max(0, defaultRadius)
    const metrics = getCircularFilletMetrics(localRadius, Math.acos(turnCosine))
    return { pointIndex: index, corner, requestedRadius: localRadius, effectiveRadius: metrics.radius, turnAngle: metrics.turnAngle, trimDistance: metrics.trimDistance, handleLength: metrics.handleLength, incoming, outgoing } as RoundedCornerPlan & { incoming: Point; outgoing: Point }
  })
  for (let legIndex = 0; legIndex < points.length - 1; legIndex += 1) {
    const startPlan = plans[legIndex], endPlan = plans[legIndex + 1]
    const occupied = (startPlan?.trimDistance ?? 0) + (endPlan?.trimDistance ?? 0)
    const legLength = distance(points[legIndex], points[legIndex + 1])
    if (occupied <= legLength + EPSILON || occupied < EPSILON) continue
    const factor = legLength / occupied
    for (const plan of [startPlan, endPlan]) {
      if (!plan) continue
      plan.effectiveRadius *= factor
      plan.trimDistance *= factor
      plan.handleLength *= factor
    }
  }
  return plans.filter((plan): plan is RoundedCornerPlan & { incoming: Point; outgoing: Point } => Boolean(plan))
}

export function getSegmentRoundedCornerPlans(project: ActualRouteProject, segment: Segment): SegmentRoundedCornerPlan[] {
  if (segment.mode !== 'rounded') return []
  return getRoundedPolylineCornerPlans(getSegmentPoints(project, segment), segment.cornerRadius ?? DEFAULT_CORNER_RADIUS).flatMap(plan => {
    const waypoint = segment.waypoints[plan.pointIndex - 1]
    return waypoint ? [{ ...plan, waypointId: waypoint.id }] : []
  })
}

export function getWaypointCornerPlan(project: ActualRouteProject, segment: Segment, waypoint: Pick<Waypoint, 'id'>): SegmentRoundedCornerPlan | undefined {
  return getSegmentRoundedCornerPlans(project, segment).find(plan => plan.waypointId === waypoint.id)
}

export function buildRoundedPolylineSpans(points: RoundedPoint[], requestedRadius = DEFAULT_CORNER_RADIUS): PathSpan[] {
  if (points.length < 2) return []
  const planList = getRoundedPolylineCornerPlans(points, requestedRadius)
  const plans = new Map(planList.map(plan => [plan.pointIndex, plan]))
  const spans: PathSpan[] = []
  let cursor = points[0]
  for (let index = 1; index < points.length - 1; index += 1) {
    const plan = plans.get(index) as (RoundedCornerPlan & { incoming: Point; outgoing: Point }) | undefined
    if (!plan) continue
    if (plan.effectiveRadius <= EPSILON || plan.trimDistance <= EPSILON) {
      if (distance(cursor, plan.corner) > EPSILON) spans.push({ start: cursor, end: plan.corner, control1: cursor, control2: plan.corner, linear: true })
      cursor = plan.corner
      continue
    }
    const entry = subtract(plan.corner, { x: plan.incoming.x * plan.trimDistance, y: plan.incoming.y * plan.trimDistance })
    const exit = add(plan.corner, { x: plan.outgoing.x * plan.trimDistance, y: plan.outgoing.y * plan.trimDistance })
    if (distance(cursor, entry) > EPSILON) spans.push({ start: cursor, end: entry, control1: cursor, control2: entry, linear: true })
    spans.push({ start: entry, control1: add(entry, { x: plan.incoming.x * plan.handleLength, y: plan.incoming.y * plan.handleLength }), control2: subtract(exit, { x: plan.outgoing.x * plan.handleLength, y: plan.outgoing.y * plan.handleLength }), end: exit, linear: false })
    cursor = exit
  }
  const end = points.at(-1)!
  if (distance(cursor, end) > EPSILON) spans.push({ start: cursor, end, control1: cursor, control2: end, linear: true })
  return spans
}
const reflect = (inner: Point, endpoint: Point): Point => ({ x: endpoint.x * 2 - inner.x, y: endpoint.y * 2 - inner.y })
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const normalize = (value: Point, fallback: Point = { x: 1, y: 0 }): Point => { const length = Math.hypot(value.x, value.y); if (length > EPSILON) return { x: value.x / length, y: value.y / length }; const fallbackLength = Math.hypot(fallback.x, fallback.y) || 1; return { x: fallback.x / fallbackLength, y: fallback.y / fallbackLength } }
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const cubic = (a: Point, b: Point, c: Point, d: Point, t: number): Point => { const u = 1 - t; return { x: u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x, y: u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y } }
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const round = (value: number) => Number(value.toFixed(2))
