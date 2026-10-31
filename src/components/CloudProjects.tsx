import { useState } from 'react';
import type { ActualRouteProject } from '../data/model';
import { cloudApi, type CloudProjectSummary } from '../data/cloudProjectApi';

export function CloudProjects({ currentProject, importAsLocalCopy }: {
  currentProject: ActualRouteProject;
  importAsLocalCopy: (project: ActualRouteProject) => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [items, setItems] = useState<CloudProjectSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (e) { setError(e instanceof Error ? e.message : '云端操作失败'); }
    finally { setBusy(false); }
  }

  async function refresh(auth: string) {
    setItems(await cloudApi.list(auth));
  }

  const authenticated = token !== null;
  return (
    <section aria-label="云端工程库" style={{ borderTop: '1px solid var(--border, #7775)', marginTop: 16, paddingTop: 12 }}>
      <h3>云端存档（Java 后端）</h3>
      <p>独立于本地工程库。上传或下载均为手动操作，不会自动覆盖本地存档。</p>
      {!authenticated ? (
        <div>
          <label>用户名 <input aria-label="云端用户名" value={username} maxLength={40} autoComplete="username" onChange={e => setUsername(e.target.value)}/></label>
          <label>密码 <input aria-label="云端密码" value={password} type="password" autoComplete="current-password" onChange={e => setPassword(e.target.value)}/></label>
          <div className="project-library-actions">
            <button type="button" disabled={busy} onClick={() => void action(async () => {
              const result = await cloudApi.login(username, password);
              setToken(result.accessToken);
              setPassword('');
              await refresh(result.accessToken);
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
              await cloudApi.create(token, currentProject);
              await refresh(token);
              setNotice('当前工程已创建为新云端存档');
            })}>上传当前工程为新存档</button>
            <button type="button" disabled={busy} onClick={() => void action(async () => refresh(token))}>刷新列表</button>
            <button type="button" disabled={busy} onClick={() => void action(async () => {
              await cloudApi.logout(token);
              setToken(null); setItems([]);
            })}>退出登录</button>
          </div>
          <div className="project-library-list">
            {items.length === 0 && <p>还没有云端存档。</p>}
            {items.map(item => (
              <article className="project-library-item" key={item.id}>
                <div><strong>{item.name}</strong><small>云端版本 v{item.revision} · {new Date(item.updatedAt).toLocaleString()}</small></div>
                <div className="project-library-item-actions">
                  <button type="button" disabled={busy} onClick={() => void action(async () => {
                    const loaded = await cloudApi.get(token, item.id);
                    importAsLocalCopy(loaded.document);
                    setNotice('云端存档已导入为新的本地工程');
                  })}>导入为本地副本</button>
                  <button type="button" disabled={busy} onClick={() => void action(async () => {
                    if (!window.confirm('将当前编辑器工程覆盖此云端存档？本地工程不会改变。')) return;
                    await cloudApi.update(token, item.id, item.revision, currentProject);
                    await refresh(token);
                    setNotice('云存档已更新');
                  })}>用当前工程覆盖</button>
                  <button type="button" disabled={busy} onClick={() => void action(async () => {
                    if (!window.confirm(`永久删除云端存档「${item.name}」？`)) return;
                    await cloudApi.delete(token, item.id);
                    await refresh(token);
                  })}>删除云存档</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      {error && <p role="alert" className="project-library-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <small>云端登录令牌仅保存在当前页面内存，刷新页面后需要重新登录。后端不可达时可继续使用本地存档。</small>
    </section>
  );
}
