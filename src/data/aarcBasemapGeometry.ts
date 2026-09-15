import type { BasemapPath, BasemapPathPoint } from './model'
import { formalizeAarcControlPoints, type AarcFormalPoint } from '../geometry/aarcFormalize'

const EPS = 1e-4
const TURN_45_RATIO = 2.4142135 * .618

type WayRel = 'parallel' | '90' | '45' | '135'
type Coord = { x: number; y: number }

export type AarcBasemapFormalPoint = AarcFormalPoint

export function formalizeAarcBasemapPoints(points: BasemapPathPoint[]): AarcBasemapFormalPoint[] {
  return formalizeAarcControlPoints(points.map(point => ({
    id: Number.isFinite(point.aarcPointId) ? point.aarcPointId! : point.id,
    x: point.x,
    y: point.y,
    dir: point.aarcDir === 1 ? 1 : 0,
    free: point.aarcFree === true,
  })))
}

/** Build the same formalized and rounded path used by AARC for terrain lines. */
export function buildAarcBasemapPathD(path: BasemapPath): string {
  const points = formalizeAarcBasemapPoints(path.points)
  if (!points.length) return ''
  if (points.length === 1) return `M ${fmt(points[0].x)} ${fmt(points[0].y)}`
  const ring = points.length > 2 && sameCoord(points[0], points.at(-1)!)
  const commands: string[] = []

  if (!ring) {
    commands.push(`M ${fmt(points[0].x)} ${fmt(points[0].y)}`)
    for (let i = 1; i < points.length - 1; i += 1) appendCorner(commands, path, points[i - 1], points[i], points[i + 1])
    commands.push(`L ${fmt(points.at(-1)!.x)} ${fmt(points.at(-1)!.y)}`)
    if (path.closed) commands.push('Z')
    return commands.join(' ')
  }

  const unique = points.slice(0, -1)
  if (unique.length < 2) return `M ${fmt(points[0].x)} ${fmt(points[0].y)}${path.closed ? ' Z' : ''}`
  const first = cornerGeometry(path, unique.at(-1)!, unique[0], unique[1])
  commands.push(`M ${fmt(first.before.x)} ${fmt(first.before.y)}`)
  appendArc(commands, first.before, unique[0], first.after, first.free)
  for (let i = 1; i < unique.length; i += 1) {
    const corner = cornerGeometry(path, unique[(i - 1 + unique.length) % unique.length], unique[i], unique[(i + 1) % unique.length])
    commands.push(`L ${fmt(corner.before.x)} ${fmt(corner.before.y)}`)
    appendArc(commands, corner.before, unique[i], corner.after, corner.free)
  }
  commands.push(`L ${fmt(first.before.x)} ${fmt(first.before.y)}`)
  if (path.closed) commands.push('Z')
  return commands.join(' ')
}

function appendCorner(commands: string[], path: BasemapPath, previous: AarcBasemapFormalPoint, current: AarcBasemapFormalPoint, next: AarcBasemapFormalPoint) {
  const corner = cornerGeometry(path, previous, current, next)
  commands.push(`L ${fmt(corner.before.x)} ${fmt(corner.before.y)}`)
  appendArc(commands, corner.before, current, corner.after, corner.free)
}

function cornerGeometry(path: BasemapPath, previous: AarcBasemapFormalPoint, current: AarcBasemapFormalPoint, next: AarcBasemapFormalPoint) {
  const free = previous.free === true || current.free === true || next.free === true
  const incoming = { x: current.x - previous.x, y: current.y - previous.y }
  const outgoing = { x: next.x - current.x, y: next.y - current.y }
  const incomingLength = magnitude(incoming), outgoingLength = magnitude(outgoing)
  if (incomingLength < EPS || outgoingLength < EPS) return { before: current, after: current, free }

  if (free) {
    const u1 = unit(incoming), u2 = unit(outgoing)
    const dot = u1.x * u2.x + u1.y * u2.y
    const cross = u1.x * u2.y - u1.y * u2.x
    if (Math.abs(cross) < EPS) return { before: current, after: current, free }
    const theta = Math.atan2(Math.abs(cross), -dot)
    const radius = getTurnRadius(path, theta)
    const tanHalf = Math.tan(theta / 2)
    const distance = Math.min(tanHalf > EPS ? radius / tanHalf : 0, incomingLength / 2, outgoingLength / 2)
    return {
      before: { x: current.x - u1.x * distance, y: current.y - u1.y * distance },
      after: { x: current.x + u2.x * distance, y: current.y + u2.y * distance },
      free,
    }
  }

  const relation = wayRel(incoming, outgoing)
  const distance = Math.min(getTurnRadius(path, relation), incomingLength / 2, outgoingLength / 2)
  const beforeWay = unit8({ x: previous.x - current.x, y: previous.y - current.y })
  const afterWay = unit8({ x: next.x - current.x, y: next.y - current.y })
  return {
    before: { x: current.x + beforeWay.x * distance, y: current.y + beforeWay.y * distance },
    after: { x: current.x + afterWay.x * distance, y: current.y + afterWay.y * distance },
    free,
  }
}

function appendArc(commands: string[], before: Coord, via: Coord, after: Coord, free: boolean) {
  const incoming = { x: via.x - before.x, y: via.y - before.y }
  const outgoing = { x: after.x - via.x, y: after.y - via.y }
  const a = free ? unit(incoming) : unit8(incoming)
  const b = free ? unit(outgoing) : unit8(outgoing)
  const cross = cross2(a, b)
  if (Math.abs(cross) < EPS) {
    commands.push(`L ${fmt(after.x)} ${fmt(after.y)}`)
    return
  }
  const normalA = { x: -a.y, y: a.x }
  const normalB = { x: -b.y, y: b.x }
  const denominator = cross2(normalA, normalB)
  if (Math.abs(denominator) < EPS) {
    commands.push(`L ${fmt(after.x)} ${fmt(after.y)}`)
    return
  }
  const delta = { x: after.x - before.x, y: after.y - before.y }
  const t = cross2(delta, normalB) / denominator
  const center = { x: before.x + normalA.x * t, y: before.y + normalA.y * t }
  const radius = Math.hypot(before.x - center.x, before.y - center.y)
  if (!Number.isFinite(radius) || radius < EPS) {
    commands.push(`L ${fmt(after.x)} ${fmt(after.y)}`)
    return
  }
  // Canvas AARC uses counterClockwise = cross < 0. SVG sweep=0 is the corresponding arc in screen coordinates.
  const sweep = cross < 0 ? 0 : 1
  commands.push(`A ${fmt(radius)} ${fmt(radius)} 0 0 ${sweep} ${fmt(after.x)} ${fmt(after.y)}`)
}

function getTurnRadius(path: BasemapPath, relation: WayRel | number) {
  const geometry = path.geometry?.kind === 'aarc' ? path.geometry : undefined
  const base = geometry?.lineTurnAreaRadius ?? 30
  // AARC terrain calls getTurnRadiusOf(line, relation) with the default 'inner' justification.
  let radius = Math.max(0, base + path.width / 2)
  if (typeof relation === 'number') {
    if (isZero(relation - Math.PI / 4)) radius /= TURN_45_RATIO
    else if (isZero(relation - 3 * Math.PI / 4)) radius *= TURN_45_RATIO
  } else if (relation === '45') radius /= TURN_45_RATIO
  else if (relation === '135') radius *= TURN_45_RATIO
  return radius
}

function wayRel(a: Coord, b: Coord): WayRel {
  const aw = signWay(a), bw = signWay(b)
  if (isZero(cross2(aw, bw))) return 'parallel'
  const dot = aw.x * bw.x + aw.y * bw.y
  if (isZero(dot)) return '90'
  return dot > 0 ? '45' : '135'
}

function isZero(value: number) { return Math.abs(value) < EPS }
function sameCoord(a: Coord, b: Coord) { return isZero(a.x - b.x) && isZero(a.y - b.y) }
function cross2(a: Coord, b: Coord) { return a.x * b.y - a.y * b.x }
function magnitude(value: Coord) { return Math.hypot(value.x, value.y) }
function unit(value: Coord): Coord { const length = magnitude(value) || 1; return { x: value.x / length, y: value.y / length } }
function signWay(value: Coord): Coord { return { x: isZero(value.x) ? 0 : value.x > 0 ? 1 : -1, y: isZero(value.y) ? 0 : value.y > 0 ? 1 : -1 } }
function unit8(value: Coord): Coord { return unit(signWay(value)) }
function fmt(value: number) { const rounded = Math.round(value * 1e6) / 1e6; return Object.is(rounded, -0) ? '0' : String(rounded) }
