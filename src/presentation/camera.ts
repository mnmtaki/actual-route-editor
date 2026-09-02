import type { ActualRouteProject } from '../data/model'
import { resolveSegmentLineAt } from '../data/segmentLineHistory'
import { getSegmentPoints } from '../geometry/path'
import { PRESENTATION_ANIMATION, clamp, easing } from './config'
import { getBeatRevealFronts } from './reveal'
import type { CameraTrack, CameraTrackSample, CameraView, PresentationBeat } from './types'

const TRACK_SAMPLES = 181

export function createConstructionCamera(centerX: number, centerY: number, aspect: number, cameraViewWidth: number): CameraView {
  const width = Math.max(100, cameraViewWidth)
  const height = width / aspect
  return { x: centerX - width / 2, y: centerY - height / 2, width, height }
}

export function compileCameraTrack(project: ActualRouteProject, beat: PresentationBeat, aspect: number, startCamera: CameraView, cameraViewWidth: number): CameraTrack {
  const raw = Array.from({ length: TRACK_SAMPLES }, (_, index) => {
    const progress = index / (TRACK_SAMPLES - 1)
    const fronts = getBeatRevealFronts(project, beat, progress)
    const front = fronts.find(item => item.branchIndex === beat.primaryBranchIndex) ?? fronts[0]
    return { progress, centerX: front?.worldX ?? centerX(startCamera), centerY: front?.worldY ?? centerY(startCamera) }
  })
  const samples = beat.eventTypes.includes('SEGMENT_OPENING') ? smoothSpatialTrack(raw) : [raw[0]]
  const first = samples[0]
  const constructionCamera = createConstructionCamera(first.centerX, first.centerY, aspect, cameraViewWidth)
  const last = samples.at(-1) ?? first
  const endCamera = { ...constructionCamera, x: last.centerX - constructionCamera.width / 2, y: last.centerY - constructionCamera.height / 2 }
  const overviewCamera = beat.overviewAfter ? fitHistoricalNetwork(project, beat.historyDate, aspect, constructionCamera) : undefined
  return { beatId: beat.beatId, primaryBranchIndex: beat.primaryBranchIndex, transitionDuration: beat.cameraTransitionDuration, startCamera, constructionCamera, endCamera, overviewCamera, samples }
}

export function evaluateCameraTrack(track: CameraTrack, beat: PresentationBeat, time: number): CameraView {
  if (time < beat.revealStart && beat.cameraTransitionDuration > 0) {
    const progress = easing.camera(clamp((time - beat.presentationStart) / beat.cameraTransitionDuration))
    return interpolateView(track.startCamera, track.constructionCamera, progress)
  }
  if (!track.samples.length) return track.constructionCamera
  const progress = beat.revealDuration > 0 ? clamp((time - beat.revealStart) / beat.revealDuration) : 1
  const sample = sampleTrack(track.samples, progress)
  const construction = { x: sample.centerX - track.constructionCamera.width / 2, y: sample.centerY - track.constructionCamera.height / 2, width: track.constructionCamera.width, height: track.constructionCamera.height }
  if (track.overviewCamera && time >= beat.overviewStart) {
    const enterEnd = beat.overviewStart + beat.overviewEnterDuration
    const holdEnd = enterEnd + beat.overviewHoldDuration
    if (time < enterEnd) return interpolateView(track.endCamera, track.overviewCamera, easing.camera(clamp((time - beat.overviewStart) / Math.max(.001, beat.overviewEnterDuration))))
    if (time < holdEnd) return track.overviewCamera
    if (time < beat.overviewEnd) return interpolateView(track.overviewCamera, track.endCamera, easing.camera(clamp((time - holdEnd) / Math.max(.001, beat.overviewExitDuration))))
    return track.endCamera
  }
  return construction
}

function fitHistoricalNetwork(project: ActualRouteProject, date: string, aspect: number, fallback: CameraView): CameraView {
  const historicalProject = { ...project, geometry: { ...project.geometry, segments: project.geometry.segments.map(segment => ({ ...segment, lineId: resolveSegmentLineAt(segment, date) })) } }
  const points = historicalProject.geometry.segments
    .filter(segment => (!segment.openedAt || segment.openedAt <= date) && (!segment.closedAt || date < segment.closedAt))
    .flatMap(segment => getSegmentPoints(historicalProject, segment))
  if (!points.length) return fallback
  const xs = points.map(point => point.x), ys = points.map(point => point.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const padding = 70, rawWidth = Math.max(180, maxX - minX + padding * 2), rawHeight = Math.max(140, maxY - minY + padding * 2)
  const width = Math.max(rawWidth, rawHeight * aspect), height = width / aspect
  return { x: (minX + maxX) / 2 - width / 2, y: (minY + maxY) / 2 - height / 2, width, height }
}

function smoothSpatialTrack(raw: CameraTrackSample[]): CameraTrackSample[] {
  const weights = [1, 2, 3, 2, 1], radius = 2, sum = weights.reduce((a, b) => a + b, 0)
  return raw.map((sample, index) => {
    if (index === 0 || index === raw.length - 1) return sample
    let x = 0, y = 0
    for (let offset = -radius; offset <= radius; offset += 1) {
      const item = raw[Math.max(0, Math.min(raw.length - 1, index + offset))]
      const weight = weights[offset + radius]
      x += item.centerX * weight; y += item.centerY * weight
    }
    return { progress: sample.progress, centerX: x / sum, centerY: y / sum }
  })
}
function sampleTrack(samples: CameraTrackSample[], progress: number) {
  if (samples.length === 1) return samples[0]
  const scaled = clamp(progress) * (samples.length - 1), index = Math.min(samples.length - 2, Math.floor(scaled)), local = scaled - index
  const a = samples[index], b = samples[index + 1]
  return { progress, centerX: a.centerX + (b.centerX - a.centerX) * local, centerY: a.centerY + (b.centerY - a.centerY) * local }
}
function interpolateView(a: CameraView, b: CameraView, progress: number): CameraView { return { x: lerp(a.x, b.x, progress), y: lerp(a.y, b.y, progress), width: lerp(a.width, b.width, progress), height: lerp(a.height, b.height, progress) } }
const centerX = (view: CameraView) => view.x + view.width / 2
const centerY = (view: CameraView) => view.y + view.height / 2
const lerp = (a: number, b: number, progress: number) => a + (b - a) * progress
