import { describe, expect, it } from 'vitest';
import {
  pendingTopologyRead, pendingTopologySave, pendingTopologyClear, pendingTopologyConfirm,
  type PendingTopologyWrite,
} from './pendingTopology';

function memoryStore() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const pending = (id: string, operationId = 'stable-operation'): PendingTopologyWrite => ({
  projectId: id,
  snapshot: '{"version":1,"name":"unsent"}',
  operation: {
    kind: 'append',
    payload: {
      operationId, expectedRevision: 8,
      lineId: 'line-a', fromStationId: 'a', toStationId: 'b',
      segmentId: 'ab', relationId: 'rab',
    },
  },
});

describe('persisted topology outbox', () => {
  it('survives re-reading and retains the exact operation ID, payload and snapshot', () => {
    const store = memoryStore();
    const value = pending('project-a');
    expect(pendingTopologySave(value, store)).toBe(true);
    expect(pendingTopologyRead('project-a', store)).toEqual(value);
    expect(pendingTopologyRead('project-b', store)).toBeNull();
  });

  it('blocks a new operation while an earlier outcome is uncertain', () => {
    const store = memoryStore();
    expect(pendingTopologySave(pending('project-a'), store)).toBe(true);
    expect(pendingTopologySave(pending('project-a', 'different-operation'), store)).toBe(false);
    expect(pendingTopologyRead('project-a', store)?.operation.payload.operationId)
      .toBe('stable-operation');
  });

  it('clears only the acknowledged operation and not a newer pending mutation', () => {
    const store = memoryStore();
    expect(pendingTopologySave(pending('project-a'), store)).toBe(true);
    pendingTopologyClear('project-a', 'wrong-operation', store);
    expect(pendingTopologyRead('project-a', store)).not.toBeNull();
    pendingTopologyClear('project-a', 'stable-operation', store);
    expect(pendingTopologyRead('project-a', store)).toBeNull();
    expect(pendingTopologySave(pending('project-a', 'second'), store)).toBe(true);
  });

  it('rejects oversized or malformed persisted data without crashing', () => {
    const store = memoryStore();
    store.setItem('ara:pending-topology:v2:project-a', '{bad');
    expect(pendingTopologyRead('project-a', store)).toBeNull();
    expect(pendingTopologySave({...pending('project-a'), snapshot: 'x'.repeat(1_000_100)}, store))
      .toBe(false);
  });

  it('retains confirmed divergent snapshots until a matching explicit clear', () => {
    const store = memoryStore();
    expect(pendingTopologySave(pending('project-a'), store)).toBe(true);
    pendingTopologyConfirm('project-a', 'stable-operation', store);
    expect(pendingTopologyRead('project-a', store)).toEqual({
      ...pending('project-a'), confirmed: true,
    });
    expect(pendingTopologySave(pending('project-a', 'second'), store)).toBe(false);
    pendingTopologyClear('project-a', 'stable-operation', store);
    expect(pendingTopologyRead('project-a', store)).toBeNull();
  });

  it('does not overwrite an unreadable existing journal', () => {
    const store = memoryStore();
    store.setItem('ara:pending-topology:v2:project-a', '{bad');
    expect(pendingTopologySave(pending('project-a'), store)).toBe(false);
  });

  it('isolates identical projects in independent tab stores', () => {
    const tabA=memoryStore();
    const tabB=memoryStore();
    expect(pendingTopologySave(pending('project-a','editor-A'),tabA)).toBe(true);
    expect(pendingTopologySave(pending('project-a','editor-B'),tabB)).toBe(true);
    expect(pendingTopologyRead('project-a',tabA)?.operation.payload.operationId)
      .toBe('editor-A');
    expect(pendingTopologyRead('project-a',tabB)?.operation.payload.operationId)
      .toBe('editor-B');
  });

  it('fails closed if local storage throws rather than submitting an unjournaled operation', () => {
    const broken = {
      getItem: (_key: string) => null,
      setItem: (_key: string, _value: string): void => { throw Error('storage disabled'); },
      removeItem: (_key: string): void => { throw Error('storage disabled'); },
    };
    expect(pendingTopologySave(pending('project-a'), broken)).toBe(false);
  });
});
