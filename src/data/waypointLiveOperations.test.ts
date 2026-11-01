import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './storage';
import { serializeProject } from '../import-export/projectJson';
import type { Segment } from './model';
import { detectWaypointMove } from './waypointLiveOperations';

const segment=(id:string):Segment=>({id,lineId:'line-a',fromStationId:'from',toStationId:'to',
  mode:'smooth',structureType:'underground',waypoints:[{id:id+'-w',x:10,y:20,type:'corner'}]});
const project=()=>({...createEmptyProject(),geometry:{segments:[segment('one'),segment('two')]}});
describe('waypoint move isolation',()=>{
  it('accepts one coordinate-only move within an existing segment',()=>{
    const original=project();
    const next=structuredClone(original);
    next.geometry.segments[1].waypoints[0].x=30;
    expect(detectWaypointMove(serializeProject(original),next)).toEqual({
      segmentId:'two',waypointId:'two-w',x:30,y:20,
    });
  });
  it('rejects topology, additions and concurrent edits to more than one waypoint',()=>{
    const original=project();
    const both=structuredClone(original);
    both.geometry.segments[0].waypoints[0].x=50;
    both.geometry.segments[1].waypoints[0].y=40;
    expect(detectWaypointMove(serializeProject(original),both)).toBeNull();
    const topology=structuredClone(original);
    topology.geometry.segments[0].toStationId='changed';
    topology.geometry.segments[1].waypoints[0].x=44;
    expect(detectWaypointMove(serializeProject(original),topology)).toBeNull();
    const replace=structuredClone(original);
    replace.geometry.segments[0].waypoints.push({id:'new',x:0,y:0,type:'corner'});
    expect(detectWaypointMove(serializeProject(original),replace)).toBeNull();
  });
});
