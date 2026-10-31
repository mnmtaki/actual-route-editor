import { useEffect, useState } from 'react';
import { CloudRevisionHistory } from './CloudRevisionHistory';
import type { ActualRouteProject } from '../data/model';
import { cloudApi, CloudApiError, type CloudProjectSummary } from '../data/cloudProjectApi';

export function CloudProjects({ currentProject, importAsLocalCopy }: {
  currentProject: ActualRouteProject;
  importAsLocalCopy: (project: ActualRouteProject) => void;
}) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [items, setItems] = useState<CloudProjectSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [historyId, setHistoryId] = useState<string | null>(null);

  // The dialog is remounted when reopened. Its session is recovered from
  // the HttpOnly cookie; no credential is written to JavaScript storage.
  useEffect(() => {
    let active = true;
    void cloudApi.me().then(async () => {
      const projects = await cloudApi.list();
      if (active) { setItems(projects); setLoggedIn(true); }
    }).catch(error => {
      if (active && !(error instanceof CloudApiError && error.status === 401))
        setError(error instanceof Error ? error.message : '无法连接云端服务');
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (e) {
      if (e instanceof CloudApiError && e.status === 401) { setLoggedIn(false); setItems([]); }
      setError(e instanceof Error ? e.message : '云端操作失败');
    }
    finally { setBusy(false); }
  }

  async function refresh() { setItems(await cloudApi.list()); }

  return (
    <section aria-label="云端工程库" style={{ borderTop: '1px solid var(--border, #7775)', marginTop: 16, paddingTop: 12 }}>
      <h3>云端存档（Java 后端）</h3>
      <p>独立于本地工程库。上传或下载均为手动操作，不会自动覆盖本地存档。</p>
      {checking ? <p role="status">正在检查云端登录状态…</p> : !loggedIn ? (
        <div>
          <label>用户名 <input aria-label="云端用户名" value={username} maxLength={40} autoComplete="username" onChange={e => setUsername(e.target.value)}/></label>
          <label>密码 <input aria-label="云端密码" value={password} type="password" autoComplete="current-password" onChange={e => setPassword(e.target.value)}/></label>
          <div className="project-library-actions">
            <button type="button" disabled={busy} onClick={() => void action(async () => {
              await cloudApi.login(username, password);
              setPassword('');
              await refresh();
              setLoggedIn(true);
            })}>登录云存档</button>
            <button type="button" disabled={busy} onClick={() => void action(async () => {
              await cloudApi.register(username, password);
              setNotice('注册成功，请登录');
            })}>注册账号</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="project-library-actions">
            <button type="button" disabled={busy} onClick={() => void action(async () => {
              await cloudApi.create(currentProject);
              await refresh();
              setNotice('当前工程已创建为新云端存档');
            })}>上传当前工程为新存档</button>
            <button type="button" disabled={busy} onClick={() => void action(refresh)}>刷新列表</button>
            <button type="button" disabled={busy} onClick={() => void action(async () => {
              await cloudApi.logout();
              setLoggedIn(false); setItems([]);
            })}>退出登录</button>
          </div>
          <div className="project-library-list">
            {items.length === 0 && <p>还没有云端存档。</p>}
            {items.map(item => (
              <div key={item.id}><article className="project-library-item">
                <div><strong>{item.name}</strong><small>云端版本 v{item.revision} · {new Date(item.updatedAt).toLocaleString()}</small></div>
                <div className="project-library-item-actions">
                  <button type="button" disabled={busy} onClick={() => void action(async () => {
                    const loaded = await cloudApi.get(item.id);
                    importAsLocalCopy(loaded.document);
                    setNotice('云端存档已导入为新的本地工程');
                  })}>导入为本地副本</button>
                  <button type="button" disabled={busy} onClick={() => void action(async () => {
                    if (!window.confirm('将当前编辑器工程覆盖此云端存档？本地工程不会改变。')) return;
                    await cloudApi.update(item.id, item.revision, currentProject);
                    await refresh();
                    setNotice('云存档已更新');
                  })}>用当前工程覆盖</button>
                  <button type="button" disabled={busy} onClick={() => setHistoryId(current => current === item.id ? null : item.id)}>{historyId === item.id ? '收起历史' : '历史版本'}</button>
                  <button type="button" disabled={busy} onClick={() => void action(async () => {
                    if (!window.confirm(`永久删除云端存档「${item.name}」？`)) return;
                    await cloudApi.delete(item.id);
                    await refresh();
                  })}>删除云存档</button>
                </div>
              </article>
              {historyId === item.id && <CloudRevisionHistory id={item.id} latestRevision={item.revision} onRestored={refresh} />}
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <p role="alert" className="project-library-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <small>登录状态通过安全 Cookie 保持至过期或退出。云端服务不可用时，本地工程库仍可正常使用。</small>
    </section>
  );
}
