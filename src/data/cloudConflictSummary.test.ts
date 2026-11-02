import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './storage';
import { createStandaloneStation } from './stationLiveOperations';
import { summarizeProjectChanges } from './cloudConflictSummary';

describe('cloud conflict summary', () => {
  it('captures independent station changes without claiming a merge', () => {
    const base = createEmptyProject();
    const updated = createStandaloneStation(base, 'Cloud station', 100, 200, 's1');
    expect(summarizeProjectChanges(base, updated)).toMatchObject({
      stations: 1, lines: 0, segments: 0, relations: 0,
      otherChanged: false, stationDetails: ['Cloud station'],
    });
  });
  it('detects nonstation metadata changes', () => {
    const base = createEmptyProject();
    const updated = { ...base, name: 'Another city' };
    expect(summarizeProjectChanges(base, updated)).toMatchObject({
      stations: 0, lines: 0, segments: 0, relations: 0, otherChanged: true,
    });
  });
});
