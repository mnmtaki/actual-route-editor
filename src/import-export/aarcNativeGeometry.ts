import type { AarcSkeletonNode } from './aarcGeometry'

const EPS = 1e-4
const TURN_45_RATIO = 2.4142135 * .618

type Point = Pick<AarcSkeletonNode, 'x' | 'y' | 'free'>
type RoundedWayRel = '45' | '90'

/**
 * Bake AARC's rendered corner shape into one native ARE waypoint radius.
 * After import, geometry editing must not depend on AARC source semantics.
 */
export function getAarcNativeCornerRadius(
  nodes: AarcSkeletonNode[],
  index: number,
  config: Record<string, unknown>,
  sourceWidthRatio?: number,
): number {
  if (index <= 0 || index >= nodes.length - 1) return 0
  const previous = nodes[index - 1], current = nodes[index], next = nodes[index + 1]
  const incomingRaw = subtract(current, previous)
  const outgoingRaw = subtract(next, current)
  const incomingLength = magnitude(incomingRaw), outgoingLength = magnitude(outgoingRaw)
  if (incomingLength < EPS || outgoingLength < EPS) return 0

  const free = previous.free === true || current.free === true || next.free === true
  const relation = free ? null : roundedCornerRelation(incomingRaw, outgoingRaw)
  if (!free && !relation) return 0

  const incoming = free ? unit(incomingRaw) : unit8(incomingRaw)
  const outgoing = free ? unit(outgoingRaw) : unit8(outgoingRaw)
  const dot = clamp(incoming.x * outgoing.x + incoming.y * outgoing.y, -1, 1)
  const cross = cross2(incoming, outgoing)
  const deflection = Math.acos(dot)
  if (deflection < EPS || Math.PI - deflection < EPS) return 0

  let trim: number
  if (free) {
    const theta = Math.atan2(Math.abs(cross), -dot)
    const sourceRadius = getAarcTurnMetric(config, sourceWidthRatio, theta)
    const tanHalfInterior = Math.tan(theta / 2)
    trim = Math.min(
      tanHalfInterior > EPS ? sourceRadius / tanHalfInterior : 0,
      incomingLength / 2,
      outgoingLength / 2,
    )
  } else {
    trim = Math.min(
      getAarcTurnMetric(config, sourceWidthRatio, relation!),
      incomingLength / 2,
      outgoingLength / 2,
    )
  }
  if (!Number.isFinite(trim) || trim < EPS) return 0

  const tanHalfDeflection = Math.tan(deflection / 2)
  if (!Number.isFinite(tanHalfDeflection) || Math.abs(tanHalfDeflection) < EPS) return 0
  return trim / tanHalfDeflection
}

function getAarcTurnMetric(config: Record<string, unknown>, sourceWidthRatio: number | undefined, relation: RoundedWayRel | number) {
  const widthRatio = Number.isFinite(sourceWidthRatio) && sourceWidthRatio !== 0 ? sourceWidthRatio! : 1
  const lineTurnAreaRadius = finiteNumber(config.lineTurnAreaRadius) ?? 30
  const lineWidth = finiteNumber(config.lineWidth) ?? 14
  let radius = Math.max(0, lineTurnAreaRadius * widthRatio + lineWidth * widthRatio / 2)
  if (typeof relation === 'number') {
    if (isZero(relation - Math.PI / 4)) radius /= TURN_45_RATIO
    else if (isZero(relation - 3 * Math.PI / 4)) radius *= TURN_45_RATIO
  } else if (relation === '45') {
    radius /= TURN_45_RATIO
  }
  return radius
}

function roundedCornerRelation(a: Point, b: Point): RoundedWayRel | null {
  const aw = octilinearWay(a), bw = octilinearWay(b)
  if (!aw || !bw || isZero(cross2(aw, bw))) return null
  const dot = aw.x * bw.x + aw.y * bw.y
  if (isZero(dot)) return '90'
  return dot > 0 ? '45' : null
}

function octilinearWay(value: Point): Point | null {
  const x = Math.abs(value.x), y = Math.abs(value.y)
  if (x < EPS && y < EPS) return null
  if (!(x < EPS || y < EPS || Math.abs(x - y) < EPS)) return null
  return signWay(value)
}

function subtract(a: Point, b: Point): Point { return { x: a.x - b.x, y: a.y - b.y } }
function magnitude(value: Point) { return Math.hypot(value.x, value.y) }
function unit(value: Point): Point {
  const length = magnitude(value) || 1
  return { x: value.x / length, y: value.y / length }
}
function signWay(value: Point): Point {
  return { x: isZero(value.x) ? 0 : value.x > 0 ? 1 : -1, y: isZero(value.y) ? 0 : value.y > 0 ? 1 : -1 }
}
function unit8(value: Point): Point { return unit(signWay(value)) }
function cross2(a: Point, b: Point) { return a.x * b.y - a.y * b.x }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
function isZero(value: number) { return Math.abs(value) < EPS }
function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}
