import { useEffect, useState } from 'react';
import { cloudApi, type CloudCollaborator } from '../data/cloudProjectApi';

export function CloudMembers({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<CloudCollaborator[]>([]);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh() { setItems(await cloudApi.members(projectId)); }
  useEffect(() => {
    let active = true;
    void cloudApi.members(projectId).then(m => { if (active) setItems(m); })
      .catch(e => { if(active) setError(e instanceof Error ? e.message : '获取成员失败'); });
    return () => { active = false; };
  }, [projectId]);
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await fn(); await refresh(); }
    catch(e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); }
  }
  return <section aria-label="协作成员" style={{ padding: 10, border: '1px solid #7775', borderRadius: 8 }}>
    <strong>协作成员</strong>
    <p>仅工程所有者能邀请或移除成员。被邀请的账号可查看和发布共享工程版本。</p>
    {items.map(item => <div key={item.userId}>
      {item.username} · {item.role === 'owner' ? '所有者' : '协作者'}
      {item.role !== 'owner' && <button type="button" disabled={busy} onClick={() => void act(async () => {
        if (!window.confirm('移除协作者「' + item.username + '」？')) return;
        await cloudApi.removeMember(projectId, item.userId);
      })}>移除</button>}
    </div>)}
    <label>邀请用户名 <input aria-label="邀请协作用户名" value={username} maxLength={40} onChange={e => setUsername(e.target.value)}/></label>
    <button type="button" disabled={busy || !username.trim()} onClick={() => void act(async () => {
      await cloudApi.invite(projectId, username.trim()); setUsername('');
    })}>添加协作者</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
