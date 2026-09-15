import type { BasemapPath } from './model'
import { formalizeAarcBasemapPoints } from './aarcBasemapGeometry'

const EPS = 1e-4
const SQRT2 = Math.SQRT2
const SQRT1_2 = Math.SQRT1_2
const TURN_45_RATIO = 2.4142135 * .618

type Coord = { x: number; y: number }
type Way = { x: -1 | 0 | 1; y: -1 | 0 | 1 }
type WayRel = 'parallel' | '90' | '45' | '135'

type Link = {
  path: BasemapPath
  sourceIndex: number
  way: Way
  dist: number
  widthRatio: number
}

type Transition = { center: Coord; a: Link; b: Link }

export interface AarcTerrainTransitionPath {
  id: string
  d: string
  color: string
  carpetColor: string
  carpetWidth: number
}

/**
 * Port of AARC terrainSmoothCvsWorker: when multiple same-color terrain lines
 * share one source point, fill the wedge between adjacent lines and keep the
 * outer carpet continuous.
 */
export function buildAarcTerrainTransitionPaths(paths: BasemapPath[]): AarcTerrainTransitionPath[] {
  const aarcPaths = paths.filter(path => path.geometry?.kind === 'aarc' && path.source?.format === 'aarc')
  const occurrences = new Map<number, Array<{ path: BasemapPath; sourceIndex: number }>>()
  for (const path of aarcPaths) {
    path.points.forEach((point, sourceIndex) => {
      if (!Number.isFinite(point.aarcPointId)) return
      const list = occurrences.get(point.aarcPointId!) ?? []
      list.push({ path, sourceIndex })
      occurrences.set(point.aarcPointId!, list)
    })
  }

  const result: AarcTerrainTransitionPath[] = []
  for (const [pointId, belongs] of occurrences) {
    if (belongs.length <= 1) continue
    const firstPoint = belongs[0].path.points[belongs[0].sourceIndex]
    const center = { x: firstPoint.x, y: firstPoint.y }
    const links: Link[] = []

    for (const belong of belongs) {
      for (const adjacent of adjacentFormalPoints(belong.path, belong.sourceIndex)) {
        const way = signWay({ x: adjacent.x - center.x, y: adjacent.y - center.y })
        if (way.x === 0 && way.y === 0) continue
        links.push({
          path: belong.path,
          sourceIndex: belong.sourceIndex,
          way,
          dist: Math.hypot(adjacent.x - center.x, adjacent.y - center.y),
          widthRatio: belong.path.isFilled ? 0 : sourceWidthRatio(belong.path),
        })
      }
    }
    if (links.length < 2) continue
    links.sort((a, b) => clockwiseIndex(a.way) - clockwiseIndex(b.way))

    const onlyColor = links[0].path.color
    if (!onlyColor || links.some(link => link.path.color !== onlyColor)) continue

    const transitions: Transition[] = []
    let linkA = links.at(-1)!
    for (const linkB of links) {
      if (linkB.path.id === linkA.path.id) {
        linkA = linkB
        continue
      }
      transitions.push({ center, a: linkA, b: linkB })
      linkA = linkB
    }
    if (!transitions.length) continue

    const geometry = belongs[0].path.geometry!
    const curves: Array<{ center: Coord; mid: Coord; aWay: Way; bWay: Way; rel: WayRel }> = []
    const smallest: Record<WayRel, number> = { '45': 1e10, '90': 1e10, '135': 1e10, parallel: 0 }

    for (const transition of transitions) {
      const rel = wayRel(transition.a.way, transition.b.way, true)
      if (rel === 'parallel') continue
      const aWidth = transition.a.widthRatio * geometry.lineWidthBase
      const bWidth = transition.b.widthRatio * geometry.lineWidthBase
      const widthDiff = Math.abs(aWidth - bWidth)
      let aBack = bWidth / 2
      let bBack = aWidth / 2
      if (rel === '45' || rel === '135') {
        aBack = aBack * SQRT2 - .5
        bBack = bBack * SQRT2 - .5
      }
      const restriction = Math.min(transition.a.dist / 2, transition.b.dist / 2)
      const left = restriction - Math.max(aBack, bBack)
      if (left <= widthDiff / 3) continue
      const additionalBack = Math.min(left, transitionRadius(geometry.lineTurnAreaRadius, rel))
      const mid = applyBias(applyBias(center, transition.a.way, aBack), transition.b.way, bBack)
      curves.push({ center, mid, aWay: transition.a.way, bWay: transition.b.way, rel })
      if (additionalBack < smallest[rel]) smallest[rel] = additionalBack
    }
    if (!curves.length) continue

    const commands: string[] = []
    curves.forEach((curve, index) => {
      const a = applyBias(curve.mid, curve.aWay, smallest[curve.rel])
      const b = applyBias(curve.mid, curve.bWay, smallest[curve.rel])
      if (index === 0) commands.push(`M ${fmt(curve.center.x)} ${fmt(curve.center.y)}`)
      commands.push(`L ${fmt(a.x)} ${fmt(a.y)}`)
      appendFormalArc(commands, a, curve.mid, b)
    })
    commands.push('Z')
    result.push({
      id: `aarc-terrain-transition-${pointId}`,
      d: commands.join(' '),
      color: onlyColor,
      carpetColor: geometry.backgroundColor,
      carpetWidth: geometry.lineCarpetWiden,
    })
  }
  return result
}

function adjacentFormalPoints(path: BasemapPath, sourceIndex: number): Coord[] {
  const formal = formalizeAarcBasemapPoints(path.points)
  const index = formal.findIndex(point => point.afterIdxEqv === sourceIndex)
  if (index < 0) return []
  const result: Coord[] = []
  if (index > 0) result.push(formal[index - 1])
  if (index < formal.length - 1) result.push(formal[index + 1])
  return result
}

function sourceWidthRatio(path: BasemapPath) {
  if (typeof path.source?.sourceWidthRatio === 'number' && path.source.sourceWidthRatio > 0) return path.source.sourceWidthRatio
  const base = path.geometry?.kind === 'aarc' ? path.geometry.lineWidthBase : 14
  return base > 0 ? path.width / base : 1
}

function transitionRadius(base: number, rel: WayRel) {
  if (rel === '45') return base / TURN_45_RATIO
  if (rel === '135') return base * TURN_45_RATIO
  return base
}

function wayRel(a: Way, b: Way, inverted = false): WayRel {
  if (Math.abs(cross(a, b)) < EPS) return 'parallel'
  const dot = a.x * b.x + a.y * b.y
  if (Math.abs(dot) < EPS) return '90'
  let close = dot > 0
  if (inverted) close = !close
  return close ? '45' : '135'
}

function applyBias(point: Coord, way: Way, distance: number): Coord {
  const scaled = way.x !== 0 && way.y !== 0 ? distance * SQRT1_2 : distance
  return { x: point.x + way.x * scaled, y: point.y + way.y * scaled }
}

function appendFormalArc(commands: string[], before: Coord, via: Coord, after: Coord) {
  const a = signWay({ x: via.x - before.x, y: via.y - before.y })
  const b = signWay({ x: after.x - via.x, y: after.y - via.y })
  const aUnit = unit(a), bUnit = unit(b)
  const turn = cross(aUnit, bUnit)
  if (Math.abs(turn) < EPS) {
    commands.push(`L ${fmt(after.x)} ${fmt(after.y)}`)
    return
  }
  const normalA = { x: -aUnit.y, y: aUnit.x }
  const normalB = { x: -bUnit.y, y: bUnit.x }
  const denominator = cross(normalA, normalB)
  if (Math.abs(denominator) < EPS) {
    commands.push(`L ${fmt(after.x)} ${fmt(after.y)}`)
    return
  }
  const delta = { x: after.x - before.x, y: after.y - before.y }
  const t = cross(delta, normalB) / denominator
  const center = { x: before.x + normalA.x * t, y: before.y + normalA.y * t }
  const radius = Math.hypot(before.x - center.x, before.y - center.y)
  if (!Number.isFinite(radius) || radius < EPS) {
    commands.push(`L ${fmt(after.x)} ${fmt(after.y)}`)
    return
  }
  commands.push(`A ${fmt(radius)} ${fmt(radius)} 0 0 ${turn < 0 ? 0 : 1} ${fmt(after.x)} ${fmt(after.y)}`)
}

function clockwiseIndex(way: Way) {
  if (way.x === 0) return way.y === 1 ? 4 : 0
  if (way.x === 1) return way.y === -1 ? 1 : way.y === 0 ? 2 : 3
  return way.y === 1 ? 5 : way.y === 0 ? 6 : 7
}

function signWay(value: Coord): Way {
  return { x: sign(value.x), y: sign(value.y) }
}

function sign(value: number): -1 | 0 | 1 {
  if (Math.abs(value) < EPS) return 0
  return value > 0 ? 1 : -1
}

function unit(value: Coord): Coord {
  const length = Math.hypot(value.x, value.y) || 1
  return { x: value.x / length, y: value.y / length }
}

function cross(a: Coord, b: Coord) { return a.x * b.y - a.y * b.x }
function fmt(value: number) { const rounded = Math.round(value * 1e6) / 1e6; return Object.is(rounded, -0) ? '0' : String(rounded) }
