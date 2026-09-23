export interface AlignmentPoint { x: number; y: number }
export interface AlignmentCandidate extends AlignmentPoint {
  id: string
  kind: 'station' | 'waypoint' | 'draft'
}

export interface AlignmentGuide {
  axis: 'x' | 'y'
  value: number
  targetId: string
  targetKind: AlignmentCandidate['kind']
}

export interface AlignmentSnapResult {
  point: AlignmentPoint
  guides: AlignmentGuide[]
}

const KIND_PRIORITY: Record<AlignmentCandidate['kind'], number> = {
  station: 0,
  waypoint: 1,
  draft: 2,
}

export function snapPointToAlignment(raw: AlignmentPoint, candidates: AlignmentCandidate[], threshold: { x: number; y: number }): AlignmentSnapResult {
  const xTarget = nearestAxis(raw.x, candidates, 'x', threshold.x)
  const yTarget = nearestAxis(raw.y, candidates, 'y', threshold.y)
  const guides: AlignmentGuide[] = []
  if (xTarget) guides.push({ axis: 'x', value: xTarget.x, targetId: xTarget.id, targetKind: xTarget.kind })
  if (yTarget) guides.push({ axis: 'y', value: yTarget.y, targetId: yTarget.id, targetKind: yTarget.kind })
  return {
    point: {
      x: xTarget?.x ?? raw.x,
      y: yTarget?.y ?? raw.y,
    },
    guides,
  }
}

function nearestAxis(rawValue: number, candidates: AlignmentCandidate[], axis: 'x' | 'y', threshold: number): AlignmentCandidate | null {
  let best: AlignmentCandidate | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const distance = Math.abs(candidate[axis] - rawValue)
    if (distance > threshold) continue
    if (!best || distance < bestDistance - 1e-9 || (Math.abs(distance - bestDistance) <= 1e-9 && compareCandidate(candidate, best) < 0)) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

function compareCandidate(a: AlignmentCandidate, b: AlignmentCandidate) {
  const kind = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]
  return kind || a.id.localeCompare(b.id)
}
