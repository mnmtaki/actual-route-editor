import { useEffect, useState } from 'react';
import { cloudApi, type CloudRevisionSummary } from '../data/cloudProjectApi';
import { downloadText, serializeProject } from '../import-export/projectJson';

export function CloudRevisionHistory({ id, latestRevision, onRestored }: {
  id: string;
  latestRevision: number;
  onRestored: () => Promise<void>;
}) {
  const [versions, setVersions] = useState<CloudRevisionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    void cloudApi.revisions(id)
      .then(result => { if (active) setVersions(result); })
      .catch(error => { if (active) setProblem(error instanceof Error ? error.message : '版本列表加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, latestRevision]);

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setProblem('');
    try { await action(); }
    catch (error) { setProblem(error instanceof Error ? error.message : '版本操作失败'); }
    finally { setBusy(false); }
  }

  return (
    <section aria-label="云端历史版本" style={{ margin: '8px 0', padding: 10, border: '1px solid #7775', borderRadius: 8 }}>
      <strong>历史版本（新版本在前）</strong>
      {loading && <p>正在加载历史版本…</p>}
      {problem && <p role="alert" className="project-library-error">{problem}</p>}
      {!loading && versions.length === 0 && <p>暂无历史版本</p>}
      {versions.map(version => (
        <div key={version.revision} className="project-library-item" style={{ marginTop: 8 }}>
          <div>
            <strong>v{version.revision} · {version.name}</strong>
            <small>{new Date(version.createdAt).toLocaleString()}{version.revision === latestRevision ? ' · 当前版本' : ''}</small>
          </div>
          <div className="project-library-item-actions">
            <button type="button" disabled={busy} onClick={() => void perform(async () => {
              const loaded = await cloudApi.getRevision(id, version.revision);
              downloadText(`${loaded.name.replace(/[\\/:*?"<>|]/g, '_')}-v${loaded.revision}.actual-route.json`,
                serializeProject(loaded.document), 'application/json');
            })}>下载 JSON</button>
            <button type="button" disabled={busy || version.revision === latestRevision} onClick={() => void perform(async () => {
              if (!window.confirm(`将云端工程恢复为 v${version.revision} 的内容？系统会生成新的最新版本 v${latestRevision + 1}，不会删除现有历史。`)) return;
              await cloudApi.restoreRevision(id, version.revision, latestRevision);
              await onRestored();
            })}>恢复为最新</button>
          </div>
        </div>
      ))}
      <small>恢复需要当前版本未被其他设备修改，否则服务器会拒绝操作（HTTP 409）。</small>
    </section>
  );
}
