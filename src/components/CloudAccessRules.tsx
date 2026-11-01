import { useEffect, useState } from 'react';
import { cloudApi, type CloudAccessRule } from '../data/cloudProjectApi';

export function CloudAccessRules({ projectId }: { projectId: string }) {
  const [rules, setRules] = useState<CloudAccessRule[]>([]);
  const [username, setUsername] = useState('');
  const [action, setAction] = useState<'view' | 'edit'>('edit');
  const [allowed, setAllowed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let mounted = true;
    void cloudApi.accessRules(projectId).then(items => {
      if (mounted) setRules(items);
    }).catch(e => { if (mounted) setError(e instanceof Error ? e.message : '无法加载授权'); });
    return () => { mounted = false; };
  }, [projectId]);

  async function perform(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await work();
      setRules(await cloudApi.accessRules(projectId));
      setNotice('授权设置已更新');
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新授权失败');
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="指定用户授权" style={{ padding: 12, border: '1px solid var(--border, #7775)', borderRadius: 8 }}>
    <h4>指定用户授权</h4>
    <p>输入已注册账号的用户名直接授权，无需发送邀请或等待接受。
      单独的拒绝规则会覆盖工程的公开权限，编辑授权默认也允许查看；若明确拒绝查看，则编辑也会被拒绝。</p>
    <div className="project-library-actions">
      <label>用户名 <input aria-label="授权用户名" value={username} maxLength={40}
        onChange={e => setUsername(e.target.value)} /></label>
      <label>操作 <select aria-label="授权操作" value={action}
        onChange={e => setAction(e.target.value as 'view' | 'edit')}>
        <option value="view">查看工程</option>
        <option value="edit">编辑工程</option>
      </select></label>
      <label>权限 <select aria-label="授权结果" value={String(allowed)}
        onChange={e => setAllowed(e.target.value === 'true')}>
        <option value="true">允许</option>
        <option value="false">拒绝</option>
      </select></label>
      <button type="button" disabled={busy || username.trim().length === 0}
        onClick={() => void perform(async () => {
          await cloudApi.setAccessRule(projectId, username.trim(), action, allowed);
          setUsername('');
        })}>保存授权</button>
    </div>
    {rules.length === 0 ? <p>暂无单独授权。当前由工程公开权限决定访问资格。</p> :
      <div className="project-library-list">
        {rules.map(rule => <div key={rule.id} className="project-library-item">
          <span>{rule.username} · {rule.action === 'view' ? '查看' : '编辑'} · {rule.allowed ? '允许' : '拒绝'}</span>
          <button type="button" disabled={busy} onClick={() => void perform(async () => {
            await cloudApi.deleteAccessRule(projectId, rule.id);
          })}>撤销规则</button>
        </div>)}
      </div>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
