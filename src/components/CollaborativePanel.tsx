import { useEffect, useRef, useState } from 'react';
import type { ActualRouteProject } from '../data/model';
import { serializeProject } from '../import-export/projectJson';
import { cloudApi, CloudApiError } from '../data/cloudProjectApi';

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
  const [disconnected, setDisconnected] = useState(false);
  const latest = useRef(project);
  latest.current = project;
  const dirty = serializeProject(project) !== session.baseJson;

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const remote = await cloudApi.get(session.id);
        if (!active) return;
        setRemoteRevision(remote.revision);
        setDisconnected(false);
      } catch (e) {
        if (active) {
          setDisconnected(true);
          setError(e instanceof Error ? e.message : '检查远端版本失败');
        }
      }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session.id]);

  async function publish() {
    if (busy || remoteRevision > session.revision || !dirty) return;
    setBusy(true); setError(''); setMessage('');
    try {
      // Freeze the document being submitted to avoid confusing a later edit
      // with a successful save of an earlier snapshot.
      const snapshot = latest.current;
      const json = serializeProject(snapshot);
      const saved = await cloudApi.update(session.id, session.revision, snapshot);
      onUpdate({ ...session, name: saved.name, revision: saved.revision, baseJson: json });
      setRemoteRevision(saved.revision);
      setMessage('已发布 v' + saved.revision + '；其他协作者会看到更新提示');
    } catch (e) {
      if (e instanceof CloudApiError && e.status === 409) {
        setRemoteRevision(current => Math.max(current, session.revision + 1));
        setError('发布冲突：其他人先保存了新版本。你的修改仍在本地，请另存本地副本，或放弃本地改动后加载最新版。');
      } else setError(e instanceof Error ? e.message : '发布失败');
    } finally { setBusy(false); }
  }

  async function pull() {
    if (busy) return;
    if (dirty && !window.confirm('加载云端最新版会替换当前协同工作副本。未发布的更改仍可能存在于本地自动存档，但建议先导出 JSON 备份。确定继续吗？')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const remote = await cloudApi.get(session.id);
      onLoad(remote.document, { id: session.id, name: remote.name, revision: remote.revision, baseJson: serializeProject(remote.document) });
      setRemoteRevision(remote.revision);
      setMessage('已加载云端 v' + remote.revision);
    } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); }
    finally { setBusy(false); }
  }
  return <section aria-label="协同工作区" className="creation-banner"
    style={{ position: 'relative', margin: '8px', padding: '10px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <strong>协同编辑 · {session.name}</strong>
    <span>本地基线 v{session.revision} · 远端 v{remoteRevision}</span>
    <span>{dirty ? '● 未发布修改' : '✓ 与已加载版本一致'}</span>
    <span>{disconnected ? '网络检查失败' : remoteRevision > session.revision ? '有新版本待加载' : '每 4 秒检查更新'}</span>
    <button type="button" disabled={busy || !dirty || remoteRevision > session.revision} onClick={() => void publish()}>发布当前画布</button>
    <button type="button" disabled={busy} onClick={() => void pull()}>加载云端最新版</button>
    <button type="button" disabled={busy} onClick={onExit}>退出协同模式</button>
    {error && <p role="alert" style={{ width: '100%' }}>{error}</p>}
    {message && <p role="status" style={{ width: '100%' }}>{message}</p>}
    <small style={{ width: '100%' }}>初版按完整工程提交，不会自动合并两人的修改；并发保存通过版本号阻止互相覆盖。离开后保留当前本地副本。</small>
  </section>;
}
