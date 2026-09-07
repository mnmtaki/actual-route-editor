import type { ActualRouteProject } from '../data/model'
import { resolveSegmentLineAt } from '../data/segmentLineHistory'
import { sampleSegmentAtLengthRatio } from '../geometry/path'
import type { PresentationBeat, RevealFront } from './types'
import { clamp, easing } from './config'

/** Presentation-only timing policy for a genuinely new construction origin. */
export const ORIGIN_REVEAL_DURATION = 0.3
export const ORIGIN_HOLD_DURATION = 0.1
export const ORIGIN_LABEL_DELAY = 0.08
export const ORIGIN_SCALE_FROM = 0.75

export interface OpeningAnimationState {
  originRevealProgress: number
  originOpacity: number
  originScale: number
  originLabelOpacity: number
  lineRevealProgress: number
}

/**
 * Deterministically evaluates the opening prelude and the existing line reveal.
 * It has no frame-to-frame state and is shared by Preview, scrub and export.
 */
export function getOpeningAnimationState(beat: PresentationBeat, time: number): OpeningAnimationState {
  const hasPrelude = Boolean(beat.needsOriginReveal && beat.originRevealDuration > 0)
  const originDuration = hasPrelude ? beat.originRevealDuration : 0
  const originProgress = hasPrelude ? clamp((time - beat.originRevealStart) / originDuration) : 1
  const easedOrigin = hasPrelude ? easing.station(originProgress) : 1
  const labelProgress = hasPrelude
    ? easing.station(clamp((time - beat.originRevealStart - ORIGIN_LABEL_DELAY) / Math.max(.000001, originDuration - ORIGIN_LABEL_DELAY)))
    : 1
  const lineRevealProgress = clamp((time - beat.revealStart) / Math.max(.000001, beat.revealDuration))
  return {
    originRevealProgress: originProgress,
    originOpacity: hasPrelude ? easedOrigin : 1,
    originScale: hasPrelude ? ORIGIN_SCALE_FROM + (1 - ORIGIN_SCALE_FROM) * easedOrigin : 1,
    originLabelOpacity: hasPrelude ? labelProgress : 1,
    lineRevealProgress,
  }
}

export function getBeatSegmentRevealProgress(beat: PresentationBeat, segmentId: string, globalRevealProgress: number) {
  for (let branchIndex = 0; branchIndex < beat.branches.length; branchIndex += 1) {
    const branch = beat.branches[branchIndex], directed = branch.find(item => item.segmentId === segmentId)
    if (!directed) continue
    const branchLength = beat.branchLengths[branchIndex] || beat.totalPathLength || 1
    const branchProgress = clamp(globalRevealProgress * beat.totalPathLength / branchLength)
    return clamp((branchProgress - directed.startRatio) / Math.max(.000001, directed.endRatio - directed.startRatio))
  }
  return clamp(globalRevealProgress)
}
export function getBeatRevealedDistance(beat: PresentationBeat, globalRevealProgress: number) {
  const distance = clamp(globalRevealProgress) * beat.totalPathLength
  return beat.branchLengths.reduce((sum, branchLength) => sum + Math.min(distance, branchLength), 0)
}
export function getStationArrivalRatio(beat: PresentationBeat, stationId: string) {
  const values: number[] = []
  beat.branches.forEach((branch, branchIndex) => {
    const branchLength = beat.branchLengths[branchIndex] || beat.totalPathLength || 1
    for (const item of branch) {
      if (item.fromStationId === stationId) values.push(item.startRatio * branchLength / Math.max(.000001, beat.totalPathLength))
      if (item.toStationId === stationId) values.push(item.endRatio * branchLength / Math.max(.000001, beat.totalPathLength))
    }
  })
  return values.length ? Math.min(...values) : 0
}
export function getBeatRevealFronts(project: ActualRouteProject, beat: PresentationBeat | null, globalRevealProgress: number): RevealFront[] {
  if (!beat || !beat.eventTypes.includes('SEGMENT_OPENING')) return []
  const global = clamp(globalRevealProgress)
  const historicalProject = beat ? { ...project, geometry: { ...project.geometry, segments: project.geometry.segments.map(segment => ({ ...segment, lineId: resolveSegmentLineAt(segment, beat.historyDate) })) } } : project
  return beat.branches.map((branch, branchIndex) => {
    const branchLength = beat.branchLengths[branchIndex] || beat.totalPathLength || 1
    const progress = clamp(global * beat.totalPathLength / branchLength)
    const directed = branch.find(item => progress <= item.endRatio + 1e-9) ?? branch.at(-1)
    if (!directed) return null
    const local = clamp((progress - directed.startRatio) / Math.max(.000001, directed.endRatio - directed.startRatio))
    const segment = historicalProject.geometry.segments.find(item => item.id === directed.segmentId)
    if (!segment) return null
    const forward = segment.fromStationId === directed.fromStationId
    const sample = sampleSegmentAtLengthRatio(historicalProject, segment, forward ? local : 1 - local)
    if (!sample) return null
    return { lineId: beat.lineId, segmentId: segment.id, worldX: sample.point.x, worldY: sample.point.y, tangentX: forward ? sample.tangent.x : -sample.tangent.x, tangentY: forward ? sample.tangent.y : -sample.tangent.y, progress: global, branchIndex }
  }).filter((front): front is RevealFront => Boolean(front))
}
