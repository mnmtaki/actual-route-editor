import type { ActualRouteProject } from './model';
import { serializeProject } from '../import-export/projectJson';

type Raw = Record<string, unknown>;
export interface WaypointMoveCandidate {
  segmentId: string;
  waypointId: string;
  x: number;
  y: number;
}

function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function omit(source: Raw, key: string): Raw {
  return Object.fromEntries(Object.entries(source).filter(([k]) => k !== key));
}

/**
 * Recognize exactly one waypoint-coordinate mutation; reject any other
 * station, segment topology, line, style, time or metadata change.
 */
export function detectWaypointMove(baseJson: string, project: ActualRouteProject): WaypointMoveCandidate | null {
  let before: Raw, after: Raw;
  try {
    before=JSON.parse(baseJson) as Raw;
    after=JSON.parse(serializeProject(project)) as Raw;
  } catch { return null; }
  if (!equal(omit(before,'geometry'), omit(after,'geometry'))) return null;
  const oldGeometry=before.geometry as Raw | undefined;
  const newGeometry=after.geometry as Raw | undefined;
  if (!oldGeometry || !newGeometry ||
      !Array.isArray(oldGeometry.segments) || !Array.isArray(newGeometry.segments)) return null;
  if (!equal(omit(oldGeometry,'segments'),omit(newGeometry,'segments'))) return null;
  const originals=oldGeometry.segments as Raw[];
  const updated=newGeometry.segments as Raw[];
  if (originals.length !== updated.length) return null;
  let candidate: WaypointMoveCandidate | null = null;
  for (let i=0;i<originals.length;i++) {
    const orig=originals[i], next=updated[i];
    if (equal(orig,next)) continue;
    if (typeof orig.id !== 'string' || orig.id !== next.id ||
        !equal(omit(orig,'waypoints'),omit(next,'waypoints'))) return null;
    if (!Array.isArray(orig.waypoints) || !Array.isArray(next.waypoints) ||
        orig.waypoints.length !== next.waypoints.length) return null;
    for (let j=0;j<orig.waypoints.length;j++) {
      const oldPoint=orig.waypoints[j] as Raw;
      const newPoint=next.waypoints[j] as Raw;
      if (equal(oldPoint,newPoint)) continue;
      if (candidate || typeof oldPoint.id !== 'string' ||
          oldPoint.id !== newPoint.id || !equal(omit(omit(oldPoint,'x'),'y'),omit(omit(newPoint,'x'),'y')) ||
          typeof newPoint.x !== 'number' || typeof newPoint.y !== 'number' ||
          !Number.isFinite(newPoint.x) || !Number.isFinite(newPoint.y)) return null;
      candidate={segmentId:orig.id, waypointId:oldPoint.id,
        x:newPoint.x, y:newPoint.y};
    }
  }
  return candidate;
}
