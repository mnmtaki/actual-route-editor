import { useEffect, useState } from 'react';
import { CloudRevisionHistory } from './CloudRevisionHistory';
import { CloudAccessRules } from './CloudAccessRules';
import type { ActualRouteProject } from '../data/model';
import { cloudApi, CloudApiError, type CloudProjectSummary } from '../data/cloudProjectApi';

export function CloudProjects({ currentProject, importAsLocalCopy, onOpenCollaborative }: {
  currentProject: ActualRouteProject;
  importAsLocalCopy: (project: ActualRouteProject) => void;
  onOpenCollaborative: (id: string) => void;
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
  const [rulesId, setRulesId] = useState<string | null>(null);
  const [publicItems, setPublicItems] = useState<CloudProjectSummary[]>([]);
  const [publicOpen, setPublicOpen] = useState(false);
  const [linkText, setLinkText] = useState('');

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
  const modes = { private: '私有', public_view: '公开浏览', public_edit: '公开协作' };
  function shareUrl(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('cloudProject', id);
    return url.toString();
  }
  async function openLink() {
    const id = linkText.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)?.[0];
    if (!id) throw new Error('请输入有效的工程链接或 ID');
    const remote = await cloudApi.get(id);
    importAsLocalCopy(remote.document);
    setNotice('已打开共享工程的本地副本');
  }

  return (
    <section aria-label="云端工程库" style={{ borderTop: '1px solid var(--border, #7775)', marginTop: 16, paddingTop: 12 }}>
      <h3>云端存档（Java 后端）</h3>
      <p>工程可设置公开权限，也可给指定账号单独允许或拒绝查看和编辑，无需邀请流程。</p>
      <div className="project-library-actions">
        <label>分享链接或工程 ID <input aria-label="共享工程链接" value={linkText} onChange={e => setLinkText(e.target.value)} /></label>
        <button type="button" disabled={busy || !linkText.trim()} onClick={() => void action(openLink)}>查看工程</button>
        <button type="button" disabled={busy} onClick={() => void action(async () => {
          setPublicItems(await cloudApi.publicProjects());
          setPublicOpen(true);
        })}>发现公开工程</button>
      </div>
      {publicOpen && <div className="project-library-list">
        {publicItems.length === 0 && <p>暂无公开工程</p>}
        {publicItems.map(item => <article className="project-library-item" key={item.id}>
          <div><strong>{item.name}</strong><small>{modes[item.visibility]} · v{item.revision}</small></div>
          <div className="project-library-item-actions">
            <button type="button" disabled={busy} onClick={() => void action(async () => {
              const remote = await cloudApi.get(item.id);
              importAsLocalCopy(remote.document);
            })}>查看本地副本</button>
            {loggedIn && item.visibility === 'public_edit' &&
              <button type="button" disabled={busy} onClick={() => onOpenCollaborative(item.id)}>协同编辑</button>}
          </div>
        </article>)}
      </div>}
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
                <div><strong>{item.name}</strong><small>{modes[item.visibility]} · 云端版本 v{item.revision} · {new Date(item.updatedAt).toLocaleString()}</small></div>
                <div className="project-library-item-actions">
                  <button type="button" disabled={busy} onClick={() => void action(async () => {
                    const loaded = await cloudApi.get(item.id);
                    importAsLocalCopy(loaded.document);
                    setNotice('云端存档已导入为新的本地工程');
                  })}>导入为本地副本</button>
                  {item.canEdit && <button type="button" disabled={busy} onClick={() => onOpenCollaborative(item.id)}>进入协同编辑</button>}
                  {item.role === 'owner' && <button type="button" disabled={busy} onClick={() => void action(async () => {
                    if (!window.confirm('将当前编辑器工程覆盖此云端存档？本地工程不会改变。')) return;
                    await cloudApi.update(item.id, item.revision, currentProject);
                    await refresh();
                    setNotice('云存档已更新');
                  })}>用当前工程覆盖</button>}
                  <button type="button" disabled={busy} onClick={() => setHistoryId(current => current === item.id ? null : item.id)}>{historyId === item.id ? '收起历史' : '历史版本'}</button>
                  {item.role === 'owner' && <label>访问权限
                    <select value={item.visibility} aria-label={item.name + '访问权限'} disabled={busy}
                      onChange={e => void action(async () => {
                        const visibility = e.target.value as CloudProjectSummary['visibility'];
                        if (visibility === 'public_edit' && !window.confirm('任何已登录用户均可修改此工程，确定开放协作吗？')) return;
                        await cloudApi.setVisibility(item.id, visibility);
                        await refresh();
                        setNotice('访问权限已更新');
                      })}>
                      <option value="private">私有</option>
                      <option value="public_view">公开浏览</option>
                      <option value="public_edit">公开协作</option>
                    </select>
                  </label>}
                  {item.visibility !== 'private' && <button type="button" disabled={busy} onClick={() => void action(async () => {
                    await navigator.clipboard.writeText(shareUrl(item.id));
                    setNotice('分享链接已复制');
                  })}>复制分享链接</button>}
                  {item.role === 'owner' && <button type="button" disabled={busy} onClick={() => setRulesId(current => current === item.id ? null : item.id)}>{rulesId === item.id ? '收起授权' : '指定用户授权'}</button>}
                  {item.role === 'owner' && <button type="button" disabled={busy} onClick={() => void action(async () => {
                    if (!window.confirm(`永久删除云端存档「${item.name}」？`)) return;
                    await cloudApi.delete(item.id);
                    await refresh();
                  })}>删除云存档</button>}
                </div>
              </article>
              {rulesId === item.id && item.role === 'owner' && <CloudAccessRules projectId={item.id} />}
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
