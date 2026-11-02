import type { ActualRouteProject } from './model';
import { parseProjectJson, serializeProject } from '../import-export/projectJson';
import type { CloudLineAppend } from './cloudProjectApi';

/**
 * The backend's line-append endpoint intentionally supports only an existing,
 * single continuous native line without opening-phase ownership or branches.
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

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Detect a single ordinary-canvas "connect to existing station" operation.
 * Fail closed for compound edits, line histories, waypoints and phase edits:
 * those continue through the version-checked full-document save path.
 */
export function detectCanvasLineAppend(baseJson: string, project: ActualRouteProject):
  Omit<CloudLineAppend, 'operationId' | 'expectedRevision'> | null {
  let before: ActualRouteProject;
  try { before = parseProjectJson(baseJson); } catch { return null; }
  const after = JSON.parse(serializeProject(project)) as ActualRouteProject;
  if (!equal({ ...before, lines: [], stationLineRelations: [], geometry: { ...before.geometry, segments: [] } },
             { ...after, lines: [], stationLineRelations: [], geometry: { ...after.geometry, segments: [] } })) return null;
  if (before.lines.length !== after.lines.length ||
      after.stationLineRelations.length !== before.stationLineRelations.length + 1 ||
      after.geometry.segments.length !== before.geometry.segments.length + 1) return null;

  const newLineRelations = after.stationLineRelations.filter(relation =>
    !before.stationLineRelations.some(original => original.id === relation.id));
  const newSegments = after.geometry.segments.filter(segment =>
    !before.geometry.segments.some(original => original.id === segment.id));
  if (newLineRelations.length !== 1 || newSegments.length !== 1 ||
      !before.stationLineRelations.every((relation, i) => equal(relation, after.stationLineRelations[i])) ||
      !before.geometry.segments.every((segment, i) => equal(segment, after.geometry.segments[i]))) return null;
  const relation = newLineRelations[0], segment = newSegments[0];
  const changedLines = after.lines.filter((line, i) => !equal(line, before.lines[i]));
  if (changedLines.length !== 1) return null;
  const line = changedLines[0];
  const originalLine = before.lines.find(item => item.id === line.id);
  const fromStationId = originalLine?.stationSequence.at(-1);
  const toStationId = line.stationSequence.at(-1);
  if (!originalLine || !fromStationId || !toStationId ||
      !canUseLiveLineAppend(before, line.id, fromStationId, toStationId) ||
      !equal({ ...originalLine, stationSequence: [] }, { ...line, stationSequence: [] }) ||
      !equal(line.stationSequence, [...originalLine.stationSequence, toStationId]) ||
      relation.lineId !== line.id || relation.stationId !== toStationId ||
      segment.lineId !== line.id || segment.fromStationId !== fromStationId ||
      segment.toStationId !== toStationId || segment.waypoints.length !== 0 ||
      segment.mode !== 'straight') return null;
  return { lineId: line.id, fromStationId, toStationId,
    segmentId: segment.id, relationId: relation.id };
}
