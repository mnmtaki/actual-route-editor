import type { ActualRouteProject } from './model';

/** Non-destructive, client-only comparison. Does not attempt an unsafe merge. */
export interface CloudChangeSummary {
  stations: number;
  lines: number;
  segments: number;
  relations: number;
  otherChanged: boolean;
  stationDetails: string[];
}

type RecordItem = { id: string; name?: string };
function changedRecords(a: readonly RecordItem[], b: readonly RecordItem[]): { count: number; ids: string[] } {
  const oldMap = new Map(a.map(value => [value.id, value]));
  const newMap = new Map(b.map(value => [value.id, value]));
  const keys = new Set([...oldMap.keys(), ...newMap.keys()]);
  const changed: string[] = [];
  for (const id of keys) {
    if (JSON.stringify(oldMap.get(id)) !== JSON.stringify(newMap.get(id))) changed.push(id);
  }
  return { count: changed.length, ids: changed };
}
function omitGroups(project: ActualRouteProject): Record<string, unknown> {
  const { stations: _stations, lines: _lines, geometry: _geometry,
    stationLineRelations: _relations, ...rest } = project;
  return { ...rest, geometryExtra: Object.fromEntries(
    Object.entries(project.geometry).filter(([key]) => key !== 'segments'),
  ) };
}
export function summarizeProjectChanges(before: ActualRouteProject, after: ActualRouteProject): CloudChangeSummary {
  const stationChanges = changedRecords(before.stations, after.stations);
  const lines = changedRecords(before.lines, after.lines);
  const segments = changedRecords(before.geometry.segments, after.geometry.segments);
  const relations = changedRecords(before.stationLineRelations, after.stationLineRelations);
  const byId = new Map([...before.stations, ...after.stations].map(station => [station.id, station]));
  return {
    stations: stationChanges.count,
    lines: lines.count,
    segments: segments.count,
    relations: relations.count,
    otherChanged: JSON.stringify(omitGroups(before)) !== JSON.stringify(omitGroups(after)),
    stationDetails: stationChanges.ids.slice(0, 8).map(id => byId.get(id)?.name || id),
  };
}
