import { useEffect, useRef, useState } from 'react';
import type { ActualRouteProject } from '../data/model';
import { serializeProject, parseProjectJson, downloadText } from '../import-export/projectJson';
import { summarizeProjectChanges } from '../data/cloudConflictSummary';
import { cloudApi, cloudSocketUrl, CloudApiError } from '../data/cloudProjectApi';
import type { CloudUndoEntry, CloudOperationHistoryItem } from '../data/cloudProjectApi';
import { detectStationOperation } from '../data/stationLiveOperations';
import { detectWaypointMove } from '../data/waypointLiveOperations';
import { detectCanvasLineAppend, detectCanvasSegmentSplit, detectCanvasMiddleStationRemoval, detectCanvasNewLineStation, mergeOnePendingCanvasStation, detectCanvasNewLine, detectCanvasLoopClosure } from '../data/collaborationRouting';
import { pendingTopologyRead, pendingTopologySave, pendingTopologyClear, pendingTopologyConfirm } from '../data/pendingTopology';
import type { PendingTopologyOperation } from '../data/pendingTopology';

export interface CollaborativeSession {
  id: string;
  name: string;
  revision: number;
  baseJson: string;
}

export function CollaborativePanel({ session, project, draftActive, onCreateStandaloneStation, onUpdate, onLoad, onExit }: {
  session: CollaborativeSession;
  project: ActualRouteProject;
  draftActive: boolean;
  onCreateStandaloneStation: (name: string) => void;
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
  const [newStationName, setNewStationName] = useState('新车站');
  const [liveStatus, setLiveStatus] = useState('');
  const [appendLineId, setAppendLineId] = useState('');
  const [appendTargetId, setAppendTargetId] = useState('');
  const [splitSegmentId, setSplitSegmentId] = useState('');
  const [splitName, setSplitName] = useState('新车站');
  const [splitWaypointIndex, setSplitWaypointIndex] = useState('0');
  const [removeLineId, setRemoveLineId] = useState('');
  const [removeStationId, setRemoveStationId] = useState('');
  const [undoEntries, setUndoEntries] = useState<CloudUndoEntry[]>([]);
  const [undoOperationId, setUndoOperationId] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [operationHistory, setOperationHistory] = useState<CloudOperationHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [remotePreview, setRemotePreview] = useState<{ revision: number; document: ActualRouteProject } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const draftInProgress = useRef(draftActive);
  const latest = useRef(project);
  const activeSession = useRef(session);
  const onLoadRef = useRef(onLoad);
  const working = useRef(false);
  const fetching = useRef(false);
  const lastAutoAttempt = useRef('');
  const receiveRevisionRef = useRef<((revision: number) => Promise<void>) | null>(null);
  draftInProgress.current = draftActive;
  latest.current = project;
  activeSession.current = session;
  onLoadRef.current = onLoad;

  const dirty = serializeProject(project) !== session.baseJson;
  const pendingWrite = pendingTopologyRead(session.id);

  useEffect(() => {
    let alive = true;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let pingTimer: number | undefined;
    let retryMs = 1000;
    let pendingRevision = session.revision;
    const permissionLostRef = { current: false };
    setRemoteRevision(session.revision);
    setConnected(false);
    setPermissionLost(false);

    async function receiveRevision(revision: number) {
      if (!alive || !Number.isSafeInteger(revision) || revision < 1) return;
      pendingRevision = Math.max(pendingRevision, revision);
      setRemoteRevision(previous => Math.max(previous, revision));
      const current = activeSession.current;
      if (revision <= current.revision || working.current || fetching.current) return;
      if (pendingTopologyRead(current.id)) {
        setRecoveryOpen(true);
        setMessage('有待确认的操作；已阻止自动载入云端版本，以免覆盖本地绘制');
        return;
      }
      // Never replace local unsaved drawings, even for disjoint changes.
      if (draftInProgress.current || serializeProject(latest.current) !== current.baseJson) {
        setMessage('云端有新版本；当前画布有未发布修改，已保留，请手动处理冲突');
        setRecoveryOpen(true);
        return;
      }
      fetching.current = true;
      let appliedRemoteRevision = false;
      try {
        const remote = await cloudApi.get(current.id);
        if (!alive || activeSession.current.id !== current.id) return;
        setRemoteRevision(previous => Math.max(previous, remote.revision));
        const newest = activeSession.current;
        if (remote.revision <= newest.revision) return;
        // Recheck after the async request: the user may have started drawing.
        if (working.current || draftInProgress.current || serializeProject(latest.current) !== newest.baseJson) {
          setMessage('云端有新版本；加载期间画布发生变化，未覆盖本地');
          setRecoveryOpen(true);
          return;
        }
        const next = {
          id: newest.id, name: remote.name, revision: remote.revision,
          baseJson: serializeProject(remote.document),
        };
        activeSession.current = next;
        latest.current = remote.document;
        onLoadRef.current(remote.document, next);
        appliedRemoteRevision = true;
        setMessage('已实时同步云端 v' + remote.revision);
        setError('');
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '自动获取远端工程失败');
      } finally {
        fetching.current = false;
        // WebSocket revisions can arrive while a document fetch is in flight.
        // Never lose the highest advertised revision; give React a turn to
        // commit the previous auto-load before checking for the next one.
        // Retry immediately only after applying a newer revision. When the
        // fetch is stale or local edits prevent replacement, an immediate
        // retry would spin indefinitely and hammer the API. Polling or the
        // next WebSocket notification will trigger another attempt.
        if (appliedRemoteRevision && alive && pendingRevision > activeSession.current.revision)
          window.setTimeout(() => { if (alive) void receiveRevision(pendingRevision); }, 0);
      }
    }

    receiveRevisionRef.current = receiveRevision;

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
      receiveRevisionRef.current = null;
    };
  }, [session.id]);

  // A websocket notification can arrive while the local write holds the
  // single-flight guard. Catch up immediately when that write finishes,
  // without waiting for the 30-second missed-event fallback.
  useEffect(() => {
    if (busy || working.current || fetching.current || permissionLost ||
        draftActive || dirty || pendingTopologyRead(session.id) ||
        remoteRevision <= session.revision) return;
    void receiveRevisionRef.current?.(remoteRevision);
  }, [busy, remoteRevision, session.revision, session.id,
      permissionLost, draftActive, dirty]);

  // An uncertain committed operation survives a tab refresh. Re-use its
  // persisted operationId, never invent a fresh id or replay a compound PUT.
  // Reconnect and the next browser session each trigger at most one attempt.
  useEffect(() => {
    const pending = pendingTopologyRead(session.id);
    if (!pending) return;
    if (pending.confirmed) {
      setRecoveryOpen(true);
      setError('断线操作已确认提交，但保留了未合并的本地绘制备份，请导出备份后处理。');
      return;
    }
    if (!connected || permissionLost || working.current || fetching.current) return;
    let cancelled = false;
    working.current = true;
    setBusy(true);
    setLiveStatus('正在核对断线前的拓扑操作…');
    const { operation } = pending;
    const resend = () => {
      switch (operation.kind) {
        case 'loop-close': return cloudApi.closeLoop(session.id, operation.payload);
        case 'new-line': return cloudApi.createLine(session.id, operation.payload);
        case 'new-station': return cloudApi.appendNewStation(session.id, operation.payload);
        case 'append': return cloudApi.appendExistingStation(session.id, operation.payload);
        case 'split': return cloudApi.splitSegment(session.id, operation.payload);
        case 'remove': return cloudApi.removeMiddleStation(session.id, operation.payload);
      }
    };
    void resend().then(saved => {
      if (cancelled) return;
      setRemoteRevision(previous => Math.max(previous, saved.revision));
      if (serializeProject(latest.current) !== pending.snapshot || draftInProgress.current) {
        pendingTopologyConfirm(session.id, operation.payload.operationId);
        setRecoveryOpen(true);
        setError('操作已确认提交，但当前画布与原始待提交快照不同；已保留本地修改，请先备份并比较差异。');
        return;
      }
      pendingTopologyClear(session.id, operation.payload.operationId);
      const next = { id: session.id, name: saved.name, revision: saved.revision,
        baseJson: serializeProject(saved.document) };
      activeSession.current = next;
      latest.current = saved.document;
      onLoadRef.current(saved.document, next);
      setLiveStatus('断线操作已确认并同步至 v' + saved.revision);
      setRecoveryOpen(false);
      setError('');
    }).catch(error => {
      if (cancelled) return;
      if (error instanceof CloudApiError) {
        pendingTopologyClear(session.id, operation.payload.operationId);
        if (error.status === 403 || error.status === 404) setPermissionLost(true);
        setError('待提交操作被服务器拒绝：' + error.message + '。本地画布未被覆盖。');
      } else {
        setError('网络仍不可用；待提交操作已保留，下次重连时继续使用原 ID。');
      }
      setRecoveryOpen(true);
    }).finally(() => {
      working.current = false;
      if (!cancelled) setBusy(false);
    });
    return () => { cancelled = true; };
  }, [session.id, connected, permissionLost]);

  useEffect(() => {
    let active = true;
    void cloudApi.myUndo(session.id).then(entries => {
      if (!active) return;
      setUndoEntries(entries);
      setUndoOperationId(selected => entries.some(entry => entry.operationId === selected)
        ? selected : (entries[0]?.operationId ?? ''));
    }).catch(() => {
      if (active) { setUndoEntries([]); setUndoOperationId(''); }
    });
    return () => { active = false; };
  }, [session.id, session.revision]);

  useEffect(() => {
    if (!historyOpen) return;
    let alive = true;
    setHistoryLoading(true);
    void cloudApi.operationHistory(session.id).then(entries => {
      if (alive) setOperationHistory(entries);
    }).catch(e => {
      if (alive) setError(e instanceof Error ? e.message : '读取协作历史失败');
    }).finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [session.id, session.revision, historyOpen]);

  async function refreshHistory() {
    if (historyLoading) return;
    setHistoryLoading(true);
    try { setOperationHistory(await cloudApi.operationHistory(session.id)); }
    catch(e) { setError(e instanceof Error ? e.message : '刷新历史失败'); }
    finally { setHistoryLoading(false); }
  }

  async function previewConflict() {
    if (previewLoading) return;
    setRecoveryOpen(true);
    setPreviewLoading(true);
    try {
      const current = await cloudApi.get(session.id);
      setRemotePreview({ revision: current.revision, document: current.document });
      setRemoteRevision(previous => Math.max(previous, current.revision));
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法获取云端对比版本');
    } finally { setPreviewLoading(false); }
  }

  function backupLocal() {
    // Export exactly the current editor state, including unpublished changes.
    const filename = `actual-route-${session.id}-local-v${session.revision}-backup.json`;
    downloadText(filename, serializeProject(latest.current), 'application/json');
    setMessage('已触发完整本地工程 JSON 导出；请确认浏览器已保存文件');
  }
  const baselineProject = recoveryOpen ? (() => {
    try { return parseProjectJson(session.baseJson); } catch { return null; }
  })() : null;
  const localChanges = baselineProject ? summarizeProjectChanges(baselineProject, project) : null;
  const remoteChanges = baselineProject && remotePreview
    ? summarizeProjectChanges(baselineProject, remotePreview.document) : null;
  const conflictingStationIds = baselineProject && remotePreview ? (() => {
    const baseline = new Map(baselineProject.stations.map(station => [station.id, station]));
    const mine = new Map(project.stations.map(station => [station.id, station]));
    const theirs = new Map(remotePreview.document.stations.map(station => [station.id, station]));
    const ids = new Set([...baseline.keys(), ...mine.keys(), ...theirs.keys()]);
    return [...ids].filter(id => {
      const original = JSON.stringify(baseline.get(id));
      return JSON.stringify(mine.get(id)) !== original &&
        JSON.stringify(theirs.get(id)) !== original &&
        JSON.stringify(mine.get(id)) !== JSON.stringify(theirs.get(id));
    });
  })() : [];

  const operationLabels: Record<string,string> = {
    'station.create':'新增车站','station.rename':'修改站名','station.move':'移动车站',
    'segment.waypoint.move':'移动区间控制点','line.append-existing':'线路末端接站',
    'segment.split-station':'区间插站','line.remove-middle-station':'删除中间站',
    'station.undo':'撤销','station.redo':'重做',
    'project.save':'完整工程保存','project.restore':'恢复历史版本',
  };

  const selectedUndo = undoEntries.find(entry => entry.operationId === undoOperationId);
  async function compensate(direction: 'undo' | 'redo') {
    if (!selectedUndo || selectedUndo.undone !== (direction === 'redo') ||
        busy || working.current || fetching.current || permissionLost ||
        dirty || draftActive || remoteRevision > session.revision) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await cloudApi.compensate(session.id, {
        operationId: crypto.randomUUID(),
        targetOperationId: selectedUndo.operationId,
        expectedRevision: session.revision,
        direction,
      });
      setRemoteRevision(value => Math.max(value, saved.revision));
      if (serializeProject(latest.current) !== session.baseJson || draftInProgress.current) {
        setError('补偿操作已提交，但当前画布出现新修改；已保留本地编辑，请同步云端最新版。');
        return;
      }
      const next = {
        id: session.id, name: saved.name, revision: saved.revision,
        baseJson: serializeProject(saved.document),
      };
      activeSession.current = next;
      latest.current = saved.document;
      onLoadRef.current(saved.document, next);
      setMessage((direction === 'undo' ? '已撤销本人操作' : '已重做本人操作') +
        '，云端 v' + saved.revision);
    } catch (e) {
      if (e instanceof CloudApiError && (e.status === 409 || e.status === 404)) {
        setError('补偿被拒绝：该站可能已被其他人修改，或工程经历整图/拓扑更新。当前画布未覆盖；请加载最新版后再检查。');
        setRecoveryOpen(true);
      } else {
        if (e instanceof CloudApiError && e.status === 403) setPermissionLost(true);
        setError(e instanceof Error ? e.message : '补偿操作失败');
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  // Stage-one operation protocol: auto-send only changes provably isolated
  // to a single station. Complex topology and compound edits keep manual CAS.
  useEffect(() => {
    if (busy || working.current || fetching.current || permissionLost
        || draftActive || pendingTopologyRead(session.id)) return;
    const candidate = detectStationOperation(session.baseJson, project);
    const waypointCandidate = candidate ? null : detectWaypointMove(session.baseJson, project);
    if (!candidate && !waypointCandidate) return;
    const snapshot = serializeProject(project);
    const attemptKey = session.id + ':' + session.revision + ':' + snapshot;
    if (lastAutoAttempt.current === attemptKey) return;
    const timer = window.setTimeout(() => {
      if (working.current || fetching.current) return;
      // A new local action might have happened during the debounce window.
      if (serializeProject(latest.current) !== snapshot
          || activeSession.current.revision !== session.revision) return;
      lastAutoAttempt.current = attemptKey;
      working.current = true;
      setBusy(true);
      setLiveStatus('正在同步' + (waypointCandidate ? '区间控制点' : candidate?.type === 'station.move' ? '车站位置' : candidate?.type === 'station.rename' ? '站名' : '新增车站') + '…');
      setError('');
      const op = {
        ...(waypointCandidate ?? candidate), operationId: crypto.randomUUID(), expectedRevision: session.revision,
      };
      const submitted = waypointCandidate
        ? cloudApi.moveWaypoint(session.id, op as typeof op & typeof waypointCandidate)
        : cloudApi.stationOperation(session.id, op as Parameters<typeof cloudApi.stationOperation>[1]);
      void submitted.then(saved => {
        setRemoteRevision(current => Math.max(current, saved.revision));
        if (serializeProject(latest.current) !== snapshot || draftInProgress.current) {
          if (serializeProject(saved.document) === snapshot) {
            // Previous mutation was acknowledged without concurrent remote
            // changes. Keep newer local edits and advance only the baseline:
            // the next effect submits the next normal-canvas mutation.
            const next = { id: session.id, name: saved.name,
              revision: saved.revision, baseJson: snapshot };
            activeSession.current = next;
            onUpdate(next);
            setLiveStatus('上一操作已确认至 v' + saved.revision + '；继续同步后续画布修改');
            setError('');
            return;
          }
          // A different remote edit was merged while the local user continued.
          // Without a proven three-way patch, do not overwrite either branch.
          setRecoveryOpen(true);
          setLiveStatus('上一操作已保存，但还存在需要合并的远端修改');
          setError('服务器结果和本地提交快照不同，后续画布已保留，请先比较差异。');
          return;
        }
        const next = {
          id: session.id, name: saved.name, revision: saved.revision,
          baseJson: serializeProject(saved.document),
        };
        activeSession.current = next;
        onLoadRef.current(saved.document, next);
        setLiveStatus(saved.revision > session.revision + 1
          ? '不同站点的并发修改已合并至 v' + saved.revision
          : '已自动同步至 v' + saved.revision);
      }).catch(e => {
        if (e instanceof CloudApiError && e.status === 409) {
          setRemoteRevision(current => Math.max(current, session.revision + 1));
          setError('操作与另一位用户的修改冲突（可能是同站、整图保存或数据版本缺口）。已保留本地，请导出备份后再加载最新版。');
          setRecoveryOpen(true);
        } else {
          if (e instanceof CloudApiError && (e.status === 403 || e.status === 404)) setPermissionLost(true);
          setError(e instanceof Error ? e.message : '车站操作同步失败，请手动处理');
        }
        setLiveStatus('自动同步未完成');
      }).finally(() => {
        working.current = false;
        setBusy(false);
      });
    }, waypointCandidate || candidate?.type === 'station.move' ? 300 : 550);
    return () => window.clearTimeout(timer);
  }, [project, session.id, session.baseJson, session.revision, busy, permissionLost, draftActive]);

  // All ordinary editor tools share the same history/project state. Prefer
  // resource-level operations above; for mutations they cannot express, use
  // the server's strict expectedRevision CAS rather than requiring users to
  // visit a second set of drawing controls in the collaboration toolbar.
  useEffect(() => {
    if (busy || working.current || fetching.current || permissionLost ||
        draftActive || !dirty || pendingTopologyRead(session.id)) return;
    if (detectStationOperation(session.baseJson, project) ||
        detectWaypointMove(session.baseJson, project)) return;
    const newLine = detectCanvasNewLine(session.baseJson, project);
    const loopClosure = newLine ? null : detectCanvasLoopClosure(session.baseJson, project);
    const newLineStation = newLine || loopClosure ? null : detectCanvasNewLineStation(session.baseJson, project);
    const lineAppend = newLine || loopClosure || newLineStation ? null : detectCanvasLineAppend(session.baseJson, project);
    const segmentSplit = newLine || loopClosure || newLineStation || lineAppend ? null : detectCanvasSegmentSplit(session.baseJson, project);
    const middleRemoval = newLine || loopClosure || newLineStation || lineAppend || segmentSplit ? null : detectCanvasMiddleStationRemoval(session.baseJson, project);
    // A later WebSocket revision may come from a DIFFERENT line. The Java
    // journal validates that disjointness, so do not suppress a safe operation
    // solely because the advertised global revision advanced. Full-document
    // fallback remains strictly version-checked and must stop.
    if (remoteRevision > session.revision &&
        !newLine && !loopClosure && !newLineStation && !lineAppend && !segmentSplit && !middleRemoval) return;
    const snapshot = serializeProject(project);
    const attemptKey = session.id + ':' + session.revision + ':' + snapshot;
    if (lastAutoAttempt.current === attemptKey) return;
    const timer = window.setTimeout(() => {
      if (working.current || fetching.current || draftInProgress.current ||
          activeSession.current.id !== session.id ||
          activeSession.current.revision !== session.revision ||
          serializeProject(latest.current) !== snapshot) return;
      lastAutoAttempt.current = attemptKey;
      working.current = true;
      setBusy(true);
      setLiveStatus(newLine ? '正在同步新建线路…' : loopClosure ? '正在同步环线闭合…' : newLineStation ? '正在同步绘制的新车站…' : lineAppend ? '正在同步线路接站…' : segmentSplit ? '正在同步区间插站…' : middleRemoval ? '正在同步删除中间站…' : '正在同步画布修改…');
      setError('');
      const operationId = crypto.randomUUID();
      const topologyOperation: PendingTopologyOperation | null = loopClosure
        ? { kind: 'loop-close', payload: { ...loopClosure, operationId, expectedRevision: session.revision } }
        : newLine
        ? { kind: 'new-line', payload: { ...newLine, operationId, expectedRevision: session.revision } }
        : newLineStation
        ? { kind: 'new-station', payload: { ...newLineStation, operationId, expectedRevision: session.revision } }
        : lineAppend
          ? { kind: 'append', payload: { ...lineAppend, operationId, expectedRevision: session.revision } }
          : segmentSplit
            ? { kind: 'split', payload: { ...segmentSplit, operationId, expectedRevision: session.revision } }
            : middleRemoval
              ? { kind: 'remove', payload: { ...middleRemoval, operationId, expectedRevision: session.revision } }
              : null;
      if (topologyOperation && !pendingTopologySave({
        projectId: session.id, snapshot, operation: topologyOperation,
      })) {
        working.current = false;
        setBusy(false);
        setRecoveryOpen(true);
        setError('无法持久化待提交协作操作，已停止自动同步；请先导出本地备份。');
        return;
      }
      const sendTopology = () => {
        if (!topologyOperation) throw new Error('没有待提交拓扑操作');
        switch (topologyOperation.kind) {
          case 'loop-close': return cloudApi.closeLoop(session.id, topologyOperation.payload);
          case 'new-line': return cloudApi.createLine(session.id, topologyOperation.payload);
          case 'new-station': return cloudApi.appendNewStation(session.id, topologyOperation.payload);
          case 'append': return cloudApi.appendExistingStation(session.id, topologyOperation.payload);
          case 'split': return cloudApi.splitSegment(session.id, topologyOperation.payload);
          case 'remove': return cloudApi.removeMiddleStation(session.id, topologyOperation.payload);
        }
      };
      const submitted = topologyOperation
        ? sendTopology().catch(async error => {
            if (error instanceof CloudApiError) throw error;
            await new Promise<void>(resolve => window.setTimeout(resolve, 800));
            return sendTopology();
          })
        : cloudApi.update(session.id, session.revision, project);
      void submitted.then(saved => {
        setRemoteRevision(previous => Math.max(previous, saved.revision));
        if (topologyOperation) {
          if (serializeProject(latest.current) !== snapshot || draftInProgress.current) {
            if (serializeProject(saved.document) === snapshot) {
              pendingTopologyClear(session.id, operationId);
              const next = { id: session.id, name: saved.name,
                revision: saved.revision, baseJson: snapshot };
              activeSession.current = next;
              onUpdate(next);
              setError('');
              setLiveStatus('上一笔拓扑操作已确认至 v' + saved.revision + '；后续画布修改继续同步');
              return;
            }
            if (!draftInProgress.current) {
              const merged = mergeOnePendingCanvasStation(snapshot, latest.current, saved.document);
              if (merged) {
                pendingTopologyClear(session.id, operationId);
                const next = { id: session.id, name: saved.name,
                  revision: saved.revision, baseJson: serializeProject(saved.document) };
                activeSession.current = next;
                latest.current = merged;
                onLoadRef.current(merged, next);
                setError('');
                setRecoveryOpen(false);
                setLiveStatus('已保留远端独立修改，并继续同步本地下一站');
                return;
              }
            }
            pendingTopologyConfirm(session.id, operationId);
            setError('拓扑操作已保存，但同时存在其他云端变化；已保留后续绘制，请比较差异。');
            setRecoveryOpen(true);
            return;
          }
          pendingTopologyClear(session.id, operationId);
          const next = { id: session.id, name: saved.name,
            revision: saved.revision, baseJson: serializeProject(saved.document) };
          activeSession.current = next;
          latest.current = saved.document;
          onLoadRef.current(saved.document, next);
          setRecoveryOpen(false);
          setError('');
          setLiveStatus((newLine ? '新建线路' : loopClosure ? '环线闭合' : newLineStation ? '连续绘制新站' : lineAppend ? '线路接站' : segmentSplit ? '区间插站' : '删除中间站') + '已按操作级协议同步至 v' + saved.revision);
          return;
        }
        const next = { id: session.id, name: saved.name,
          revision: saved.revision, baseJson: snapshot };
        activeSession.current = next;
        // Whole-document CAS saves exactly the snapshot submitted. Advance the
        // acknowledged baseline without resetting later local canvas changes.
        onUpdate(next);
        setLiveStatus(serializeProject(latest.current) === snapshot
          ? '画布已自动同步至 v' + saved.revision
          : '已同步 v' + saved.revision + '；后续画布修改仍保留');
      }).catch(e => {
        // An HTTP error is definitive for this operation (unlike a network
        // error with an unknown response). Preserve ambiguous requests for
        // recovery using their original operationId after a reload.
        if (topologyOperation && e instanceof CloudApiError)
          pendingTopologyClear(session.id, operationId);
        if (topologyOperation && !(e instanceof CloudApiError)) {
          setRecoveryOpen(true);
          setError('网络中断，操作结果尚未确认；待提交记录已保存，恢复网络后将使用原操作 ID 重试。');
          setLiveStatus('等待断线恢复');
          return;
        }
        if (e instanceof CloudApiError && e.status === 409) {
          setRemoteRevision(previous => Math.max(previous, session.revision + 1));
          setRecoveryOpen(true);
          setError('画布自动同步遇到版本冲突；本地编辑已保留，请先比较云端差异。');
        } else {
          if (e instanceof CloudApiError && (e.status === 403 || e.status === 404))
            setPermissionLost(true);
          setError(e instanceof Error ? e.message : '自动同步失败，画布仍保存在本地');
        }
        setLiveStatus('自动同步未完成');
      }).finally(() => {
        working.current = false;
        setBusy(false);
      });
    }, newLine ? 0 : 1200);
    // Commit the empty line + phase as soon as the ordinary toolbar creates
    // them; waiting for the general 1200ms debounce could batch a rapidly
    // drawn station into an unsupported compound full-document PUT.
    return () => window.clearTimeout(timer);
  }, [project, session.id, session.baseJson, session.revision,
      busy, permissionLost, draftActive, dirty, remoteRevision, onUpdate]);

  const eligibleLines = project.lines.filter(line =>
    !line.locked && !line.isFake && line.source?.format !== 'aarc'
    && line.stationSequence.length > 0);
  const selectedAppendLine = eligibleLines.find(line => line.id === appendLineId);
  const selectableAppendStations = selectedAppendLine
    ? project.stations.filter(station =>
        !selectedAppendLine.stationSequence.includes(station.id)
        && !project.stationLineRelations.some(relation =>
          relation.lineId === selectedAppendLine.id && relation.stationId === station.id))
    : [];

  const splitEligibleSegments = project.geometry.segments.filter(segment =>
    project.lines.some(line => line.id === segment.lineId && !line.locked
      && !line.isFake && line.source?.format !== 'aarc') &&
    !segment.source && !segment.structureNodes?.length &&
    !segment.operationHistory?.length && !segment.lineHistory?.length);
  const selectedSplitSegment = splitEligibleSegments.find(segment => segment.id === splitSegmentId);
  const splitIndex = Number(splitWaypointIndex);
  const splitFrom = selectedSplitSegment
    ? project.stations.find(station => station.id === selectedSplitSegment.fromStationId) : undefined;
  const splitTo = selectedSplitSegment
    ? project.stations.find(station => station.id === selectedSplitSegment.toStationId) : undefined;
  const splitChain = selectedSplitSegment && splitFrom && splitTo
    ? [splitFrom, ...selectedSplitSegment.waypoints, splitTo] : [];
  const splitCanApply = Boolean(selectedSplitSegment && Number.isInteger(splitIndex)
    && splitIndex >= 0 && splitIndex < splitChain.length - 1 && splitName.trim());

  async function insertStationIntoSegment() {
    if (!splitCanApply || busy || working.current || fetching.current || permissionLost
      || dirty || draftActive || remoteRevision > session.revision
      || !selectedSplitSegment) return;
    const first = splitChain[splitIndex], second = splitChain[splitIndex + 1];
    if (!first || !second) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await cloudApi.splitSegment(session.id, {
        operationId: crypto.randomUUID(), expectedRevision: session.revision,
        segmentId: selectedSplitSegment.id,
        stationId: crypto.randomUUID(), relationId: crypto.randomUUID(),
        beforeSegmentId: crypto.randomUUID(), afterSegmentId: crypto.randomUUID(),
        stationName: splitName.trim(),
        x: (first.x + second.x) / 2, y: (first.y + second.y) / 2,
        splitWaypointIndex: splitIndex,
      });
      if (serializeProject(latest.current) !== session.baseJson || draftInProgress.current) {
        setRemoteRevision(previous => Math.max(previous, saved.revision));
        setError('拆分已提交，但编辑期间画布发生其他修改。已保留本地画布，请核对云端最新版。');
        return;
      }
      const next = {
        id: session.id, name: saved.name, revision: saved.revision,
        baseJson: serializeProject(saved.document),
      };
      activeSession.current = next;
      latest.current = saved.document;
      onLoadRef.current(saved.document, next);
      setRemoteRevision(saved.revision);
      setSplitSegmentId('');
      setMessage('已将区间拆为两段并新增车站，云端 v' + saved.revision);
    } catch (e) {
      if (e instanceof CloudApiError && e.status === 409) {
        setRemoteRevision(previous => Math.max(previous, session.revision + 1));
        setError('区间拆分发生版本或拓扑冲突，已保留当前画布。请同步最新版后重试。');
      } else {
        if (e instanceof CloudApiError && (e.status === 403 || e.status === 404))
          setPermissionLost(true);
        setError(e instanceof Error ? e.message : '拆分区间失败');
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  const selectedRemovalLine = eligibleLines.find(line => line.id === removeLineId);
  const removableMiddleStations = selectedRemovalLine
    ? selectedRemovalLine.stationSequence.slice(1, -1).map((stationId, index) => {
        const previous = selectedRemovalLine.stationSequence[index];
        const following = selectedRemovalLine.stationSequence[index + 2];
        const before = project.geometry.segments.find(seg => seg.lineId === selectedRemovalLine.id
          && seg.fromStationId === previous && seg.toStationId === stationId);
        const after = project.geometry.segments.find(seg => seg.lineId === selectedRemovalLine.id
          && seg.fromStationId === stationId && seg.toStationId === following);
        if (!before || !after || before.source || after.source
            || before.structureNodes?.length || after.structureNodes?.length
            || before.operationHistory?.length || after.operationHistory?.length
            || before.lineHistory?.length || after.lineHistory?.length
            || before.mode !== after.mode
            || before.structureType !== after.structureType
            || before.lineStyleId !== after.lineStyleId
            || before.cornerRadius !== after.cornerRadius
            || before.openedAt !== after.openedAt || before.closedAt !== after.closedAt)
          return null;
        return { stationId, before, after };
      }).filter((value): value is NonNullable<typeof value> => value !== null)
    : [];
  const selectedRemoval = removableMiddleStations.find(item => item.stationId === removeStationId);

  async function removeMiddleStation() {
    if (!selectedRemovalLine || !selectedRemoval || busy || working.current || fetching.current
        || permissionLost || dirty || draftActive || remoteRevision > session.revision) return;
    if (!window.confirm('将从此线路移除中间站并合并两段相邻区间。站点为换乘站时会保留在其他线路上。确认继续吗？')) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await cloudApi.removeMiddleStation(session.id, {
        operationId: crypto.randomUUID(), expectedRevision: session.revision,
        lineId: selectedRemovalLine.id, stationId: selectedRemoval.stationId,
        beforeSegmentId: selectedRemoval.before.id,
        afterSegmentId: selectedRemoval.after.id,
        mergedSegmentId: crypto.randomUUID(),
        preservedWaypointId: crypto.randomUUID(),
      });
      if (serializeProject(latest.current) !== session.baseJson || draftInProgress.current) {
        setRemoteRevision(previous => Math.max(previous, saved.revision));
        setError('删除已提交，但请求期间本地画布发生变化；已保留本地状态，请检查云端最新版。');
        return;
      }
      const next = {
        id: session.id, name: saved.name, revision: saved.revision,
        baseJson: serializeProject(saved.document),
      };
      activeSession.current = next;
      latest.current = saved.document;
      onLoadRef.current(saved.document, next);
      setRemoteRevision(saved.revision);
      setRemoveStationId('');
      setMessage('已安全合并相邻区间，云端 v' + saved.revision);
    } catch (e) {
      if (e instanceof CloudApiError && e.status === 409) {
        setRemoteRevision(previous => Math.max(previous, session.revision + 1));
        setError('删除被拒绝：工程版本已变化，或线路拓扑、样式、历史关系存在冲突。请同步最新版后处理。');
      } else {
        if (e instanceof CloudApiError && (e.status === 403 || e.status === 404))
          setPermissionLost(true);
        setError(e instanceof Error ? e.message : '删除中间站失败');
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function appendExisting() {
    if (busy || working.current || fetching.current || permissionLost || dirty ||
        draftActive || remoteRevision > session.revision || !selectedAppendLine ||
        !appendTargetId || !selectableAppendStations.some(station => station.id === appendTargetId)) return;
    const fromStationId = selectedAppendLine.stationSequence.at(-1);
    if (!fromStationId) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await cloudApi.appendExistingStation(session.id, {
        operationId: crypto.randomUUID(), expectedRevision: session.revision,
        lineId: selectedAppendLine.id, fromStationId, toStationId: appendTargetId,
        segmentId: crypto.randomUUID(), relationId: crypto.randomUUID(),
      });
      if (serializeProject(latest.current) !== session.baseJson || draftInProgress.current) {
        setRemoteRevision(previous => Math.max(previous, saved.revision));
        setError('拓扑连接已提交，但画布在请求期间发生变化。已保留本地编辑，请核对云端最新版。');
        return;
      }
      const next = {
        id: session.id, name: saved.name, revision: saved.revision,
        baseJson: serializeProject(saved.document),
      };
      activeSession.current = next;
      latest.current = saved.document;
      onLoadRef.current(saved.document, next);
      setRemoteRevision(saved.revision);
      setAppendTargetId('');
      setMessage('已连接已有车站，线路拓扑更新至 v' + saved.revision);
    } catch (e) {
      if (e instanceof CloudApiError && e.status === 409) {
        setRemoteRevision(previous => Math.max(previous, session.revision + 1));
        setError('线路拓扑发生版本冲突，未修改本地画布。请加载最新版后重试。');
      } else {
        if (e instanceof CloudApiError && (e.status === 403 || e.status === 404))
          setPermissionLost(true);
        setError(e instanceof Error ? e.message : '连接已有车站失败');
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function publish() {
    if (busy || permissionLost || pendingTopologyRead(session.id) || remoteRevision > session.revision || !dirty) return;
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
        setRecoveryOpen(true);
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
    if (busy || pendingTopologyRead(session.id)) {
      setRecoveryOpen(true);
      setError('请先导出并处理断线待确认操作的本地备份，再加载云端版本。');
      return;
    }
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
    <strong>协同编辑 · {session.name}（普通绘制工具自动同步）</strong>
    <span>本地基线 v{session.revision} · 远端 v{remoteRevision}</span>
    <span>{dirty ? '● 未发布修改' : draftActive ? '绘制操作进行中' : '✓ 与已加载版本一致'}</span>
    <span>{permissionLost ? '协作权限已失效' : connected ? 'WebSocket 已连接' : '实时连接中断 · 30 秒兜底检查'}</span>
    {pendingWrite && <>
      <span role="status">断线操作{pendingWrite.confirmed ? '已确认，等待备份处理' : '待确认'}</span>
      <button type="button" onClick={() => downloadText(
        'actual-route-pending-' + session.id + '.json',
        pendingWrite.snapshot, 'application/json'
      )}>导出断线前画布备份</button>
      {pendingWrite.confirmed && <button type="button" onClick={() => {
        if (!window.confirm('确认已导出备份？这会清除待恢复记录，但不会删除云端操作。')) return;
        pendingTopologyClear(session.id, pendingWrite.operation.payload.operationId);
        setRecoveryOpen(false);
        setMessage('断线记录已清除；请比较本地与云端版本');
      }}>备份后清除已确认记录</button>}
    </>}
    <label>新增独立车站 <input aria-label="新车站名称" value={newStationName} maxLength={100}
      onChange={event => setNewStationName(event.target.value)} /></label>
    <button type="button" disabled={busy || permissionLost || dirty || draftActive || remoteRevision > session.revision || !newStationName.trim()}
      onClick={() => onCreateStandaloneStation(newStationName.trim())}>新增独立车站</button>
    <label>连接线路
      <select aria-label="待扩展线路" value={appendLineId}
        onChange={event => { setAppendLineId(event.target.value); setAppendTargetId(''); }}>
        <option value="">选择线路</option>
        {eligibleLines.map(line => <option key={line.id} value={line.id}>{line.name || line.id}</option>)}
      </select>
    </label>
    <label>已有目标车站
      <select aria-label="连接目标车站" value={appendTargetId}
        onChange={event => setAppendTargetId(event.target.value)}>
        <option value="">选择车站</option>
        {selectableAppendStations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}
      </select>
    </label>
    <button type="button"
      disabled={busy || permissionLost || dirty || draftActive || remoteRevision > session.revision
        || !selectedAppendLine || !appendTargetId}
      onClick={() => void appendExisting()}>将已有车站接到线路末端</button>
    <label>插入车站的区间
      <select aria-label="待拆分区间" value={splitSegmentId}
        onChange={event => { setSplitSegmentId(event.target.value); setSplitWaypointIndex('0'); }}>
        <option value="">选择区间</option>
        {splitEligibleSegments.map(segment => <option key={segment.id} value={segment.id}>
          {project.lines.find(line => line.id === segment.lineId)?.name || segment.lineId} ·
          {project.stations.find(station => station.id === segment.fromStationId)?.name || segment.fromStationId} —
          {project.stations.find(station => station.id === segment.toStationId)?.name || segment.toStationId}
        </option>)}
      </select>
    </label>
    <label>插入位置
      <select aria-label="区间插入位置" value={splitWaypointIndex} onChange={event => setSplitWaypointIndex(event.target.value)}
        disabled={!selectedSplitSegment}>
        {splitChain.slice(0,-1).map((_,index) => <option value={String(index)} key={index}>
          {index+1} / {splitChain.length-1} 段中点
        </option>)}
      </select>
    </label>
    <label>新站名
      <input aria-label="插入车站名称" value={splitName} maxLength={100}
        onChange={event => setSplitName(event.target.value)} />
    </label>
    <button type="button" disabled={busy || permissionLost || dirty || draftActive
      || remoteRevision > session.revision || !splitCanApply}
      onClick={() => void insertStationIntoSegment()}>在区间中插入车站</button>
    <label>移除中间站的线路
      <select aria-label="待合并线路" value={removeLineId}
        onChange={event => { setRemoveLineId(event.target.value); setRemoveStationId(''); }}>
        <option value="">选择线路</option>
        {eligibleLines.filter(line => line.stationSequence.length >= 3).map(line =>
          <option key={line.id} value={line.id}>{line.name || line.id}</option>)}
      </select>
    </label>
    <label>待移除中间站
      <select aria-label="待移除中间车站" value={removeStationId}
        onChange={event => setRemoveStationId(event.target.value)}>
        <option value="">选择车站</option>
        {removableMiddleStations.map(item => <option key={item.stationId} value={item.stationId}>
          {project.stations.find(station => station.id === item.stationId)?.name || item.stationId}
        </option>)}
      </select>
    </label>
    <button type="button" disabled={busy || permissionLost || dirty || draftActive
      || remoteRevision > session.revision || !selectedRemoval}
      onClick={() => void removeMiddleStation()}>删除中间站并合并区间</button>
    <label>我的可补偿操作
      <select aria-label="我的撤销重做操作" value={undoOperationId}
        onChange={event => setUndoOperationId(event.target.value)}>
        <option value="">选择操作</option>
        {undoEntries.map(entry => <option key={entry.operationId} value={entry.operationId}>
          {entry.action === 'station.move' ? '移动' : '改名'} ·
          {project.stations.find(station => station.id === entry.stationId)?.name || entry.stationId} ·
          v{entry.stateRevision}{entry.undone ? '（已撤销）' : ''}
        </option>)}
      </select>
    </label>
    <button type="button" disabled={busy || permissionLost || dirty || draftActive ||
      remoteRevision > session.revision || !selectedUndo || selectedUndo.undone}
      onClick={() => void compensate('undo')}>撤销本人操作</button>
    <button type="button" disabled={busy || permissionLost || dirty || draftActive ||
      remoteRevision > session.revision || !selectedUndo || !selectedUndo.undone}
      onClick={() => void compensate('redo')}>重做本人操作</button>
    <button type="button" disabled={busy || permissionLost || !dirty || remoteRevision > session.revision} onClick={() => void publish()}>手动重试发布画布</button>
    <button type="button" disabled={busy} onClick={() => void pull()}>加载云端最新版</button>
    <button type="button" onClick={() => setHistoryOpen(open => !open)}>
      {historyOpen ? '收起操作历史' : '查看操作历史'}
    </button>
    <button type="button" onClick={() => { setRecoveryOpen(true); void previewConflict(); }}>
      查看云端差异
    </button>
    <button type="button" onClick={backupLocal}>导出本地工程备份</button>
    {historyOpen && <div aria-label="协同操作历史" style={{ width:'100%', padding:8, border:'1px solid #8885' }}>
      <strong>最近 50 条操作记录</strong>
      <button type="button" disabled={historyLoading} onClick={() => void refreshHistory()}>刷新操作历史</button>
      {historyLoading && <span>加载历史中…</span>}
      {!historyLoading && operationHistory.length===0 && <p>暂无操作记录。旧版完整保存可能没有操作者日志。</p>}
      <ol style={{ maxHeight:220, overflowY:'auto', paddingLeft:26 }}>
        {operationHistory.map(entry => <li key={entry.operationId}>
          v{entry.revision} · {entry.actorName} · {operationLabels[entry.action] || entry.action}
          {entry.resourceId !== 'project' && <> · {entry.resourceId}</>}
          {' · '}{new Date(entry.createdAt).toLocaleString()}
        </li>)}
      </ol>
    </div>}
    {recoveryOpen && <div aria-label="协同冲突处理" style={{ width:'100%', padding:8, border:'1px solid #8885' }}>
      <strong>本地与云端差异（只读预览）</strong>
      <p>本地基线 v{session.revision}，云端{remotePreview ? '预览 v'+remotePreview.revision : '尚未获取'}。
        预览不会修改画布，也不会自动合并。</p>
      <button type="button" disabled={previewLoading} onClick={() => void previewConflict()}>
        {previewLoading ? '获取中…' : '刷新云端差异'}
      </button>
      {localChanges && <p>本地相对基线：车站 {localChanges.stations}、线路 {localChanges.lines}、
        区间 {localChanges.segments}、成员关系 {localChanges.relations} 处变化；
        其他设置{localChanges.otherChanged ? '有变化' : '无变化'}。
        {localChanges.stationDetails.length > 0 && <> 涉及车站：{localChanges.stationDetails.join('、')}</>}</p>}
      {remoteChanges && <p>云端相对基线：车站 {remoteChanges.stations}、线路 {remoteChanges.lines}、
        区间 {remoteChanges.segments}、成员关系 {remoteChanges.relations} 处变化；
        其他设置{remoteChanges.otherChanged ? '有变化' : '无变化'}。
        {remoteChanges.stationDetails.length > 0 && <> 涉及车站：{remoteChanges.stationDetails.join('、')}</>}</p>}
      {remotePreview && <p>双方不同修改的同一车站：{conflictingStationIds.length} 个
        {conflictingStationIds.length > 0 && <>（{conflictingStationIds.slice(0,5).map(id =>
          project.stations.find(station=>station.id===id)?.name || id).join('、')}）</>}
        。此为差异提示，不等同于完整拓扑冲突检测。</p>}
      <button type="button" onClick={backupLocal}>先导出本地 JSON 备份</button>
      <button type="button" disabled={busy || draftActive} onClick={() => void pull()}>
        加载云端最新版（会替换当前画布）
      </button>
      <button type="button" onClick={() => setRecoveryOpen(false)}>关闭对比</button>
    </div>}
    <button type="button" disabled={busy} onClick={onExit}>退出协同模式</button>
    {error && <p role="alert" style={{ width: '100%' }}>{error}</p>}
    {message && <p role="status" style={{ width: '100%' }}>{message}</p>}
    {liveStatus && <p role="status" style={{ width: '100%' }}>{liveStatus}</p>}
    <small style={{ width: '100%' }}>独立车站与既有区间的单个控制点坐标修改可自动提交；不同站点或不同区间可保守合并，重叠修改仍会冲突。支持受控线路末端连接和简单连续区间的插站拆分；简单连续中间站可受控删除并合并区间；仅支持本人站名和移动操作的安全撤销/重做，发生同站或拓扑冲突时会拒绝；普通连续绘制新站、简单连续线路接站、简单区间插站和安全删除中间站优先使用操作级协议；复杂结构、分期、其他删除、分叉和环线使用严格版本校验的整图自动保存，冲突时停止同步并保留本地草稿。</small>
  </section>;
}
