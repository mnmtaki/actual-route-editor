import type { ActualRouteProject } from './model';
import { parseProjectJson, serializeProject } from '../import-export/projectJson';
import type { CloudLineAppend, CloudSegmentSplit } from './cloudProjectApi';

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
      segment.mode !== 'straight' || segment.structureType !== 'underground' ||
      (segment.structureNodes?.length ?? 0) !== 0 || segment.source ||
      segment.lineStyleId !== undefined || segment.operationHistory?.length ||
      segment.lineHistory?.length || segment.cornerRadius !== undefined) return null;
  return { lineId: line.id, fromStationId, toStationId,
    segmentId: segment.id, relationId: relation.id };
}

/**
 * Convert a normal "insert station into segment" canvas mutation into the
 * bounded Java topology protocol only when it changes exactly one segment,
 * adds exactly one station and relation, and preserves every other resource.
 */
export function detectCanvasSegmentSplit(baseJson: string, project: ActualRouteProject):
  Omit<CloudSegmentSplit, 'operationId' | 'expectedRevision'> | null {
  let before: ActualRouteProject;
  try { before = parseProjectJson(baseJson); } catch { return null; }
  const after = JSON.parse(serializeProject(project)) as ActualRouteProject;
  if (!equal({ ...before, stations: [], lines: [], stationLineRelations: [], geometry: { ...before.geometry, segments: [] } },
             { ...after, stations: [], lines: [], stationLineRelations: [], geometry: { ...after.geometry, segments: [] } })) return null;
  if (after.stations.length !== before.stations.length + 1 ||
      after.stationLineRelations.length !== before.stationLineRelations.length + 1 ||
      after.lines.length !== before.lines.length ||
      after.geometry.segments.length !== before.geometry.segments.length + 1 ||
      !before.stations.every((item,i)=>equal(item,after.stations[i])) ||
      !before.stationLineRelations.every((item,i)=>equal(item,after.stationLineRelations[i]))) return null;
  const station=after.stations.at(-1), relation=after.stationLineRelations.at(-1);
  if (!station || !relation || !station.name.trim() ||
      !Number.isFinite(station.x) || !Number.isFinite(station.y) ||
      relation.stationId!==station.id) return null;
  const changedLines=after.lines.filter((line,i)=>!equal(line,before.lines[i]));
  if (changedLines.length!==1) return null;
  const line=changedLines[0], originalLine=before.lines.find(item=>item.id===line.id);
  if (!originalLine || relation.lineId!==line.id ||
      line.locked || line.isFake || line.source || line.operationHistory?.length ||
      project.openingPhases.some(phase=>phase.lineId===line.id) ||
      !equal({ ...originalLine, stationSequence: [] }, { ...line, stationSequence: [] })) return null;
  const sourceCandidates=before.geometry.segments.filter(source =>
    !after.geometry.segments.some(segment=>segment.id===source.id));
  const added=after.geometry.segments.filter(segment =>
    !before.geometry.segments.some(source=>source.id===segment.id));
  if(sourceCandidates.length!==1 || added.length!==2) return null;
  const source=sourceCandidates[0];
  if (source.lineId!==line.id || source.source || source.structureNodes?.length ||
      source.operationHistory?.length || source.lineHistory?.length) return null;
  const index=originalLine.stationSequence.findIndex((id,i)=>
    id===source.fromStationId && originalLine.stationSequence[i+1]===source.toStationId);
  if (index<0 ||
      !equal(line.stationSequence, [
        ...originalLine.stationSequence.slice(0,index+1),
        station.id, ...originalLine.stationSequence.slice(index+1)
      ]) ||
      before.geometry.segments.filter(segment=>segment.lineId===line.id).length!==originalLine.stationSequence.length-1 ||
      !originalLine.stationSequence.slice(1).every((id,i)=>
        before.geometry.segments.filter(segment=>segment.lineId===line.id &&
          segment.fromStationId===originalLine.stationSequence[i] &&
          segment.toStationId===id).length===1)) return null;
  const first=added.find(segment=>segment.fromStationId===source.fromStationId && segment.toStationId===station.id);
  const second=added.find(segment=>segment.fromStationId===station.id && segment.toStationId===source.toStationId);
  if (!first || !second || first.lineId!==line.id || second.lineId!==line.id ||
      !equal(first.waypoints.concat(second.waypoints),source.waypoints) ||
      ![first,second].every(part =>
        part.mode === source.mode &&
        part.structureType === source.structureType &&
        part.lineStyleId === source.lineStyleId &&
        part.cornerRadius === source.cornerRadius &&
        part.openedAt === source.openedAt &&
        part.closedAt === source.closedAt &&
        (part.structureNodes?.length ?? 0) === 0 &&
        !part.source && !part.operationHistory?.length && !part.lineHistory?.length) ||
      !before.geometry.segments.filter(item=>item.id!==source.id).every(item=>
        after.geometry.segments.some(current=>equal(item,current)))) return null;
  return { segmentId:source.id, stationId:station.id, stationName:station.name,
    x:station.x, y:station.y, relationId:relation.id,
    beforeSegmentId:first.id, afterSegmentId:second.id,
    splitWaypointIndex:first.waypoints.length };
}
