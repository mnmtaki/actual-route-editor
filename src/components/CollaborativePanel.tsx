import { useEffect, useRef, useState } from 'react';
import type { ActualRouteProject } from '../data/model';
import { serializeProject } from '../import-export/projectJson';
import { cloudApi, cloudSocketUrl, CloudApiError } from '../data/cloudProjectApi';

export interface CollaborativeSession {
  id: string;
  name: string;
  revision: number;
  baseJson: string;
}

export function CollaborativePanel({ session, project, onUpdate, onLoad, onExit }: {
  session: CollaborativeSession;
  project: ActualRouteProject;
  onUpdate: (next: CollaborativeSession) => void;
  onLoad: (project: ActualRouteProject, next: CollaborativeSession) => void;
  onExit: () => void;
}) {
  const [remoteRevision, setRemoteRevision] = useState(session.revision);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [permissionLost, setPermissionLost] = useState(false);

  const latest = useRef(project);
  const activeSession = useRef(session);
  const onLoadRef = useRef(onLoad);
  const working = useRef(false);
  const fetching = useRef(false);
  latest.current = project;
  activeSession.current = session;
  onLoadRef.current = onLoad;

  const dirty = serializeProject(project) !== session.baseJson;

  useEffect(() => {
    let alive = true;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let pingTimer: number | undefined;
    let retryMs = 1000;
    const permissionLostRef = { current: false };
    setRemoteRevision(session.revision);
    setConnected(false);
    setPermissionLost(false);

    async function receiveRevision(revision: number) {
      if (!alive || !Number.isSafeInteger(revision) || revision < 1) return;
      setRemoteRevision(previous => Math.max(previous, revision));
      const current = activeSession.current;
      if (revision <= current.revision || working.current || fetching.current) return;
      // Never replace local unsaved drawings, even for disjoint changes.
      if (serializeProject(latest.current) !== current.baseJson) {
        setMessage('云端有新版本；当前画布有未发布修改，已保留，请手动处理冲突');
        return;
      }
      fetching.current = true;
      try {
        const remote = await cloudApi.get(current.id);
        if (!alive || activeSession.current.id !== current.id) return;
        setRemoteRevision(previous => Math.max(previous, remote.revision));
        const newest = activeSession.current;
        if (remote.revision <= newest.revision) return;
        // Recheck after the async request: the user may have started drawing.
        if (working.current || serializeProject(latest.current) !== newest.baseJson) {
          setMessage('云端有新版本；加载期间画布发生变化，未覆盖本地');
          return;
        }
        const next = {
          id: newest.id, name: remote.name, revision: remote.revision,
          baseJson: serializeProject(remote.document),
        };
        activeSession.current = next;
        onLoadRef.current(remote.document, next);
        setMessage('已实时同步云端 v' + remote.revision);
        setError('');
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '自动获取远端工程失败');
      } finally {
        fetching.current = false;
      }
    }

    async function checkRemote() {
      try {
        const status = await cloudApi.status(session.id);
        if (!alive) return;
        if (!status.canEdit) {
          permissionLostRef.current = true;
          setPermissionLost(true);
          setError('当前账号已失去协作编辑权限；本地副本仍保留');
          socket?.close(1000, 'Permission changed');
          return;
        }
        await receiveRevision(status.revision);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '检查远端版本失败');
      }
    }

    function connect() {
      if (!alive || typeof WebSocket === 'undefined' || permissionLostRef.current) return;
      try {
        socket = new WebSocket(cloudSocketUrl(session.id));
      } catch {
        setConnected(false);
        return;
      }
      socket.onopen = () => {
        if (!alive) return;
        setConnected(true);
        setError('');
        retryMs = 1000;
        void checkRemote();
        if (pingTimer !== undefined) window.clearInterval(pingTimer);
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send('ping');
        }, 30000);
      };
      socket.onmessage = event => {
        try {
          const payload = JSON.parse(String(event.data)) as {
            type?: string; revision?: number; projectId?: string;
          };
          if (payload.type === 'revision' && payload.projectId === session.id
              && typeof payload.revision === 'number') {
            void receiveRevision(payload.revision);
          }
        } catch { /* Ignore malformed server messages. */ }
      };
      socket.onerror = () => {
        if (alive) setConnected(false);
      };
      socket.onclose = event => {
        if (!alive) return;
        setConnected(false);
        if (pingTimer !== undefined) window.clearInterval(pingTimer);
        if (event.code === 1008 || permissionLostRef.current) {
          permissionLostRef.current = true;
          setPermissionLost(true);
          setError('协作权限或登录会话已失效，已停止实时连接');
          return;
        }
        retryTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30000);
      };
    }

    // A lightweight, infrequent fallback catches missed events, server
    // restarts and permission changes. It does not fetch full map JSON unless
    // an unseen newer revision exists.
    void checkRemote();
    connect();
    const poll = window.setInterval(() => { void checkRemote(); }, 30000);
    return () => {
      alive = false;
      window.clearInterval(poll);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (pingTimer !== undefined) window.clearInterval(pingTimer);
      socket?.close();
    };
  }, [session.id]);

  async function publish() {
    if (busy || permissionLost || remoteRevision > session.revision || !dirty) return;
    working.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      const snapshot = latest.current;
      const json = serializeProject(snapshot);
      const saved = await cloudApi.update(session.id, session.revision, snapshot);
      const next = { ...session, name: saved.name, revision: saved.revision, baseJson: json };
      activeSession.current = next;
      onUpdate(next);
      setRemoteRevision(saved.revision);
      setMessage('已发布 v' + saved.revision + '，其他在线协作者会立即收到通知');
    } catch (e) {
      if (e instanceof CloudApiError && e.status === 409) {
        setRemoteRevision(previous => Math.max(previous, session.revision + 1));
        setError('发布冲突：已有其他人保存新版本。本地修改已保留，请先导出备份，或手动加载云端最新版。');
      } else {
        if (e instanceof CloudApiError && (e.status === 403 || e.status === 404))
          setPermissionLost(true);
        setError(e instanceof Error ? e.message : '发布失败');
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function pull() {
    if (busy) return;
    if (dirty && !window.confirm('加载云端最新版会替换当前协同工作副本。请先导出未发布修改的 JSON 备份，确定继续吗？')) return;
    working.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      const remote = await cloudApi.get(session.id);
      const next = {
        id: session.id, name: remote.name, revision: remote.revision,
        baseJson: serializeProject(remote.document),
      };
      activeSession.current = next;
      onLoad(remote.document, next);
      setRemoteRevision(remote.revision);
      setMessage('已加载云端 v' + remote.revision);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return <section aria-label="协同工作区" className="creation-banner"
    style={{ position: 'relative', margin: '8px', padding: '10px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <strong>协同编辑 · {session.name}</strong>
    <span>本地基线 v{session.revision} · 远端 v{remoteRevision}</span>
    <span>{dirty ? '● 未发布修改' : '✓ 与已加载版本一致'}</span>
    <span>{permissionLost ? '协作权限已失效' : connected ? 'WebSocket 已连接' : '实时连接中断 · 30 秒兜底检查'}</span>
    <button type="button" disabled={busy || permissionLost || !dirty || remoteRevision > session.revision} onClick={() => void publish()}>发布当前画布</button>
    <button type="button" disabled={busy} onClick={() => void pull()}>加载云端最新版</button>
    <button type="button" disabled={busy} onClick={onExit}>退出协同模式</button>
    {error && <p role="alert" style={{ width: '100%' }}>{error}</p>}
    {message && <p role="status" style={{ width: '100%' }}>{message}</p>}
    <small style={{ width: '100%' }}>发布后实时通知其他在线协作者；仅在对方没有未发布修改时自动加载。尚未实现逐操作合并与鼠标位置同步。</small>
  </section>;
}
