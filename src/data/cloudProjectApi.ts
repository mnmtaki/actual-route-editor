import type { ActualRouteProject } from './model';
import { parseProjectJson, serializeProject } from '../import-export/projectJson';

const API_BASE = (import.meta.env.VITE_ARA_API_URL || 'http://localhost:8080').replace(/\/$/, '');

export interface CloudProjectSummary {
  id: string; name: string; revision: number; updatedAt: string;
}
export interface CloudProject extends CloudProjectSummary {
  document: ActualRouteProject;
}
type AuthResult = { accessToken: string; tokenType: string };

export class CloudApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

async function api<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(API_BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
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
    api<AuthResult>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
    }),
  logout: (token: string) =>
    api<{ status: string }>('/api/auth/logout', { method: 'POST' }, token),
  list: (token: string) => api<CloudProjectSummary[]>('/api/projects', {}, token),
  get: async (token: string, id: string) => {
    const raw = await api<{ id: string; name: string; revision: number; updatedAt: string; document: unknown }>(
      `/api/projects/${encodeURIComponent(id)}`, {}, token,
    );
    return { ...raw, document: parseProjectJson(JSON.stringify(raw.document)) } as CloudProject;
  },
  create: (token: string, project: ActualRouteProject) =>
    api<CloudProjectSummary>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: project.projectName || project.name, document: JSON.parse(serializeProject(project)) }),
    }, token),
  update: (token: string, id: string, revision: number, project: ActualRouteProject) =>
    api<CloudProjectSummary>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: project.projectName || project.name,
        document: JSON.parse(serializeProject(project)),
        expectedRevision: revision,
      }),
    }, token),
  delete: (token: string, id: string) =>
    api<void>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }, token),
};
