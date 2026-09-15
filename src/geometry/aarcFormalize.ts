export interface AarcFormalizeControlPoint {
  id: string | number
  x: number
  y: number
  dir: 0 | 1
  free?: boolean
}

export interface AarcFormalPoint {
  x: number
  y: number
  afterIdxEqv: number
  /** AR-only provenance metadata; does not affect AARC formalize geometry. */
  sourcePointIndex?: number
  free?: boolean
}

interface Coord { x: number; y: number }
interface FormalSeg {
  a: Coord
  itp: Coord[]
  b: Coord
  ill: number
  direct?: boolean
  aFree?: boolean
  bFree?: boolean
}
interface FormalRay {
  source: Coord
  way: { x: -1 | 0 | 1; y: -1 | 0 | 1 }
}
type PosRel = 's' | 'l' | 'llu' | 'lu' | 'luu' | 'u' | 'uur' | 'ur' | 'urr'
type FillType = 'top' | 'bottom' | 'midVert' | 'midInc'

const EPS = 1e-4
const SQRT2 = Math.SQRT2
const SQRT2_HALF = Math.SQRT1_2

/**
 * Geometry-equivalent port of AARC utils/lineUtils/formalize.ts.
 * Keep this function as the single source of truth for BOTH imported transit
 * lines and imported terrain. Station semantics must not participate here.
 */
export function formalizeAarcControlPoints(points: AarcFormalizeControlPoint[], idxOffset = 0): AarcFormalPoint[] {
  if (points.length < 2) return []

  const ring = isRing(points)
  const formalSegs: FormalSeg[] = []
  if (!ring) {
    for (let i = 0; i < points.length - 1; i += 1) formalSegs.push(formalizeSeg(points[i], points[i + 1]))
  } else {
    formalSegs.push(formalizeSeg(points[points.length - 2], points[0]))
    for (let i = 0; i < points.length - 1; i += 1) formalSegs.push(formalizeSeg(points[i], points[i + 1]))
    formalSegs.push(formalizeSeg(points.at(-1)!, points[1]))
  }

  illPosedSegJustify(formalSegs)
  if (!formalSegs.length) return []
  if (ring) {
    formalSegs.shift()
    formalSegs.pop()
  }

  const formalPts: AarcFormalPoint[] = []
  formalPts.push({
    x: formalSegs[0].a.x,
    y: formalSegs[0].a.y,
    afterIdxEqv: idxOffset,
    sourcePointIndex: 0,
    ...(formalSegs[0].aFree ? { free: true } : {}),
  })
  for (let i = 0; i < formalSegs.length; i += 1) {
    const seg = formalSegs[i]
    seg.itp.forEach(point => formalPts.push({ x: point.x, y: point.y, afterIdxEqv: i + idxOffset }))
    formalPts.push({
      x: seg.b.x,
      y: seg.b.y,
      afterIdxEqv: i + 1 + idxOffset,
      sourcePointIndex: i + 1,
      ...(seg.bFree ? { free: true } : {}),
    })
  }
  return formalPts
}

function formalizeSeg(originalA: AarcFormalizeControlPoint, originalB: AarcFormalizeControlPoint): FormalSeg {
  if (originalA.free || originalB.free) {
    return { a: coord(originalA), itp: [], b: coord(originalB), ill: 0, direct: true, aFree: originalA.free, bFree: originalB.free }
  }
  let a = originalA
  let b = originalB
  let xDiff = a.x - b.x
  let yDiff = a.y - b.y
  const rel = coordRelDiff(xDiff, yDiff)
  const pr = rel.posRel
  const reversed = rel.rev
  if (pr === 's') return { a: coord(originalA), itp: [], b: coord(originalB), ill: 0, aFree: originalA.free, bFree: originalB.free }
  if (reversed) {
    ;[a, b] = [b, a]
    xDiff = -xDiff
    yDiff = -yDiff
  }

  let itp: Coord[]
  let ill = 0
  if (a.dir === b.dir) {
    itp = coordFill(a, b, xDiff, yDiff, pr, reversed, a.dir === 1 ? 'midVert' : 'midInc')
    if (!itp.length) {
      if ((a.dir === 0 && (pr === 'lu' || pr === 'ur')) || (a.dir === 1 && (pr === 'l' || pr === 'u'))) ill = 2
      else ill = 0
    } else {
      ill = 1
    }
  } else if (a.dir === 1) {
    itp = coordFill(a, b, xDiff, yDiff, pr, reversed, pr === 'luu' || pr === 'uur' ? 'top' : 'bottom')
  } else {
    itp = coordFill(a, b, xDiff, yDiff, pr, reversed, pr === 'luu' || pr === 'uur' ? 'bottom' : 'top')
  }
  return { a: coord(originalA), b: coord(originalB), itp, ill, aFree: originalA.free, bFree: originalB.free }
}

function illPosedSegJustify(segs: FormalSeg[]) {
  if (segs.length <= 1) return
  const illIndices = segs.map((seg, index) => seg.ill ? index : -1).filter(index => index >= 0)
  illIndices.forEach(index => {
    const thisSeg = segs[index]
    if (index > 0 && index < segs.length - 1) {
      const previous = segs[index - 1]
      const next = segs[index + 1]
      const previousHelps = !previous.direct && previous.ill < thisSeg.ill
      const nextHelps = !next.direct && next.ill < thisSeg.ill
      if (previousHelps && nextHelps) {
        const previousRef = previous.itp.length ? previous.itp.at(-1)! : previous.a
        const previousRay = twinPts2Ray(previousRef, previous.b)
        const nextRef = next.itp.length ? next.itp[0] : next.b
        const nextRay = twinPts2Ray(nextRef, next.a)
        const intersection = rayIntersect(previousRay, nextRay, true)
        if (intersection) thisSeg.itp = [intersection]
      }
      return
    }

    const justifyEnd = (neighbourRef: Coord, shared: Coord, thisRef: Coord | null, tip: Coord) => {
      const neighbourRay = twinPts2Ray(neighbourRef, shared)
      let thisRay: FormalRay
      if (!thisRef) {
        if (rayToCoordDist(neighbourRay, tip) < EPS) return undefined
        thisRay = { source: tip, way: { ...neighbourRay.way } }
        rayRotate90(thisRay)
        return rayIntersect(neighbourRay, thisRay, true)
      }
      thisRay = twinPts2Ray(thisRef, shared)
      thisRay.source = tip
      if (rayPerpendicular(neighbourRay, thisRay)) return rayIntersect(neighbourRay, thisRay, true)
      return undefined
    }

    let intersection: Coord | undefined
    if (index === segs.length - 1) {
      const previous = segs[index - 1]
      const canHelp = !previous.direct && previous.ill <= thisSeg.ill && previous.ill < 2
      const needHelp = thisSeg.ill > 0
      if (needHelp && canHelp) {
        const neighbourRef = previous.itp.length ? previous.itp.at(-1)! : previous.a
        const shared = thisSeg.a
        const thisRef = thisSeg.itp.length > 1 ? thisSeg.itp[0] : null
        const tip = thisSeg.b
        intersection = justifyEnd(neighbourRef, shared, thisRef, tip)
      }
    } else if (index === 0) {
      const next = segs[index + 1]
      const canHelp = !next.direct && next.ill <= thisSeg.ill && next.ill < 2
      const needHelp = thisSeg.ill > 0
      if (canHelp && needHelp) {
        const neighbourRef = next.itp.length ? next.itp[0] : next.b
        const shared = thisSeg.b
        const thisRef = thisSeg.itp.length > 1 ? thisSeg.itp[1] : null
        const tip = thisSeg.a
        intersection = justifyEnd(neighbourRef, shared, thisRef, tip)
      }
    }
    if (intersection) thisSeg.itp = [intersection]
  })
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

function coordFill(a: Coord, b: Coord, xDiff: number, yDiff: number, posRel: PosRel, reversed: boolean, type: FillType): Coord[] {
  let result: Coord[] = []
  if (posRel === 'l' || posRel === 'u' || posRel === 'lu' || posRel === 'ur') return result
  if (posRel === 'llu') {
    if (type === 'top') { const bias = -xDiff + yDiff; result = [{ x: a.x + bias, y: a.y }] }
    else if (type === 'bottom') { const bias = -xDiff + yDiff; result = [{ x: b.x - bias, y: b.y }] }
    else if (type === 'midInc') { const bias = (-xDiff + yDiff) / 2; result = [{ x: a.x + bias, y: a.y }, { x: b.x - bias, y: b.y }] }
    else { const bias = -yDiff / 2; result = [{ x: a.x + bias, y: a.y + bias }, { x: b.x - bias, y: b.y - bias }] }
  } else if (posRel === 'luu') {
    if (type === 'top') { const bias = xDiff - yDiff; result = [{ x: b.x, y: b.y - bias }] }
    else if (type === 'bottom') { const bias = xDiff - yDiff; result = [{ x: a.x, y: a.y + bias }] }
    else if (type === 'midInc') { const bias = (xDiff - yDiff) / 2; result = [{ x: a.x, y: a.y + bias }, { x: b.x, y: b.y - bias }] }
    else { const bias = -xDiff / 2; result = [{ x: a.x + bias, y: a.y + bias }, { x: b.x - bias, y: b.y - bias }] }
  } else if (posRel === 'uur') {
    if (type === 'top') { const bias = -xDiff - yDiff; result = [{ x: b.x, y: b.y - bias }] }
    else if (type === 'bottom') { const bias = -xDiff - yDiff; result = [{ x: a.x, y: a.y + bias }] }
    else if (type === 'midInc') { const bias = (-xDiff - yDiff) / 2; result = [{ x: a.x, y: a.y + bias }, { x: b.x, y: b.y - bias }] }
    else { const bias = -xDiff / 2; result = [{ x: a.x + bias, y: a.y - bias }, { x: b.x - bias, y: b.y + bias }] }
  } else if (posRel === 'urr') {
    if (type === 'top') { const bias = xDiff + yDiff; result = [{ x: a.x - bias, y: a.y }] }
    else if (type === 'bottom') { const bias = xDiff + yDiff; result = [{ x: b.x + bias, y: b.y }] }
    else if (type === 'midInc') { const bias = (xDiff + yDiff) / 2; result = [{ x: a.x - bias, y: a.y }, { x: b.x + bias, y: b.y }] }
    else { const bias = yDiff / 2; result = [{ x: a.x + bias, y: a.y - bias }, { x: b.x - bias, y: b.y + bias }] }
  }
  if (reversed) result.reverse()
  return result
}

function twinPts2Ray(from: Coord, to: Coord): FormalRay {
  return { source: { ...from }, way: { x: sgn(to.x - from.x), y: sgn(to.y - from.y) } }
}

function rayIntersect(a: FormalRay, b: FormalRay, perpendicularOnly = false): Coord | undefined {
  if (rayParallel(a, b)) return undefined
  if (perpendicularOnly && !rayPerpendicular(a, b)) return undefined
  let ax = a.way.x
  let ay = a.way.y
  const bx = b.way.x
  const by = b.way.y
  const distance = rayToCoordDist(b, a.source)
  const aIncline = ax * ay !== 0
  const bIncline = bx * by !== 0
  if (aIncline) {
    ax *= SQRT2_HALF
    ay *= SQRT2_HALF
  }
  let ratio = 1
  if (aIncline !== bIncline) ratio = SQRT2
  const result = { x: a.source.x + ax * distance * ratio, y: a.source.y + ay * distance * ratio }
  const xOffset = ax * distance * ratio
  const yOffset = ay * distance * ratio
  if (!isZero(rayToCoordDist(b, result))) {
    result.x -= 2 * xOffset
    result.y -= 2 * yOffset
  }
  return result
}

function rayToCoordDist(ray: FormalRay, point: Coord) {
  const xDiff = ray.source.x - point.x
  const yDiff = ray.source.y - point.y
  if (ray.way.x === 0) return Math.abs(xDiff)
  if (ray.way.y === 0) return Math.abs(yDiff)
  if (ray.way.x * ray.way.y > 0) return Math.abs(yDiff - xDiff) * SQRT2_HALF
  return Math.abs(yDiff + xDiff) * SQRT2_HALF
}

function rayParallel(a: FormalRay, b: FormalRay) { return isZero(a.way.x * b.way.y - a.way.y * b.way.x) }
function rayPerpendicular(a: FormalRay, b: FormalRay) { return isZero(a.way.x * b.way.x + a.way.y * b.way.y) }
function rayRotate90(ray: FormalRay) {
  const x = ray.way.x
  const y = ray.way.y
  ray.way.x = -y as -1 | 0 | 1
  ray.way.y = x as -1 | 0 | 1
}
function isRing(points: AarcFormalizeControlPoint[]) { return points.length > 2 && points[0].id === points.at(-1)!.id }
function coord(point: { x: number; y: number }): Coord { return { x: point.x, y: point.y } }
function isZero(value: number) { return Math.abs(value) < EPS }
function sgn(value: number): -1 | 0 | 1 { return isZero(value) ? 0 : value > 0 ? 1 : -1 }
