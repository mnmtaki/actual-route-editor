import type { ActualRouteProject } from './model';
import { parseProjectJson, serializeProject } from '../import-export/projectJson';

const API_BASE = (import.meta.env.VITE_ARA_API_URL || 'http://localhost:8080').replace(/\/$/, '');

export interface CloudProjectSummary {
  id: string; name: string; revision: number; updatedAt: string;
}
export interface CloudProject extends CloudProjectSummary {
  document: ActualRouteProject;
}
export interface CloudIdentity { userId: string }
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
    const raw = await api<{ id: string; name: string; revision: number; updatedAt: string; document: unknown }>(
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
  delete: (id: string) =>
    api<void>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
