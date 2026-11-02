import type { ActualRouteProject } from './model';

/**
 * The backend's line-append endpoint intentionally supports only an existing,
 * single continuous native line without opening-phase ownership or branches.
 * Ordinary canvas drawing must use the operation protocol only if those same
 * preconditions can be proven locally; all other drawing uses CAS fallback.
 */
export function canUseLiveLineAppend(
  project: ActualRouteProject,
  lineId: string,
  fromId: string | null | undefined,
  toId: string,
  openingPhaseId?: string,
): boolean {
  const line = project.lines.find(item => item.id === lineId);
  if (!line || !fromId || openingPhaseId ||
      line.locked || line.isFake || line.source?.format === 'aarc' ||
      (line.operationHistory?.length ?? 0) > 0 ||
      project.openingPhases.some(phase => phase.lineId === lineId)) return false;
  const sequence = line.stationSequence;
  if (sequence.length === 0 || sequence.at(-1) !== fromId ||
      sequence.includes(toId) || new Set(sequence).size !== sequence.length ||
      !project.stations.some(station => station.id === fromId) ||
      !project.stations.some(station => station.id === toId) ||
      project.stationLineRelations.some(relation =>
        relation.lineId === lineId && relation.stationId === toId)) return false;
  const segments = project.geometry.segments.filter(segment => segment.lineId === lineId);
  if (segments.length !== sequence.length - 1) return false;
  return sequence.slice(1).every((stationId, index) => segments.filter(segment =>
    (segment.fromStationId === sequence[index] && segment.toStationId === stationId) ||
    (segment.toStationId === sequence[index] && segment.fromStationId === stationId)
  ).length === 1);
}
