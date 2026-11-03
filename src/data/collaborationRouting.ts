import type { ActualRouteProject } from './model';
import { serializeProject } from '../import-export/projectJson';
import type { CloudLineAppend, CloudSegmentSplit, CloudMiddleStationRemoval, CloudNewLineStation, CloudNewLine, CloudLoopClose, CloudLineCompound } from './cloudProjectApi';

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
  if (!line || !fromId ||
      line.locked || line.isFake || line.source?.format === 'aarc' ||
      (line.operationHistory?.length ?? 0) > 0) return false;
  const phases=project.openingPhases.filter(phase=>phase.lineId===lineId);
  if ((phases.length===0 && openingPhaseId) ||
      (phases.length!==0 && (phases.length!==1 || phases[0].id!==openingPhaseId ||
        !Array.isArray(phases[0].segmentIds) ||
        !Array.isArray(phases[0].stationRelationIds)))) return false;
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
  try { before = JSON.parse(baseJson) as ActualRouteProject; } catch { return null; }
  const after = JSON.parse(serializeProject(project)) as ActualRouteProject;
  if (!equal({ ...before, lines: [], openingPhases: [], stationLineRelations: [], geometry: { ...before.geometry, segments: [] } },
             { ...after, lines: [], openingPhases: [], stationLineRelations: [], geometry: { ...after.geometry, segments: [] } })) return null;
  if (before.openingPhases.length !== after.openingPhases.length) return null;
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
  const changedPhases = after.openingPhases.filter((phase,i)=>
    !equal(phase,before.openingPhases[i]));
  const phase = changedPhases.length===1 ? changedPhases[0] : null;
  if (changedPhases.length>1 ||
      (phase && (
        phase.lineId!==line.id ||
        !before.openingPhases.some(item=>item.id===phase.id) ||
        !equal({...phase,segmentIds:[],stationRelationIds:[]},
          {...before.openingPhases.find(item=>item.id===phase.id)!,segmentIds:[],stationRelationIds:[]}) ||
        !equal(phase.segmentIds,[
          ...before.openingPhases.find(item=>item.id===phase.id)!.segmentIds,segment.id]) ||
        !equal(phase.stationRelationIds,[
          ...before.openingPhases.find(item=>item.id===phase.id)!.stationRelationIds,relation.id])
      )) ||
      (!phase && before.openingPhases.some(item=>item.lineId===line.id)) ||
      !before.openingPhases.every((item,i)=>item.id===after.openingPhases[i].id &&
        (item.id===phase?.id || equal(item,after.openingPhases[i])))) return null;
  if (!originalLine || !fromStationId || !toStationId ||
      !canUseLiveLineAppend(before, line.id, fromStationId, toStationId, phase?.id) ||
      !equal({ ...originalLine, stationSequence: [] }, { ...line, stationSequence: [] }) ||
      !equal(line.stationSequence, [...originalLine.stationSequence, toStationId]) ||
      relation.lineId !== line.id || relation.stationId !== toStationId ||
      segment.lineId !== line.id || segment.fromStationId !== fromStationId ||
      segment.toStationId !== toStationId || segment.waypoints.length !== 0 ||
      segment.mode !== 'straight' || segment.structureType !== 'underground' ||
      (segment.structureNodes?.length ?? 0) !== 0 || segment.source ||
      segment.lineStyleId !== undefined || segment.operationHistory?.length ||
      segment.lineHistory?.length || segment.cornerRadius !== undefined ||
      (phase && (relation.openedAt!==phase.openedAt ||
        segment.openedAt!==phase.openedAt))) return null;
  return { lineId: line.id, fromStationId, toStationId,
    segmentId: segment.id, relationId: relation.id,
    ...(phase ? { openingPhaseId:phase.id } : {}) };
}

/**
 * Convert a normal "insert station into segment" canvas mutation into the
 * bounded Java topology protocol only when it changes exactly one segment,
 * adds exactly one station and relation, and preserves every other resource.
 */
export function detectCanvasSegmentSplit(baseJson: string, project: ActualRouteProject):
  Omit<CloudSegmentSplit, 'operationId' | 'expectedRevision'> | null {
  let before: ActualRouteProject;
  try { before = JSON.parse(baseJson) as ActualRouteProject; } catch { return null; }
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
    x:station.x, y:station.y,
    labelOffsetX:station.labelOffsetX, labelOffsetY:station.labelOffsetY,
    relationId:relation.id,
    beforeSegmentId:first.id, afterSegmentId:second.id,
    splitWaypointIndex:first.waypoints.length };
}

/**
 * Route an ordinary delete-key operation to the bounded Java removal endpoint.
 * Only a single native non-transfer middle station in an exact, phase-free,
 * forward-oriented chain is eligible. The output must match the editor's own
 * safe "merge tracks" semantics without deleting unrelated objects.
 */
export function detectCanvasMiddleStationRemoval(baseJson: string, project: ActualRouteProject):
  Omit<CloudMiddleStationRemoval, 'operationId' | 'expectedRevision'> | null {
  let before: ActualRouteProject;
  try { before = JSON.parse(baseJson) as ActualRouteProject; } catch { return null; }
  const after=JSON.parse(serializeProject(project)) as ActualRouteProject;
  if (!equal({ ...before, stations: [], lines: [], stationLineRelations: [],
      geometry: { ...before.geometry, segments: [] } },
    { ...after, stations: [], lines: [], stationLineRelations: [],
      geometry: { ...after.geometry, segments: [] } })) return null;
  if (before.stations.length!==after.stations.length+1 ||
      before.stationLineRelations.length!==after.stationLineRelations.length+1 ||
      before.lines.length!==after.lines.length ||
      before.geometry.segments.length!==after.geometry.segments.length+1 ||
      before.openingPhases.length || (before.operationEvents?.length??0) ||
      before.aarc) return null;

  const removedStations=before.stations.filter(station=>!after.stations.some(x=>x.id===station.id));
  const removedRelations=before.stationLineRelations.filter(rel=>!after.stationLineRelations.some(x=>x.id===rel.id));
  const removedSegments=before.geometry.segments.filter(seg=>!after.geometry.segments.some(x=>x.id===seg.id));
  const addedSegments=after.geometry.segments.filter(seg=>!before.geometry.segments.some(x=>x.id===seg.id));
  if (removedStations.length!==1 || removedRelations.length!==1 ||
      removedSegments.length!==2 || addedSegments.length!==1 ||
      !before.stations.filter(x=>x.id!==removedStations[0].id).every(x=>after.stations.some(y=>equal(x,y))) ||
      !before.stationLineRelations.filter(x=>x.id!==removedRelations[0].id).every(x=>after.stationLineRelations.some(y=>equal(x,y))) ||
      !before.geometry.segments.filter(x=>!removedSegments.some(r=>r.id===x.id))
        .every(x=>after.geometry.segments.some(y=>equal(x,y)))) return null;
  const station=removedStations[0], rel=removedRelations[0], merged=addedSegments[0];
  if (station.source || station.compoundGroupId || station.orientationAnchorLineId ||
      rel.stationId!==station.id || rel.operationHistory?.length ||
      before.stationLineRelations.filter(r=>r.stationId===station.id).length!==1 ||
      before.geometry.segments.filter(seg=>seg.fromStationId===station.id || seg.toStationId===station.id).length!==2 ||
      merged.mode!=='smooth' || merged.structureNodes?.length || merged.source ||
      merged.operationHistory?.length || merged.lineHistory?.length) return null;
  const line=before.lines.find(item=>item.id===rel.lineId);
  const nextLine=after.lines.find(item=>item.id===rel.lineId);
  if(!line || !nextLine || line.locked || line.isFake || line.source ||
      line.operationHistory?.length || line.stationSequence.length<3 ||
      before.lines.filter(x=>x.id!==line.id).some(x=>!equal(x,after.lines.find(y=>y.id===x.id))) ||
      !equal({...line,stationSequence:[]},{...nextLine,stationSequence:[]}) ||
      new Set(line.stationSequence).size!==line.stationSequence.length ||
      before.geometry.segments.filter(seg=>seg.lineId===line.id).length!==line.stationSequence.length-1) return null;
  const index=line.stationSequence.indexOf(station.id);
  if(index<=0 || index>=line.stationSequence.length-1 ||
      !equal(nextLine.stationSequence,line.stationSequence.filter(id=>id!==station.id)) ||
      !line.stationSequence.slice(1).every((id,i)=>before.geometry.segments.filter(seg=>
        seg.lineId===line.id && seg.fromStationId===line.stationSequence[i] &&
        seg.toStationId===id).length===1)) return null;
  const from=line.stationSequence[index-1], to=line.stationSequence[index+1];
  const first=removedSegments.find(seg=>seg.lineId===line.id &&
    seg.fromStationId===from && seg.toStationId===station.id);
  const second=removedSegments.find(seg=>seg.lineId===line.id &&
    seg.fromStationId===station.id && seg.toStationId===to);
  if(!first || !second || merged.lineId!==line.id ||
      merged.fromStationId!==from || merged.toStationId!==to ||
      first.source || second.source ||
      first.structureNodes?.length || second.structureNodes?.length ||
      first.lineHistory?.length || second.lineHistory?.length ||
      first.operationHistory?.length || second.operationHistory?.length ||
      !['straight','smooth'].includes(first.mode) ||
      first.mode!==second.mode || first.structureType!==second.structureType ||
      first.lineStyleId!==second.lineStyleId || first.cornerRadius!==second.cornerRadius ||
      first.openedAt!==second.openedAt || first.closedAt!==second.closedAt ||
      merged.structureType!==first.structureType || merged.lineStyleId!==first.lineStyleId ||
      merged.cornerRadius!==first.cornerRadius || merged.openedAt!==first.openedAt ||
      merged.closedAt!==first.closedAt ||
      merged.waypoints.length!==first.waypoints.length+second.waypoints.length+1 ||
      !equal(merged.waypoints.slice(0,first.waypoints.length),
        first.waypoints.map(w=>first.mode==='straight'?{...w,type:'corner'}:w)) ||
      !equal(merged.waypoints.slice(first.waypoints.length+1),
        second.waypoints.map(w=>second.mode==='straight'?{...w,type:'corner'}:w))) return null;
  const center=merged.waypoints[first.waypoints.length];
  if(center.x!==station.x || center.y!==station.y ||
      center.type!==(first.mode==='straight'?'corner':'smooth')) return null;
  return { lineId:line.id, stationId:station.id,
    beforeSegmentId:first.id, afterSegmentId:second.id,
    mergedSegmentId:merged.id, preservedWaypointId:center.id,
    canvasSemantics:true };
}

/**
 * Recognize exactly one ordinary continuous-drawing station creation.
 * Every new resource is transmitted unmodified and committed atomically by
 * Java, including draft waypoints and one explicit opening phase.
 */
export function detectCanvasNewLineStation(baseJson: string, project: ActualRouteProject):
  Omit<CloudNewLineStation, 'operationId' | 'expectedRevision'> | null {
  let before: ActualRouteProject;
  try { before=JSON.parse(baseJson) as ActualRouteProject; } catch { return null; }
  const after=JSON.parse(serializeProject(project)) as ActualRouteProject;
  if(!equal({...before,stations:[],lines:[],stationLineRelations:[],
      openingPhases:[],geometry:{...before.geometry,segments:[]}},
    {...after,stations:[],lines:[],stationLineRelations:[],
      openingPhases:[],geometry:{...after.geometry,segments:[]}})) return null;
  if(after.stations.length!==before.stations.length+1 ||
     after.stationLineRelations.length!==before.stationLineRelations.length+1 ||
     after.lines.length!==before.lines.length ||
     after.openingPhases.length!==before.openingPhases.length ||
     !before.stations.every((station,i)=>equal(station,after.stations[i])) ||
     !before.stationLineRelations.every((relation,i)=>equal(relation,after.stationLineRelations[i])) ||
     !before.geometry.segments.every((segment,i)=>equal(segment,after.geometry.segments[i]))) return null;
  const station=after.stations.at(-1),relation=after.stationLineRelations.at(-1);
  if(!station || !relation || !station.id || !station.name.trim() ||
     !Number.isFinite(station.x) || !Number.isFinite(station.y) ||
     !Number.isFinite(station.labelOffsetX) || !Number.isFinite(station.labelOffsetY) ||
     Object.keys(station).length!==6 || Object.keys(relation).length>5 ||
     relation.stationId!==station.id ||
     before.stations.some(value=>value.id===station.id)) return null;
  const changedLines=after.lines.filter((line,i)=>!equal(line,before.lines[i]));
  if(changedLines.length!==1) return null;
  const line=changedLines[0],previous=before.lines.find(value=>value.id===line.id);
  if(!previous || relation.lineId!==line.id || previous.locked ||
     previous.isFake || previous.source || previous.operationHistory?.length ||
     (previous.parentLineId && !before.lines.some(parent=>
       parent.id===previous.parentLineId && !parent.locked && !parent.isFake)) ||
     !equal({...previous,stationSequence:[]},{...line,stationSequence:[]})) return null;
  const oldSequence=previous.stationSequence;
  if(!equal(line.stationSequence,[...oldSequence,station.id]) ||
     new Set(oldSequence).size!==oldSequence.length ||
     before.geometry.segments.filter(segment=>segment.lineId===line.id).length!==Math.max(0,oldSequence.length-1) ||
     !oldSequence.slice(1).every((id,i)=>before.geometry.segments.filter(segment=>
       segment.lineId===line.id && segment.fromStationId===oldSequence[i] &&
       segment.toStationId===id).length===1)) return null;
  const fromStationId=oldSequence.at(-1);
  const newSegments=after.geometry.segments.slice(before.geometry.segments.length);
  if(newSegments.length!==(fromStationId?1:0)) return null;
  const segment=newSegments[0];
  if(segment && (segment.lineId!==line.id ||
     segment.fromStationId!==fromStationId || segment.toStationId!==station.id ||
     !['straight','smooth'].includes(segment.mode) ||
     segment.structureType!=='underground' ||
     segment.source || segment.structureNodes?.length ||
     segment.operationHistory?.length || segment.lineHistory?.length ||
     segment.lineStyleId!==undefined || segment.cornerRadius!==undefined ||
     segment.waypoints.length>500 || segment.waypoints.some(w=>
       !w.id || !Number.isFinite(w.x) || !Number.isFinite(w.y) ||
       !['smooth','corner'].includes(w.type) || Object.keys(w).length!==4))) return null;
  const changedPhases=after.openingPhases.filter((phase,i)=>!equal(phase,before.openingPhases[i]));
  const phase=changedPhases.length===1?changedPhases[0]:null;
  if(changedPhases.length>1 ||
     (phase && (!segment && phase.segmentIds.length!==before.openingPhases.find(p=>p.id===phase.id)?.segmentIds.length)) ||
     (phase && (
       phase.lineId!==line.id ||
       !equal({...phase,segmentIds:[],stationRelationIds:[]},
         {...before.openingPhases.find(p=>p.id===phase.id),segmentIds:[],stationRelationIds:[]}) ||
       !equal(phase.segmentIds,[
         ...(before.openingPhases.find(p=>p.id===phase.id)?.segmentIds??[]),
         ...(segment?[segment.id]:[])]) ||
       !equal(phase.stationRelationIds,[
         ...(before.openingPhases.find(p=>p.id===phase.id)?.stationRelationIds??[]),relation.id])
     )) ||
     (!phase && before.openingPhases.some(p=>p.lineId===line.id)) ||
     !before.openingPhases.every((p,i)=>
       p.id===after.openingPhases[i].id &&
       (p.id===phase?.id || equal(p,after.openingPhases[i]))) ||
     before.openingPhases.filter(p=>p.lineId===line.id).length!==(phase?1:0)) return null;
  const opened=phase?.openedAt??previous.openedAt??before.timeline.currentDate??null;
  if((relation.openedAt??null)!==opened ||
     (segment && (segment.openedAt??null)!==opened)) return null;
  return {lineId:line.id,fromStationId:fromStationId??null,station,relation,
    ...(segment?{segment}:{}),...(phase?{openingPhaseId:phase.id}:{})};
}

/**
 * Three-way merge of exactly one subsequent ordinary canvas station append.
 * The server has already committed an earlier operation and may have merged
 * changes to other lines in that response. Preserve those remote changes and
 * the next local station only when the target line + its phase are identical
 * to the acknowledged local snapshot. Unknown local edits never merge.
 */
export function mergeOnePendingCanvasStation(
  acknowledgedSnapshot: string,
  newestLocal: ActualRouteProject,
  committedRemote: ActualRouteProject,
): ActualRouteProject | null {
  const next = detectCanvasNewLineStation(acknowledgedSnapshot, newestLocal);
  if (!next) return null;
  let baseline: ActualRouteProject;
  try { baseline = JSON.parse(acknowledgedSnapshot) as ActualRouteProject; }
  catch { return null; }
  const local = JSON.parse(serializeProject(newestLocal)) as ActualRouteProject;
  const remote = JSON.parse(serializeProject(committedRemote)) as ActualRouteProject;
  const oldLine = baseline.lines.find(line => line.id === next.lineId);
  const remoteLine = remote.lines.find(line => line.id === next.lineId);
  // Concurrent new-line creation may assign a different lineOrder on the
  // server. Ordering does not affect append geometry; retain the server order.
  if (!oldLine || !remoteLine ||
      !equal({...oldLine,lineOrder:0},{...remoteLine,lineOrder:0})) return null;
  const oldPhases = baseline.openingPhases.filter(phase => phase.lineId === next.lineId);
  const newPhases = remote.openingPhases.filter(phase => phase.lineId === next.lineId);
  if (!equal(oldPhases,newPhases)) return null;
  // Line structure alone does not capture transfers, endpoint moves, segment
  // styles or global drawing settings. Require the entire dependency closure
  // of the locally edited line to remain unchanged.
  const stationIds = new Set(oldLine.stationSequence);
  if (!equal(
        baseline.stations.filter(station => stationIds.has(station.id)),
        remote.stations.filter(station => stationIds.has(station.id))) ||
      !equal(
        baseline.stationLineRelations.filter(relation => relation.lineId === next.lineId ||
          stationIds.has(relation.stationId)),
        remote.stationLineRelations.filter(relation => relation.lineId === next.lineId ||
          stationIds.has(relation.stationId))) ||
      !equal(
        baseline.geometry.segments.filter(segment => segment.lineId === next.lineId),
        remote.geometry.segments.filter(segment => segment.lineId === next.lineId)) ||
      !equal(
        { ...baseline, stations:[], lines:[], stationLineRelations:[],
          openingPhases:[], geometry:{...baseline.geometry, segments:[]} },
        { ...remote, stations:[], lines:[], stationLineRelations:[],
          openingPhases:[], geometry:{...remote.geometry, segments:[]} })) return null;
  if (remote.stations.some(station => station.id === next.station.id) ||
      remote.stationLineRelations.some(relation => relation.id === next.relation.id) ||
      (next.segment && remote.geometry.segments.some(segment => segment.id === next.segment!.id))) return null;
  if (next.fromStationId &&
      (!remote.stations.some(station => station.id === next.fromStationId) ||
       remoteLine.stationSequence.at(-1) !== next.fromStationId)) return null;
  if (!next.fromStationId && remoteLine.stationSequence.length) return null;

  const merged = structuredClone(remote);
  const line = merged.lines.find(item => item.id === next.lineId)!;
  line.stationSequence.push(next.station.id);
  merged.stations.push(structuredClone(next.station));
  merged.stationLineRelations.push(structuredClone(next.relation));
  if (next.segment) merged.geometry.segments.push(structuredClone(next.segment));
  if (next.openingPhaseId) {
    const phase = merged.openingPhases.find(item => item.id === next.openingPhaseId);
    if (!phase) return null;
    phase.stationRelationIds.push(next.relation.id);
    if (next.segment) phase.segmentIds.push(next.segment.id);
  }
  // Guard against fields in the local delta that the operation detector may
  // not have represented. For a document without remote edits, the result
  // must be bitwise equal to the ordinary editor's intended serialized map.
  if (equal(remote,baseline) && !equal(merged,local)) return null;
  return merged;
}

/**
 * Native "new line" dialog produces exactly one empty main line and first
 * phase. Recognize only that atomic pair; branched / seeded construction
 * remains a strict-CAS document edit.
 */
export function detectCanvasNewLine(baseJson: string, project: ActualRouteProject):
  Omit<CloudNewLine, 'operationId' | 'expectedRevision'> | null {
  let before: ActualRouteProject;
  try { before=JSON.parse(baseJson) as ActualRouteProject; } catch { return null; }
  const after=JSON.parse(serializeProject(project)) as ActualRouteProject;
  const oldRelations=before.stationLineRelations;
  const newRelations=after.stationLineRelations;
  if (!equal({...before,lines:[],openingPhases:[],stationLineRelations:[]},
             {...after,lines:[],openingPhases:[],stationLineRelations:[]}) ||
      after.lines.length!==before.lines.length+1 ||
      after.openingPhases.length!==before.openingPhases.length+1 ||
      !before.lines.every((line,i)=>equal(line,after.lines[i])) ||
      !before.openingPhases.every((phase,i)=>equal(phase,after.openingPhases[i])) ||
      !oldRelations.every((relation,i)=>equal(relation,newRelations[i])))
    return null;
  const line=after.lines.at(-1), phase=after.openingPhases.at(-1);
  if(!line || !phase || line.isFake || line.source ||
      line.operationHistory?.length || line.lineBadges?.length ||
      !line.visible || line.locked ||
      (!line.parentLineId && !line.name.trim()) ||
      !/^#[0-9a-fA-F]{6}$/.test(line.color) ||
      line.openedAt!==phase.openedAt || phase.lineId!==line.id ||
      !phase.openedAt || phase.segmentIds.length ||
      phase.overriddenSegmentIds?.length ||
      phase.overriddenStationRelationIds?.length ||
      phase.revealEndStationId ||
      before.lines.some(item=>item.id===line.id) ||
      before.openingPhases.some(item=>item.id===phase.id) ||
      (line.parentLineId && (
        !before.lines.some(parent=>parent.id===line.parentLineId &&
          !parent.locked && !parent.isFake && !parent.source)
      ))) return null;
  const seedRelation=newRelations.length===oldRelations.length+1
    ? newRelations.at(-1) : undefined;
  if(newRelations.length!==oldRelations.length+(seedRelation?1:0)) return null;
  if(seedRelation) {
    if(!line.parentLineId || line.stationSequence.length!==1 ||
       line.stationSequence[0]!==seedRelation.stationId ||
       seedRelation.lineId!==line.id ||
       !before.stations.some(station=>station.id===seedRelation.stationId) ||
       phase.revealStartStationId!==seedRelation.stationId ||
       !equal(phase.stationRelationIds,[seedRelation.id]) ||
       seedRelation.openedAt!==phase.openedAt ||
       seedRelation.closedAt!==null ||
       seedRelation.operationHistory?.length ||
       seedRelation.anchor || seedRelation.stationCode)
      return null;
  } else if(line.stationSequence.length || phase.stationRelationIds.length ||
            phase.revealStartStationId) return null;
  return { line, phase, ...(seedRelation?{seedRelation}:{}) };
}

/**
 * The normal canvas closes a loop by connecting its final station to the
 * first one. The station sequence and membership remain unchanged; only
 * the closing interval (and its phase ownership) are appended.
 */
export function detectCanvasLoopClosure(baseJson: string, project: ActualRouteProject):
  Omit<CloudLoopClose, 'operationId' | 'expectedRevision'> | null {
  let before: ActualRouteProject;
  try { before=JSON.parse(baseJson) as ActualRouteProject; } catch { return null; }
  const after=JSON.parse(serializeProject(project)) as ActualRouteProject;
  if(!equal({...before,openingPhases:[],geometry:{...before.geometry,segments:[]}},
            {...after,openingPhases:[],geometry:{...after.geometry,segments:[]}}) ||
     before.geometry.segments.length+1!==after.geometry.segments.length ||
     before.openingPhases.length!==after.openingPhases.length ||
     !before.geometry.segments.every((item,i)=>equal(item,after.geometry.segments[i]))) return null;
  const segment=after.geometry.segments.at(-1);
  const line=segment && before.lines.find(item=>item.id===segment.lineId);
  if(!segment || !line || line.locked || line.isFake || line.source ||
     line.operationHistory?.length || line.stationSequence.length<3 ||
     new Set(line.stationSequence).size!==line.stationSequence.length ||
     line.stationSequence[0]!==segment.toStationId ||
     line.stationSequence.at(-1)!==segment.fromStationId ||
     segment.mode!=='straight' || segment.structureType!=='underground' ||
     segment.structureNodes?.length || segment.waypoints.length ||
     segment.source || segment.operationHistory?.length ||
     segment.lineHistory?.length || segment.lineStyleId!==undefined ||
     segment.cornerRadius!==undefined ||
     before.geometry.segments.filter(item=>item.lineId===line.id).length!==
       line.stationSequence.length-1 ||
     !line.stationSequence.slice(1).every((id,i)=>
       before.geometry.segments.filter(item=>item.lineId===line.id &&
         item.fromStationId===line.stationSequence[i] && item.toStationId===id).length===1) ||
     ![segment.fromStationId,segment.toStationId].every(id=>
       before.stationLineRelations.some(rel=>rel.lineId===line.id && rel.stationId===id)))
    return null;
  const changed=after.openingPhases.filter((phase,i)=>!equal(phase,before.openingPhases[i]));
  if(changed.length>1) return null;
  const phase=changed[0];
  if(phase) {
    const original=before.openingPhases.find(p=>p.id===phase.id);
    if(!original || original.lineId!==line.id ||
       !equal({...original,segmentIds:[]},{...phase,segmentIds:[]}) ||
       !equal(phase.segmentIds,[...original.segmentIds,segment.id]) ||
       !before.openingPhases.every((p,i)=>p.id===after.openingPhases[i].id &&
         (p.id===phase.id || equal(p,after.openingPhases[i])))) return null;
  } else if(before.openingPhases.some(p=>p.lineId===line.id)) return null;
  if(before.openingPhases.filter(p=>p.lineId===line.id).length!==(phase?1:0) ||
     (segment.openedAt??null)!==(phase?.openedAt??line.openedAt??before.timeline.currentDate??null) ||
     (segment.closedAt??null)!==null) return null;
  return {lineId:line.id,segmentId:segment.id,
    ...(phase?{openingPhaseId:phase.id}:{})};
}

/**
 * Fallback for a complex mutation affecting ONE native line, including
 * branch/loop reconfiguration and compound segment edits. The server checks
 * a trusted immutable baseline and validates all dependencies before merging.
 *
 * Do not route cross-line or global changes, or changes that only rename/move
 * one station (they have a smaller existing operation protocol).
 */
export function detectCanvasLineCompound(baseJson: string, project: ActualRouteProject):
  Omit<CloudLineCompound, 'operationId' | 'expectedRevision'> | null {
  let before: ActualRouteProject;
  try { before=JSON.parse(baseJson) as ActualRouteProject; } catch { return null; }
  const serialized=serializeProject(project);
  if(baseJson.length+serialized.length>750_000) return null;
  const after=JSON.parse(serialized) as ActualRouteProject;
  if(!equal({...before,lines:[],stations:[],stationLineRelations:[],
      openingPhases:[],geometry:{...before.geometry,segments:[]}},
    {...after,lines:[],stations:[],stationLineRelations:[],
      openingPhases:[],geometry:{...after.geometry,segments:[]}})) return null;
  if(before.lines.length!==after.lines.length) return null;
  const changed=new Set<string>();
  const diffOwned=(key:'stationLineRelations'|'openingPhases')=>{
    const original=new Map(before[key].map(item=>[item.id,item]));
    const updated=new Map(after[key].map(item=>[item.id,item]));
    for(const [id,item] of original)
      if(!equal(item,updated.get(id))) changed.add(item.lineId);
    for(const [id,item] of updated)
      if(!equal(item,original.get(id))) changed.add(item.lineId);
  };
  const oldLines=new Map(before.lines.map(line=>[line.id,line]));
  const newLines=new Map(after.lines.map(line=>[line.id,line]));
  if(oldLines.size!==before.lines.length || newLines.size!==after.lines.length) return null;
  for(const [id,line] of oldLines) {
    if(!newLines.has(id))return null;
    if(!equal(line,newLines.get(id)))changed.add(id);
  }
  diffOwned('stationLineRelations');
  diffOwned('openingPhases');
  const oldSegments=new Map(before.geometry.segments.map(item=>[item.id,item]));
  const newSegments=new Map(after.geometry.segments.map(item=>[item.id,item]));
  for(const [id,item] of oldSegments)
    if(!equal(item,newSegments.get(id))) changed.add(item.lineId);
  for(const [id,item] of newSegments)
    if(!equal(item,oldSegments.get(id))) changed.add(item.lineId);
  if(changed.size!==1) return null;
  const [lineId]=[...changed];
  const line=oldLines.get(lineId);
  const next=newLines.get(lineId);
  if(!line || !next || line.locked || line.isFake || line.source ||
      line.operationHistory?.length) return null;
  const stationIds=new Set([
    ...line.stationSequence,...next.stationSequence,
    ...before.stationLineRelations.filter(r=>r.lineId===lineId).map(r=>r.stationId),
    ...after.stationLineRelations.filter(r=>r.lineId===lineId).map(r=>r.stationId),
  ]);
  const oldStations=new Map(before.stations.map(station=>[station.id,station]));
  const newStations=new Map(after.stations.map(station=>[station.id,station]));
  if(newStations.size<oldStations.size) return null;
  for(const [id,item] of oldStations)
    if(!newStations.has(id) || (!equal(item,newStations.get(id)) && !stationIds.has(id)))
      return null;
  for(const [id] of newStations)
    if(!oldStations.has(id) && !stationIds.has(id)) return null;
  for(const key of ['stationLineRelations','openingPhases'] as const) {
    const original=before[key].filter(item=>item.lineId!==lineId);
    const updated=after[key].filter(item=>item.lineId!==lineId);
    if(!equal(original,updated)) return null;
  }
  if(!equal(
    before.geometry.segments.filter(item=>item.lineId!==lineId),
    after.geometry.segments.filter(item=>item.lineId!==lineId))) return null;
  return {lineId,beforeDocument:before,afterDocument:after};
}
