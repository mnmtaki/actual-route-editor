import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './storage';
import { serializeProject } from '../import-export/projectJson';
import { detectStationOperation, createStandaloneStation } from './stationLiveOperations';
import { getEditorVisibleStationsAtTime } from '../timeline/active';

describe('station operation isolation', () => {
  const base = createEmptyProject();
  const first = createStandaloneStation(base,'Station A',100,200,'sta-one');
  it('shows an unconnected station on the editor canvas but not a free AARC control point', () => {
    expect(getEditorVisibleStationsAtTime(first, first.timeline.currentDate)
      .map(station => station.id)).toContain('sta-one');
    const free = { ...first, stations: first.stations.map(station => ({ ...station, free: true })) };
    expect(getEditorVisibleStationsAtTime(free, first.timeline.currentDate)
      .map(station => station.id)).not.toContain('sta-one');
  });
  it('recognizes standalone station additions', () => {
    expect(detectStationOperation(serializeProject(base),first)).toMatchObject({
      type:'station.create',station:{id:'sta-one',name:'Station A',x:100,y:200},
    });
  });
  it('recognizes isolated rename and move', () => {
    const renamed = { ...first, stations: first.stations.map(s => ({...s,name:'Renamed'})) };
    expect(detectStationOperation(serializeProject(first),renamed)?.type).toBe('station.rename');
    const moved = { ...first, stations: first.stations.map(s => ({...s,x:125,y:240})) };
    expect(detectStationOperation(serializeProject(first),moved)?.type).toBe('station.move');
  });
  it('refuses multi-station, line and unrelated simultaneous mutations', () => {
    const second=createStandaloneStation(first,'Station B',300,400,'sta-two');
    expect(detectStationOperation(serializeProject(base),second)).toBeNull();
    const altered={ ...first,stations:first.stations.map(s=>({...s,name:'Renamed',x:130})) };
    expect(detectStationOperation(serializeProject(first),altered)).toBeNull();
    const changed={ ...first, name: 'Another city', stations:first.stations.map(s=>({...s,x:130})) };
    expect(detectStationOperation(serializeProject(first),changed)).toBeNull();
  });
});
