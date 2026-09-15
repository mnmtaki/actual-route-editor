import type { BasemapPath, BasemapPathPoint } from './model'

const EPS = 1e-4
const TURN_45_RATIO = 2.4142135 * .618

type Dir = 0 | 1
type PosRel = 's' | 'l' | 'llu' | 'lu' | 'luu' | 'u' | 'uur' | 'ur' | 'urr'
type WayRel = 'parallel' | '90' | '45' | '135'
type Coord = { x: number; y: number }

interface ControlPoint extends Coord {
  key: string | number
  dir: Dir
  free: boolean
}

interface FormalSeg {
  a: Coord
  itp: Coord[]
  b: Coord
  ill: number
  direct?: boolean
  aFree?: boolean
  bFree?: boolean
}

export interface AarcBasemapFormalPoint extends Coord {
  free?: boolean
}

/** Port of AARC formalize.ts for imported terrain control points. */
export function formalizeAarcBasemapPoints(points: BasemapPathPoint[]): AarcBasemapFormalPoint[] {
  const controls: ControlPoint[] = points.map(point => ({
    key: Number.isFinite(point.aarcPointId) ? point.aarcPointId! : point.id,
    x: point.x,
    y: point.y,
    dir: point.aarcDir === 1 ? 1 : 0,
    free: point.aarcFree === true,
  }))
  if (controls.length < 2) return controls.map(point => ({ x: point.x, y: point.y, ...(point.free ? { free: true } : {}) }))

  const ring = controls.length > 2 && controls[0].key === controls.at(-1)!.key
  const segs: FormalSeg[] = []
  if (!ring) {
    for (let i = 0; i < controls.length - 1; i += 1) segs.push(formalizeSeg(controls[i], controls[i + 1]))
  } else {
    segs.push(formalizeSeg(controls[controls.length - 2], controls[0]))
    for (let i = 0; i < controls.length - 1; i += 1) segs.push(formalizeSeg(controls[i], controls[i + 1]))
    segs.push(formalizeSeg(controls.at(-1)!, controls[1]))
  }
  justifyIllPosedSegments(segs)
  if (!segs.length) return []
  if (ring) { segs.shift(); segs.pop() }

  const result: AarcBasemapFormalPoint[] = [{ x: segs[0].a.x, y: segs[0].a.y, ...(segs[0].aFree ? { free: true } : {}) }]
  for (const seg of segs) {
    for (const point of seg.itp) result.push({ x: point.x, y: point.y })
    result.push({ x: seg.b.x, y: seg.b.y, ...(seg.bFree ? { free: true } : {}) })
  }
  return result
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

function formalizeSeg(originalA: ControlPoint, originalB: ControlPoint): FormalSeg {
  if (originalA.free || originalB.free) return { a: coord(originalA), itp: [], b: coord(originalB), ill: 0, direct: true, aFree: originalA.free, bFree: originalB.free }
  let a = originalA, b = originalB
  let xDiff = a.x - b.x, yDiff = a.y - b.y
  const relation = coordRelDiff(xDiff, yDiff)
  const posRel = relation.posRel
  const reversed = relation.rev
  if (posRel === 's') return { a: coord(originalA), itp: [], b: coord(originalB), ill: 0, aFree: originalA.free, bFree: originalB.free }
  if (reversed) {
    ;[a, b] = [b, a]
    xDiff = -xDiff
    yDiff = -yDiff
  }
  let itp: Coord[] = []
  let ill = 0
  if (a.dir === b.dir) {
    itp = coordFill(a, b, xDiff, yDiff, posRel, reversed, a.dir === 1 ? 'midVert' : 'midInc')
    if (!itp.length) {
      if ((a.dir === 0 && (posRel === 'lu' || posRel === 'ur')) || (a.dir === 1 && (posRel === 'l' || posRel === 'u'))) ill = 2
    } else ill = 1
  } else if (a.dir === 1) {
    itp = coordFill(a, b, xDiff, yDiff, posRel, reversed, posRel === 'luu' || posRel === 'uur' ? 'top' : 'bottom')
  } else {
    itp = coordFill(a, b, xDiff, yDiff, posRel, reversed, posRel === 'luu' || posRel === 'uur' ? 'bottom' : 'top')
  }
  return { a: coord(originalA), itp, b: coord(originalB), ill, aFree: originalA.free, bFree: originalB.free }
}

function coordRelDiff(xDiff: number, yDiff: number): { posRel: PosRel; rev: boolean } {
  if (isZero(xDiff)) {
    if (isZero(yDiff)) return { posRel: 's', rev: false }
    return { posRel: 'u', rev: yDiff > 0 }
  }
  if (isZero(yDiff)) return { posRel: 'l', rev: xDiff > 0 }
  if (isZero(xDiff - yDiff)) return { posRel: 'lu', rev: xDiff > 0 }
  if (isZero(xDiff + yDiff)) return { posRel: 'ur', rev: yDiff > 0 }
  if ((yDiff > 0 && xDiff > yDiff) || (yDiff < 0 && xDiff < yDiff)) return { posRel: 'llu', rev: yDiff > 0 }
  if ((xDiff > 0 && yDiff > xDiff) || (xDiff < 0 && yDiff < xDiff)) return { posRel: 'luu', rev: xDiff > 0 }
  if ((yDiff > 0 && -xDiff < yDiff) || (yDiff < 0 && xDiff < -yDiff)) return { posRel: 'uur', rev: yDiff > 0 }
  return { posRel: 'urr', rev: xDiff < 0 }
}

function coordFill(a: Coord, b: Coord, xDiff: number, yDiff: number, posRel: PosRel, reversed: boolean, type: 'top' | 'bottom' | 'midVert' | 'midInc'): Coord[] {
  const result: Coord[] = []
  if (posRel === 'l' || posRel === 'u' || posRel === 'lu' || posRel === 'ur') return result
  if (posRel === 'llu') {
    if (type === 'top') { const bias = -xDiff + yDiff; result.push({ x: a.x + bias, y: a.y }) }
    else if (type === 'bottom') { const bias = -xDiff + yDiff; result.push({ x: b.x - bias, y: b.y }) }
    else if (type === 'midInc') { const bias = (-xDiff + yDiff) / 2; result.push({ x: a.x + bias, y: a.y }, { x: b.x - bias, y: b.y }) }
    else { const bias = -yDiff / 2; result.push({ x: a.x + bias, y: a.y + bias }, { x: b.x - bias, y: b.y - bias }) }
  } else if (posRel === 'luu') {
    if (type === 'top') { const bias = xDiff - yDiff; result.push({ x: b.x, y: b.y - bias }) }
    else if (type === 'bottom') { const bias = xDiff - yDiff; result.push({ x: a.x, y: a.y + bias }) }
    else if (type === 'midInc') { const bias = (xDiff - yDiff) / 2; result.push({ x: a.x, y: a.y + bias }, { x: b.x, y: b.y - bias }) }
    else { const bias = -xDiff / 2; result.push({ x: a.x + bias, y: a.y + bias }, { x: b.x - bias, y: b.y - bias }) }
  } else if (posRel === 'uur') {
    if (type === 'top') { const bias = -xDiff - yDiff; result.push({ x: b.x, y: b.y - bias }) }
    else if (type === 'bottom') { const bias = -xDiff - yDiff; result.push({ x: a.x, y: a.y + bias }) }
    else if (type === 'midInc') { const bias = (-xDiff - yDiff) / 2; result.push({ x: a.x, y: a.y + bias }, { x: b.x, y: b.y - bias }) }
    else { const bias = -xDiff / 2; result.push({ x: a.x + bias, y: a.y - bias }, { x: b.x - bias, y: b.y + bias }) }
  } else if (posRel === 'urr') {
    if (type === 'top') { const bias = xDiff + yDiff; result.push({ x: a.x - bias, y: a.y }) }
    else if (type === 'bottom') { const bias = xDiff + yDiff; result.push({ x: b.x + bias, y: b.y }) }
    else if (type === 'midInc') { const bias = (xDiff + yDiff) / 2; result.push({ x: a.x - bias, y: a.y }, { x: b.x + bias, y: b.y }) }
    else { const bias = yDiff / 2; result.push({ x: a.x + bias, y: a.y - bias }, { x: b.x - bias, y: b.y + bias }) }
  }
  if (reversed) result.reverse()
  return result
}

function justifyIllPosedSegments(segs: FormalSeg[]) {
  if (segs.length <= 1) return
  segs.forEach((seg, index) => {
    if (!seg.ill) return
    if (index > 0 && index < segs.length - 1) {
      const previous = segs[index - 1], next = segs[index + 1]
      if (!previous.direct && !next.direct && previous.ill < seg.ill && next.ill < seg.ill) {
        const previousRef = previous.itp.at(-1) ?? previous.a
        const nextRef = next.itp[0] ?? next.b
        const intersection = lineIntersection(previousRef, previous.b, nextRef, next.a)
        if (intersection) seg.itp = [intersection]
      }
      return
    }
    let intersection: Coord | undefined
    if (index === segs.length - 1) {
      const previous = segs[index - 1]
      if (!previous.direct && previous.ill <= seg.ill && previous.ill < 2) {
        const neighbourRef = previous.itp.at(-1) ?? previous.a
        const thisRef = seg.itp.length > 1 ? seg.itp[0] : undefined
        intersection = justifyEnd(neighbourRef, seg.a, thisRef, seg.b)
      }
    } else {
      const next = segs[index + 1]
      if (!next.direct && next.ill <= seg.ill && next.ill < 2) {
        const neighbourRef = next.itp[0] ?? next.b
        const thisRef = seg.itp.length > 1 ? seg.itp[1] : undefined
        intersection = justifyEnd(neighbourRef, seg.b, thisRef, seg.a)
      }
    }
    if (intersection) seg.itp = [intersection]
  })
}

function justifyEnd(neighbourRef: Coord, shared: Coord, thisRef: Coord | undefined, tip: Coord): Coord | undefined {
  const neighbourWay = { x: shared.x - neighbourRef.x, y: shared.y - neighbourRef.y }
  if (magnitude(neighbourWay) < EPS) return undefined
  if (!thisRef) {
    if (pointLineDistance(tip, neighbourRef, shared) < EPS) return undefined
    const perpendicularTip = { x: tip.x - neighbourWay.y, y: tip.y + neighbourWay.x }
    return lineIntersection(neighbourRef, shared, tip, perpendicularTip)
  }
  const thisWay = { x: shared.x - thisRef.x, y: shared.y - thisRef.y }
  if (!isZero(neighbourWay.x * thisWay.x + neighbourWay.y * thisWay.y)) return undefined
  return lineIntersection(neighbourRef, shared, tip, { x: tip.x + thisWay.x, y: tip.y + thisWay.y })
}

function lineIntersection(a: Coord, b: Coord, c: Coord, d: Coord): Coord | undefined {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y }
  const denominator = cross2(r, s)
  if (Math.abs(denominator) < EPS) return undefined
  const t = cross2({ x: c.x - a.x, y: c.y - a.y }, s) / denominator
  return { x: a.x + r.x * t, y: a.y + r.y * t }
}

function pointLineDistance(point: Coord, a: Coord, b: Coord) {
  const way = { x: b.x - a.x, y: b.y - a.y }
  const length = magnitude(way)
  return length < EPS ? magnitude({ x: point.x - a.x, y: point.y - a.y }) : Math.abs(cross2({ x: point.x - a.x, y: point.y - a.y }, way)) / length
}

function coord(point: Coord): Coord { return { x: point.x, y: point.y } }
function isZero(value: number) { return Math.abs(value) < EPS }
function sameCoord(a: Coord, b: Coord) { return isZero(a.x - b.x) && isZero(a.y - b.y) }
function cross2(a: Coord, b: Coord) { return a.x * b.y - a.y * b.x }
function magnitude(value: Coord) { return Math.hypot(value.x, value.y) }
function unit(value: Coord): Coord { const length = magnitude(value) || 1; return { x: value.x / length, y: value.y / length } }
function signWay(value: Coord): Coord { return { x: isZero(value.x) ? 0 : value.x > 0 ? 1 : -1, y: isZero(value.y) ? 0 : value.y > 0 ? 1 : -1 } }
function unit8(value: Coord): Coord { return unit(signWay(value)) }
function fmt(value: number) { const rounded = Math.round(value * 1e6) / 1e6; return Object.is(rounded, -0) ? '0' : String(rounded) }
