import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './storage';
import { serializeProject } from '../import-export/projectJson';
import { connectExistingStation, insertStationIntoSegment, appendStationToLineWithWaypoints } from './operations';
import { deleteStationPreservingNetwork } from './stationDeletion';
import { createOpeningPhase } from './openingPhases';
import { canUseLiveLineAppend, detectCanvasLineAppend, detectCanvasSegmentSplit, detectCanvasMiddleStationRemoval, detectCanvasNewLineStation, mergeOnePendingCanvasStation } from './collaborationRouting';
import type { ActualRouteProject } from './model';

function makeProject(): ActualRouteProject {
  const p = createEmptyProject();
  p.stations = [
    { id: 'a', name: 'A', x: 0, y: 0, labelOffsetX: 0, labelOffsetY: 0 },
    { id: 'b', name: 'B', x: 10, y: 0, labelOffsetX: 0, labelOffsetY: 0 },
    { id: 'c', name: 'C', x: 20, y: 0, labelOffsetX: 0, labelOffsetY: 0 },
  ];
  p.lines = [{ id: 'line-1', name: 'Line 1', color: '#ff0000',
    stationSequence: ['a','b'], lineOrder: 0, visible: true, locked: false }];
  p.stationLineRelations = [
    { id: 'rel-a', lineId: 'line-1', stationId: 'a' },
    { id: 'rel-b', lineId: 'line-1', stationId: 'b' },
  ];
  p.geometry.segments = [{ id: 'seg-ab', lineId: 'line-1', fromStationId: 'a',
    toStationId: 'b', mode: 'straight', structureType: 'underground',
    waypoints: [] }];
  return p;
}

function appended(p: ActualRouteProject): ActualRouteProject {
  const next = structuredClone(p);
  next.lines[0].stationSequence.push('c');
  next.stationLineRelations.push({
    id: 'rel-c', lineId: 'line-1', stationId: 'c',
  });
  next.geometry.segments.push({
    id: 'seg-bc', lineId: 'line-1', fromStationId: 'b',
    toStationId: 'c', mode: 'straight', structureType: 'underground',
    waypoints: [],
  });
  return next;
}

describe('ordinary canvas collaboration routing', () => {
  it('recognizes an isolated terminal connection to an existing station', () => {
    const before = makeProject();
    expect(canUseLiveLineAppend(before, 'line-1', 'b', 'c')).toBe(true);
    expect(detectCanvasLineAppend(serializeProject(before), appended(before)))
      .toEqual({ lineId: 'line-1', fromStationId: 'b', toStationId: 'c',
        segmentId: 'seg-bc', relationId: 'rel-c' });
  });

  it('recognizes the actual normal-canvas connectExistingStation command', () => {
    const before = makeProject();
    const after = connectExistingStation(before, 'line-1', 'c', 'b');
    const operation = detectCanvasLineAppend(serializeProject(before), after);
    expect(operation).toMatchObject({
      lineId: 'line-1', fromStationId: 'b', toStationId: 'c',
    });
    expect(operation?.segmentId).toBeTruthy();
    expect(operation?.relationId).toBeTruthy();
  });

  it('routes a normal canvas append into its sole explicit opening phase', () => {
    const base = makeProject();
    const created = createOpeningPhase(base, {
      lineId:'line-1', openedAt:'2026-04-01', name:'一期',
    });
    const after = connectExistingStation(created.project,'line-1','c','b',created.phaseId);
    const routed = detectCanvasLineAppend(serializeProject(created.project),after);
    expect(routed).toMatchObject({
      lineId:'line-1',fromStationId:'b',toStationId:'c',
      openingPhaseId:created.phaseId,
    });
    const ambiguous = structuredClone(created.project);
    ambiguous.openingPhases.push({
      id:'phase-two',lineId:'line-1',openedAt:'2026-05-01',
      segmentIds:[],stationRelationIds:[],
    });
    expect(detectCanvasLineAppend(serializeProject(ambiguous),
      connectExistingStation(ambiguous,'line-1','c','b',created.phaseId))).toBeNull();
  });

  it('routes the first normally drawn station without a segment', () => {
    const base=makeProject();
    base.lines[0].stationSequence=[];
    base.stationLineRelations=[];
    base.geometry.segments=[];
    const phased=createOpeningPhase(base,{lineId:'line-1',openedAt:'2026-05-01',name:'一期'});
    const created=appendStationToLineWithWaypoints(phased.project,'line-1',{x:30,y:20},
      [],null,phased.phaseId);
    const routed=detectCanvasNewLineStation(serializeProject(phased.project),created.project);
    expect(routed).toMatchObject({
      lineId:'line-1',fromStationId:null,openingPhaseId:phased.phaseId,
      station:{id:created.stationId},relation:{stationId:created.stationId},
    });
    expect(routed?.segment).toBeUndefined();
  });

  it('routes ordinary continuous drawing with draft waypoints and one phase', () => {
    const before=makeProject();
    const phased=createOpeningPhase(before,{lineId:'line-1',openedAt:'2026-06-01',name:'一期'});
    const created=appendStationToLineWithWaypoints(phased.project,'line-1',{x:60,y:30},
      [{id:'draft-1',x:35,y:18}], 'b',phased.phaseId);
    const routed=detectCanvasNewLineStation(serializeProject(phased.project),created.project);
    expect(routed).toMatchObject({
      lineId:'line-1',fromStationId:'b',openingPhaseId:phased.phaseId,
      station:{id:created.stationId},
      segment:{waypoints:[{id:'draft-1',x:35,y:18}]},
    });
    const dirty=structuredClone(created.project);
    dirty.stations[0].name='unrelated';
    expect(detectCanvasNewLineStation(serializeProject(phased.project),dirty)).toBeNull();
    const ambiguous=structuredClone(phased.project);
    ambiguous.openingPhases.push({id:'other',lineId:'line-1',openedAt:'2026-07-01',
      segmentIds:[],stationRelationIds:[]});
    const more=appendStationToLineWithWaypoints(ambiguous,'line-1',{x:65,y:30},[],
      'b',phased.phaseId);
    expect(detectCanvasNewLineStation(serializeProject(ambiguous),more.project)).toBeNull();
  });

  it('merges a continued ordinary station append with an independent remote line edit', () => {
    const base = makeProject();
    base.lines.push({ id:'line-2', name:'Second', color:'#123456',
      stationSequence:[], lineOrder:1, visible:true, locked:false });
    const local = appendStationToLineWithWaypoints(base,'line-1',{x:50,y:30},[],'b');
    const remote = structuredClone(base);
    remote.lines[1].name = 'Edited remotely';
    const merged = mergeOnePendingCanvasStation(serializeProject(base),local.project,remote);
    expect(merged).not.toBeNull();
    expect(merged?.lines[1].name).toBe('Edited remotely');
    expect(merged?.lines[0].stationSequence.at(-1)).toBe(local.stationId);
    expect(merged?.stations.some(station=>station.id===local.stationId)).toBe(true);
  });

  it('refuses to merge same-line remote edits or compound local edits', () => {
    const base = makeProject();
    const local = appendStationToLineWithWaypoints(base,'line-1',{x:50,y:30},[],'b');
    const sameLine = structuredClone(base);
    sameLine.lines[0].name = 'Concurrent rename';
    expect(mergeOnePendingCanvasStation(serializeProject(base),local.project,sameLine)).toBeNull();
    const compound = structuredClone(local.project);
    compound.stations[0].name = 'Unrelated local rename';
    expect(mergeOnePendingCanvasStation(serializeProject(base),compound,base)).toBeNull();
    const collision = structuredClone(base);
    collision.stations.push(structuredClone(local.project.stations.at(-1)!));
    expect(mergeOnePendingCanvasStation(serializeProject(base),local.project,collision)).toBeNull();
  });

  it('rejects mixed changes and non-terminal connections', () => {
    const before = makeProject();
    const mixed = appended(before);
    mixed.stations[0].name = 'Changed';
    expect(detectCanvasLineAppend(serializeProject(before), mixed)).toBeNull();
    expect(canUseLiveLineAppend(before, 'line-1', 'a', 'c')).toBe(false);
    expect(canUseLiveLineAppend(before, 'line-1', 'b', 'a')).toBe(false);
  });

  it('routes a normal-canvas station insertion only for simple segments', () => {
    const before = makeProject();
    const result = insertStationIntoSegment(before, 'seg-ab', { x: 5, y: 0 });
    expect(result.stationId).toBeTruthy();
    const split = detectCanvasSegmentSplit(serializeProject(before), result.project);
    expect(split).toMatchObject({
      segmentId: 'seg-ab', stationId: result.stationId,
      splitWaypointIndex: 0,
    });
    const mixed = structuredClone(result.project);
    mixed.stations[0].name = 'Concurrent local change';
    expect(detectCanvasSegmentSplit(serializeProject(before), mixed)).toBeNull();
    const phased = structuredClone(before);
    phased.openingPhases.push({
      id: 'phase-1', lineId: 'line-1', openedAt: '2026-01-01',
      stationRelationIds: [], segmentIds: [],
    });
    expect(detectCanvasSegmentSplit(serializeProject(phased),
      insertStationIntoSegment(phased, 'seg-ab', { x: 5, y: 0 }).project)).toBeNull();
  });

  it('routes ordinary middle-station deletion with matching canvas geometry', () => {
    const project = makeProject();
    const before = structuredClone(project);
    before.lines[0].stationSequence.push('c');
    before.stationLineRelations.push({ id:'rel-c',lineId:'line-1',stationId:'c' });
    before.geometry.segments.push({
      id:'seg-bc',lineId:'line-1',fromStationId:'b',toStationId:'c',
      mode:'straight',structureType:'underground',waypoints:[],
    });
    const result = deleteStationPreservingNetwork(before, 'b');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reconnected).toBe(true);
    const operation = detectCanvasMiddleStationRemoval(serializeProject(before),result.project);
    expect(operation).toMatchObject({
      lineId:'line-1',stationId:'b',beforeSegmentId:'seg-ab',
      afterSegmentId:'seg-bc',canvasSemantics:true,
    });
    const mixed=structuredClone(result.project);
    mixed.stations[0].name='Changed outside deletion';
    expect(detectCanvasMiddleStationRemoval(serializeProject(before),mixed)).toBeNull();
    const phased=structuredClone(before);
    phased.openingPhases.push({id:'phase',lineId:'line-1',
      openedAt:'2026-01-01',segmentIds:[],stationRelationIds:[]});
    expect(detectCanvasMiddleStationRemoval(serializeProject(phased),
      result.project)).toBeNull();
  });

  it('does not route phase-owned, branched or historical lines', () => {
    const before = makeProject();
    before.openingPhases = [{ id: 'phase-1', lineId: 'line-1',
      openedAt: '2026-01-01', stationRelationIds: [], segmentIds: [] }];
    expect(detectCanvasLineAppend(serializeProject(before), appended(before))).toBeNull();
    before.openingPhases = [];
    before.lines[0].operationHistory = [{
      id: 'historical', effectiveAt: '2026-01-01', type: 'open',
    } as unknown as NonNullable<typeof before.lines[0]['operationHistory']>[number]];
    expect(detectCanvasLineAppend(serializeProject(before), appended(before))).toBeNull();
  });
});
