import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './storage';
import { serializeProject } from '../import-export/projectJson';
import { connectExistingStation, insertStationIntoSegment } from './operations';
import { deleteStationPreservingNetwork } from './stationDeletion';
import { createOpeningPhase } from './openingPhases';
import { canUseLiveLineAppend, detectCanvasLineAppend, detectCanvasSegmentSplit, detectCanvasMiddleStationRemoval } from './collaborationRouting';
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
