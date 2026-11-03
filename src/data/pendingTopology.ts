import type { CloudLineCompound, CloudLoopClose, CloudNewLine, CloudNewLineStation, CloudLineAppend, CloudSegmentSplit, CloudMiddleStationRemoval } from './cloudProjectApi';

export type PendingTopologyOperation =
  | { kind: 'compound'; payload: CloudLineCompound }
  | { kind: 'loop-close'; payload: CloudLoopClose }
  | { kind: 'new-line'; payload: CloudNewLine }
  | { kind: 'new-station'; payload: CloudNewLineStation }
  | { kind: 'append'; payload: CloudLineAppend }
  | { kind: 'split'; payload: CloudSegmentSplit }
  | { kind: 'remove'; payload: CloudMiddleStationRemoval };

export interface PendingTopologyWrite {
  projectId: string;
  snapshot: string;
  operation: PendingTopologyOperation;
  confirmed?: boolean;
}

// sessionStorage isolates two tabs editing the same cloud project, while
// preserving uncertain requests across a refresh in the originating tab.
const PREFIX = 'ara:pending-topology:v2:';
const LEGACY_PREFIX = 'ara:pending-topology:v1:';
const MAX_BYTES = 1_000_000;
const key = (projectId: string) => PREFIX + projectId;

/**
 * Persist BEFORE sending. At most one uncertain topology mutation per editor
 * tab/project is allowed, preventing a new operation from superseding a request
 * whose outcome is unknown. Never store cookies or authentication tokens.
 */
export function pendingTopologyRead(projectId: string, store: Pick<Storage, 'getItem'> = sessionStorage):
  PendingTopologyWrite | null {
  try {
    let raw = store.getItem(key(projectId));
    // Upgrade a previously in-flight v1 localStorage request. The first
    // tab opening the project adopts the legacy journal; later tabs get
    // separate v2 sessionStorage outboxes.
    if (!raw && typeof sessionStorage !== 'undefined' &&
        store === sessionStorage && typeof localStorage !== 'undefined') {
      const legacyKey = LEGACY_PREFIX + projectId;
      const legacy = localStorage.getItem(legacyKey);
      if (legacy) {
        if (legacy.length > MAX_BYTES) return null;
        const migrated = JSON.parse(legacy) as PendingTopologyWrite;
        if (migrated.projectId !== projectId ||
            !migrated.operation?.payload?.operationId) return null;
        sessionStorage.setItem(key(projectId), legacy);
        localStorage.removeItem(legacyKey);
        raw = legacy;
      }
    }
    if (!raw || raw.length > MAX_BYTES) return null;
    const value = JSON.parse(raw) as PendingTopologyWrite;
    if (value.projectId !== projectId || typeof value.snapshot !== 'string' ||
        !value.operation || !['compound', 'loop-close', 'new-line', 'new-station', 'append', 'split', 'remove'].includes(value.operation.kind) ||
        typeof value.operation.payload?.operationId !== 'string' ||
        typeof value.operation.payload.expectedRevision !== 'number') return null;
    return value;
  } catch { return null; }
}

export function pendingTopologySave(value: PendingTopologyWrite,
  store: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage): boolean {
  try {
    const rawPending = store.getItem(key(value.projectId));
    // An invalid legacy journal may contain an unacknowledged mutation.
    // Fail closed instead of creating a new operation that could replay it.
    if (typeof sessionStorage !== 'undefined' && store === sessionStorage &&
        typeof localStorage !== 'undefined' &&
        localStorage.getItem(LEGACY_PREFIX + value.projectId)) return false;
    const current = pendingTopologyRead(value.projectId, store);
    if (rawPending && !current) return false; // Corrupt journal: fail closed.
    if (current && current.operation.payload.operationId !== value.operation.payload.operationId)
      return false;
    const raw = JSON.stringify(value);
    if (raw.length > MAX_BYTES) return false;
    store.setItem(key(value.projectId), raw);
    return true;
  } catch { return false; }
}

export function pendingTopologyClear(projectId: string, operationId: string,
  store: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage): void {
  try {
    if (pendingTopologyRead(projectId, store)?.operation.payload.operationId === operationId)
      store.removeItem(key(projectId));
  } catch { /* Best effort; stale IDs remain safe to replay. */ }
}

/** Mark a committed request without discarding its local recovery snapshot. */
export function pendingTopologyConfirm(projectId: string, operationId: string,
  store: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage): void {
  const existing = pendingTopologyRead(projectId, store);
  if (existing?.operation.payload.operationId === operationId) {
    pendingTopologySave({ ...existing, confirmed: true }, store);
  }
}
