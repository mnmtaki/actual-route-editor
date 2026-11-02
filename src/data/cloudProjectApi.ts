import type { ActualRouteProject } from './model';
import { parseProjectJson, serializeProject } from '../import-export/projectJson';

const API_BASE = (import.meta.env.VITE_ARA_API_URL || 'http://localhost:8080').replace(/\/$/, '');

export interface CloudProjectSummary {
  id: string; name: string; revision: number; updatedAt: string; role: 'owner' | 'viewer'; visibility: 'private' | 'public_view' | 'public_edit'; canEdit: boolean;
}
export interface CloudProject extends CloudProjectSummary {
  document: ActualRouteProject;
}
export interface CloudIdentity { userId: string }
export type CloudStationOperation = {
  operationId: string;
  expectedRevision: number;
  type: 'station.create' | 'station.rename' | 'station.move';
  station: { id: string; name?: string; x?: number; y?: number; nameS?: string; nameHistory?: unknown };
};
export interface CloudWaypointMove {
  operationId: string;
  expectedRevision: number;
  segmentId: string;
  waypointId: string;
  x: number;
  y: number;
}
export interface CloudNewLineStation {
  operationId: string;
  expectedRevision: number;
  lineId: string;
  fromStationId?: string | null;
  station: ActualRouteProject['stations'][number];
  relation: ActualRouteProject['stationLineRelations'][number];
  segment?: ActualRouteProject['geometry']['segments'][number] | null;
  openingPhaseId?: string;
}
export interface CloudLineAppend {
  operationId: string;
  expectedRevision: number;
  lineId: string;
  fromStationId: string;
  toStationId: string;
  segmentId: string;
  relationId: string;
  openingPhaseId?: string;
}
export interface CloudSegmentSplit {
  operationId: string;
  expectedRevision: number;
  segmentId: string;
  stationId: string;
  stationName: string;
  x: number;
  y: number;
  labelOffsetX?: number;
  labelOffsetY?: number;
  beforeSegmentId: string;
  afterSegmentId: string;
  relationId: string;
  splitWaypointIndex: number;
}
export interface CloudMiddleStationRemoval {
  operationId: string;
  expectedRevision: number;
  lineId: string;
  stationId: string;
  beforeSegmentId: string;
  afterSegmentId: string;
  mergedSegmentId: string;
  preservedWaypointId: string;
  canvasSemantics?: boolean;
}
export interface CloudOperationHistoryItem {
  operationId: string;
  revision: number;
  actorName: string;
  action: string;
  resourceId: string;
  createdAt: string;
}
export interface CloudUndoEntry {
  operationId: string;
  stationId: string;
  action: 'station.rename' | 'station.move';
  undone: boolean;
  stateRevision: number;
}
export interface CloudCompensation {
  operationId: string;
  targetOperationId: string;
  expectedRevision: number;
  direction: 'undo' | 'redo';
}
export interface CloudProjectStatus { id: string; name: string; revision: number; visibility: CloudProjectSummary['visibility']; canEdit: boolean }
export function cloudSocketUrl(id: string): string {
  return API_BASE.replace(/^http/i, 'ws') + '/ws/projects/' + encodeURIComponent(id);
}
export interface CloudAccessRule {
  id: string; userId: string; username: string;
  action: 'view' | 'edit'; allowed: boolean;
}
export interface CloudRevisionSummary { revision: number; name: string; createdAt: string }
export interface CloudRevision extends CloudRevisionSummary { document: ActualRouteProject }

export class CloudApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function csrfToken(): string | undefined {
  const cookie = document.cookie.split('; ').find(value => value.startsWith('ara_csrf='));
  return cookie ? decodeURIComponent(cookie.slice('ara_csrf='.length)) : undefined;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const csrf = !['GET', 'HEAD', 'OPTIONS'].includes(method) && path !== '/api/auth/login' && path !== '/api/auth/register'
    ? csrfToken() : undefined;
  const response = await fetch(API_BASE + path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf ? { 'X-ARA-CSRF': csrf } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string | { message?: string } };
    const detail = typeof body.detail === 'string' ? body.detail : body.detail?.message;
    throw new CloudApiError(response.status, detail || `请求失败 (HTTP ${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export const cloudApi = {
  register: (username: string, password: string) =>
    api<{ status: string }>('/api/auth/register', {
      method: 'POST', body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    api<{ status: string }>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
    }),
  me: () => api<CloudIdentity>('/api/auth/me'),
  logout: () => api<{ status: string }>('/api/auth/logout', { method: 'POST' }),
  list: () => api<CloudProjectSummary[]>('/api/projects'),
  get: async (id: string) => {
    const raw = await api<{ id: string; name: string; revision: number; updatedAt: string; visibility: CloudProjectSummary['visibility']; canEdit: boolean; document: unknown }>(
      `/api/projects/${encodeURIComponent(id)}`,
    );
    return { ...raw, document: parseProjectJson(JSON.stringify(raw.document)) } as CloudProject;
  },
  create: (project: ActualRouteProject) =>
    api<CloudProjectSummary>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: project.projectName || project.name, document: JSON.parse(serializeProject(project)) }),
    }),
  update: (id: string, revision: number, project: ActualRouteProject) =>
    api<CloudProjectSummary>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: project.projectName || project.name,
        document: JSON.parse(serializeProject(project)),
        expectedRevision: revision,
      }),
    }),
  revisions: (id: string) =>
    api<CloudRevisionSummary[]>(`/api/projects/${encodeURIComponent(id)}/revisions`),
  getRevision: async (id: string, revision: number) => {
    const raw = await api<{ revision: number; name: string; createdAt: string; document: unknown }>(
      `/api/projects/${encodeURIComponent(id)}/revisions/${revision}`,
    );
    return { ...raw, document: parseProjectJson(JSON.stringify(raw.document)) } as CloudRevision;
  },
  restoreRevision: (id: string, sourceRevision: number, expectedRevision: number) =>
    api<CloudProjectSummary>(`/api/projects/${encodeURIComponent(id)}/restore`, {
      method: 'POST', body: JSON.stringify({ sourceRevision, expectedRevision }),
    }),
  accessRules: (id: string) => api<CloudAccessRule[]>(`/api/projects/${encodeURIComponent(id)}/access-rules`),
  setAccessRule: (id: string, username: string, action: 'view' | 'edit', allowed: boolean) =>
    api<CloudAccessRule>(`/api/projects/${encodeURIComponent(id)}/access-rules`, {
      method: 'POST', body: JSON.stringify({ username, action, allowed }),
    }),
  deleteAccessRule: (id: string, ruleId: string) =>
    api<void>(`/api/projects/${encodeURIComponent(id)}/access-rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' }),
  stationOperation: async (id: string, operation: CloudStationOperation) => {
    const raw = await api<{ id: string; name: string; revision: number; updatedAt: string; visibility: CloudProjectSummary['visibility']; canEdit: boolean; document: unknown }>(
      `/api/projects/${encodeURIComponent(id)}/operations`, {
        method: 'POST', body: JSON.stringify(operation),
      },
    );
    return { ...raw, document: parseProjectJson(JSON.stringify(raw.document)) } as CloudProject;
  },
  moveWaypoint: async (id: string, operation: CloudWaypointMove) => {
    const raw = await api<{ id: string; name: string; revision: number; updatedAt: string; visibility: CloudProjectSummary['visibility']; canEdit: boolean; document: unknown }>(
      `/api/projects/${encodeURIComponent(id)}/operations/waypoint`, {
        method: 'POST', body: JSON.stringify(operation),
      },
    );
    return { ...raw, document: parseProjectJson(JSON.stringify(raw.document)) } as CloudProject;
  },
  appendNewStation: async (id: string, operation: CloudNewLineStation) => {
    const raw = await api<{ id: string; name: string; revision: number; updatedAt: string; visibility: CloudProjectSummary['visibility']; canEdit: boolean; document: unknown }>(
      `/api/projects/${encodeURIComponent(id)}/operations/line-append-new`, {
        method: 'POST', body: JSON.stringify(operation),
      },
    );
    return { ...raw, document: parseProjectJson(JSON.stringify(raw.document)) } as CloudProject;
  },
  appendExistingStation: async (id: string, operation: CloudLineAppend) => {
    const raw = await api<{ id: string; name: string; revision: number; updatedAt: string; visibility: CloudProjectSummary['visibility']; canEdit: boolean; document: unknown }>(
      `/api/projects/${encodeURIComponent(id)}/operations/line-append`, {
        method: 'POST', body: JSON.stringify(operation),
      },
    );
    return { ...raw, document: parseProjectJson(JSON.stringify(raw.document)) } as CloudProject;
  },
  splitSegment: async (id: string, operation: CloudSegmentSplit) => {
    const raw = await api<{ id: string; name: string; revision: number; updatedAt: string; visibility: CloudProjectSummary['visibility']; canEdit: boolean; document: unknown }>(
      `/api/projects/${encodeURIComponent(id)}/operations/segment-split`, {
        method: 'POST', body: JSON.stringify(operation),
      },
    );
    return { ...raw, document: parseProjectJson(JSON.stringify(raw.document)) } as CloudProject;
  },
  removeMiddleStation: async (id: string, operation: CloudMiddleStationRemoval) => {
    const raw = await api<{ id: string; name: string; revision: number; updatedAt: string; visibility: CloudProjectSummary['visibility']; canEdit: boolean; document: unknown }>(
      `/api/projects/${encodeURIComponent(id)}/operations/remove-middle-station`, {
        method: 'POST', body: JSON.stringify(operation),
      },
    );
    return { ...raw, document: parseProjectJson(JSON.stringify(raw.document)) } as CloudProject;
  },
  operationHistory: (id: string, limit = 50) =>
    api<CloudOperationHistoryItem[]>(`/api/projects/${encodeURIComponent(id)}/operations/history?limit=${limit}`),
  myUndo: (id: string) =>
    api<CloudUndoEntry[]>(`/api/projects/${encodeURIComponent(id)}/operations/my-undo`),
  compensate: async (id: string, operation: CloudCompensation) => {
    const raw = await api<{ id: string; name: string; revision: number; updatedAt: string; visibility: CloudProjectSummary['visibility']; canEdit: boolean; document: unknown }>(
      `/api/projects/${encodeURIComponent(id)}/operations/compensate`, {
        method: 'POST', body: JSON.stringify(operation),
      },
    );
    return { ...raw, document: parseProjectJson(JSON.stringify(raw.document)) } as CloudProject;
  },
  status: (id: string) =>
    api<CloudProjectStatus>(`/api/projects/${encodeURIComponent(id)}/status`),
  publicProjects: () => api<CloudProjectSummary[]>('/api/projects/public'),
  setVisibility: (id: string, visibility: CloudProjectSummary['visibility']) =>
    api<CloudProjectSummary>(`/api/projects/${encodeURIComponent(id)}/visibility`, {
      method: 'PUT', body: JSON.stringify({ visibility }),
    }),
  delete: (id: string) =>
    api<void>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
