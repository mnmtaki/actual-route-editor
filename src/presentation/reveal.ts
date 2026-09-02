import type { ActualRouteProject } from '../data/model'
import { resolveSegmentLineAt } from '../data/segmentLineHistory'
import { sampleSegmentAtLengthRatio } from '../geometry/path'
import type { PresentationBeat, RevealFront } from './types'
import { clamp } from './config'

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