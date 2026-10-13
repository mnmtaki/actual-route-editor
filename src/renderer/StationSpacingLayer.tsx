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
 * Labels sit directly over the track and stay a legible screen size.
 * At overview scales, short intervals cannot accommodate a badge and are
 * suppressed until the user zooms in.
 */
export const StationSpacingLayer = memo(function StationSpacingLayer({
  project, worldUnitsPerPixel,
}: { project: ActualRouteProject; worldUnitsPerPixel: number }) {
  const labels = useMemo(() => buildStationSpacingLabels(project), [project])
  const scale = Math.max(0.0001, worldUnitsPerPixel)
  const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = []
  const visible = labels.filter(label => {
    const labelWidth = Math.max(49, label.text.length * 7 + 12)
    const x = label.x / scale, y = label.y / scale
    const rect = { left: x - labelWidth / 2 - 3, right: x + labelWidth / 2 + 3, top: y - 13, bottom: y + 13 }
    if (occupied.some(other => rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top)) return false
    occupied.push(rect)
    return true
  })
  return <g data-layer="station-spacing-labels" data-editor="true" pointerEvents="none" aria-label="区间站距标注">
    {visible.map(label => {
      const width = Math.max(49, label.text.length * 7 + 12)
      return <g key={label.segmentId} data-spacing-segment-id={label.segmentId} transform={`translate(${label.x} ${label.y}) scale(${scale})`}>
        <rect x={-width / 2} y={-11} width={width} height={22} rx={5} fill="#fffdf9" fillOpacity=".96" stroke={label.color} strokeOpacity=".55" strokeWidth="1" />
        <text x="0" y=".5" dominantBaseline="middle" textAnchor="middle" fill={label.color} fontSize="12" fontFamily="system-ui, sans-serif" fontWeight="700">{label.text}</text>
      </g>
    })}
  </g>
})
