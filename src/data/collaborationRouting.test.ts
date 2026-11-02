import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './storage';
import { serializeProject } from '../import-export/projectJson';
import { connectExistingStation } from './operations';
import { canUseLiveLineAppend, detectCanvasLineAppend } from './collaborationRouting';
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

  it('rejects mixed changes and non-terminal connections', () => {
    const before = makeProject();
    const mixed = appended(before);
    mixed.stations[0].name = 'Changed';
    expect(detectCanvasLineAppend(serializeProject(before), mixed)).toBeNull();
    expect(canUseLiveLineAppend(before, 'line-1', 'a', 'c')).toBe(false);
    expect(canUseLiveLineAppend(before, 'line-1', 'b', 'a')).toBe(false);
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
