import { memo, useMemo } from 'react'
import type { ActualRouteProject } from '../data/model'
import { getActiveNetworkAtTime } from '../timeline/active'
import { getSegmentDistanceMeters } from '../data/stationSpacing'
import { sampleSegmentAtLengthRatio } from '../geometry/path'
import { getEffectiveLineColor } from '../data/lineIdentity'
import { isFakeLine } from '../data/fakeLines'

export interface StationSpacingLabel {
  segmentId: string
  x: number
  y: number
  color: string
  text: string
}

/** Derived presentation-only labels. No station distances are written to project JSON. */
export function buildStationSpacingLabels(project: ActualRouteProject): StationSpacingLabel[] {
  const active = getActiveNetworkAtTime(project, project.timeline.currentDate)
  const visibleLineIds = new Set(active.lines.filter(line => !isFakeLine(line)).map(line => line.id))
  const labels: StationSpacingLabel[] = []
  for (const segment of active.segments) {
    if (!visibleLineIds.has(segment.lineId)) continue
    try {
      const sample = sampleSegmentAtLengthRatio(project, segment, 0.5)
      if (!sample) continue
      const meters = getSegmentDistanceMeters(project, segment)
      if (!Number.isFinite(meters) || meters <= 0) continue
      const text = meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`
      labels.push({
        segmentId: segment.id,
        x: sample.point.x, y: sample.point.y,
        color: getEffectiveLineColor(project, segment.lineId, project.timeline.currentDate),
        text,
      })
    } catch {
      // A temporarily incomplete/imported segment should not hide the rest of the labels.
    }
  }
  return labels
}

/**
 * Compact outlined distance annotations sit just above the track.
 * Hide colliding labels at overview zoom levels.
 */
export const StationSpacingLayer = memo(function StationSpacingLayer({
  project, worldUnitsPerPixel,
}: { project: ActualRouteProject; worldUnitsPerPixel: number }) {
  const labels = useMemo(() => buildStationSpacingLabels(project), [project])
  const scale = Math.max(0.0001, worldUnitsPerPixel)
  const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = []
  const visible = labels.filter(label => {
    const labelWidth = Math.max(42, label.text.length * 6.3 + 6)
    const x = label.x / scale, y = label.y / scale
    const rect = { left: x - labelWidth / 2 - 2, right: x + labelWidth / 2 + 2, top: y - 18, bottom: y + 4 }
    if (occupied.some(other => rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top)) return false
    occupied.push(rect)
    return true
  })
  return <g data-layer="station-spacing-labels" data-editor="true" pointerEvents="none" aria-label="区间站距标注">
    {visible.map(label => {
      return <g key={label.segmentId} data-spacing-segment-id={label.segmentId} transform={`translate(${label.x} ${label.y}) scale(${scale})`}>
        <text x="0" y="-9" dominantBaseline="middle" textAnchor="middle" fill={label.color} stroke="#fffdf9" strokeWidth="3" strokeLinejoin="round" paintOrder="stroke" fontSize="11.5" fontFamily="system-ui, sans-serif" fontWeight="600">{label.text}</text>
      </g>
    })}
  </g>
})
