import type { ActualRouteProject, Station } from './model';
import { serializeProject } from '../import-export/projectJson';
import type { CloudStationOperation } from './cloudProjectApi';

type Raw = Record<string, unknown>;
type Candidate = Omit<CloudStationOperation, 'expectedRevision' | 'operationId'>;

function stableEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function withoutKeys(source: Raw, keys: readonly string[]): Raw {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
}

/**
 * Only isolated station edits can be safely serialized as a small operation.
 * The moment line topology, label geometry, styles, or another station changes,
 * we retain the old full-document save path instead of sending a partial write.
 */
export function detectStationOperation(baseJson: string, current: ActualRouteProject): Candidate | null {
  let baseline: Raw;
  let edited: Raw;
  try {
    baseline = JSON.parse(baseJson) as Raw;
    edited = JSON.parse(serializeProject(current)) as Raw;
  } catch {
    return null;
  }
  if (!Array.isArray(baseline.stations) || !Array.isArray(edited.stations)) return null;
  if (!stableEqual(withoutKeys(baseline, ['stations']), withoutKeys(edited, ['stations']))) return null;

  const oldStations = baseline.stations as Raw[];
  const newStations = edited.stations as Raw[];
  const oldById = new Map(oldStations.map(station => [station.id, station]));
  const newById = new Map(newStations.map(station => [station.id, station]));
  if (oldById.size !== oldStations.length || newById.size !== newStations.length) return null;
  const changed = newStations.filter(station => !stableEqual(station, oldById.get(station.id)));
  if (changed.length !== 1 || oldStations.some(station => !newById.has(station.id))) return null;
  const now = changed[0];
  if (typeof now.id !== 'string' || !now.id) return null;
  const old = oldById.get(now.id);
  if (!old) {
    if (newStations.length !== oldStations.length + 1
      || typeof now.name !== 'string' || !now.name.trim()
      || !Number.isFinite(now.x) || !Number.isFinite(now.y)) return null;
    // Standalone stations only; avoid partial writes of station references.
    if (Object.keys(withoutKeys(now, [
      'id','name','x','y','labelOffsetX','labelOffsetY',
    ])).length !== 0) return null;
    return { type: 'station.create', station: {
      id: now.id, name: now.name, x: now.x as number, y: now.y as number,
    } };
  }
  if (newStations.length !== oldStations.length) return null;
  const changedFields = Object.keys(now).concat(Object.keys(old))
    .filter((key, index, keys) => keys.indexOf(key) === index && !stableEqual(old[key], now[key]));
  if (!changedFields.length) return null;

  if (changedFields.every(key => ['name', 'nameS', 'nameHistory'].includes(key))
    && typeof now.name === 'string' && now.name.trim()) {
    const station: CloudStationOperation['station'] = { id: now.id, name: now.name };
    if (typeof now.nameS === 'string') station.nameS = now.nameS;
    if (now.nameHistory !== undefined) station.nameHistory = now.nameHistory;
    return { type: 'station.rename', station };
  }
  if (changedFields.every(key => key === 'x' || key === 'y')
    && typeof now.x === 'number' && Number.isFinite(now.x)
    && typeof now.y === 'number' && Number.isFinite(now.y)) {
    return { type: 'station.move', station: {
      id: now.id, x: now.x, y: now.y,
    } };
  }
  return null;
}

export function createStandaloneStation(project: ActualRouteProject, name: string, x: number, y: number, id: string): ActualRouteProject {
  if (!name.trim() || !Number.isFinite(x) || !Number.isFinite(y)) return project;
  if (project.stations.some(station => station.id === id)) return project;
  const station: Station = { id, name: name.trim(), x, y, labelOffsetX: 0, labelOffsetY: 0 };
  return { ...project, stations: [...project.stations, station] };
}
