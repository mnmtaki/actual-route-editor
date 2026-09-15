from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def read(path): return (ROOT / path).read_text(encoding='utf-8')
def write(path, text): (ROOT / path).write_text(text, encoding='utf-8')
def replace_once(path, old, new):
    text = read(path); count = text.count(old)
    if count != 1: raise RuntimeError(f'{path}: expected 1 match, got {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))
def regex_once(path, pattern, replacement):
    text = read(path); next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1: raise RuntimeError(f'{path}: expected 1 regex match, got {count}: {pattern[:120]!r}')
    write(path, next_text)

# model: persistent editor-only incomplete line tails
replace_once('src/data/model.ts',
"export interface OpeningPhase { id: string; lineId: string; name?: string; openedAt: string; segmentIds: string[]; stationRelationIds: string[]; revealStartStationId?: string; revealEndStationId?: string; showOverviewAfter?: boolean; overriddenSegmentIds?: string[]; overriddenStationRelationIds?: string[] }\nexport interface Waypoint",
"export interface OpeningPhase { id: string; lineId: string; name?: string; openedAt: string; segmentIds: string[]; stationRelationIds: string[]; revealStartStationId?: string; revealEndStationId?: string; showOverviewAfter?: boolean; overriddenSegmentIds?: string[]; overriddenStationRelationIds?: string[] }\nexport interface LineDraftPoint { id: string; x: number; y: number }\n/** Editor-only unfinished tail. It is saved with the project but never becomes an operating Segment until it reaches another Station. */\nexport interface LineDraft { id: string; lineId: string; anchorStationId: string | null; phaseId?: string; points: LineDraftPoint[]; lastCreatedStationId?: string }\nexport interface Waypoint")
replace_once('src/data/model.ts',
"openingPhases: OpeningPhase[]; operationEvents?: OperationEvent[]; geometry:",
"openingPhases: OpeningPhase[]; operationEvents?: OperationEvent[]; lineDrafts?: LineDraft[]; geometry:")

# DrawingMode consumes model-owned draft types.
replace_once('src/data/basemapPaths.ts',
"import type { ActualRouteProject, BasemapPath, BasemapPathCategory, BasemapPathPoint } from './model'",
"import type { ActualRouteProject, BasemapPath, BasemapPathCategory, BasemapPathPoint, LineDraftPoint } from './model'")
replace_once('src/data/basemapPaths.ts',
"export interface LineDraftPoint { id: string; x: number; y: number }\nexport type DrawingMode = { kind: 'line'; lineId: string; anchorStationId: string | null; phaseId?: string; draftPoints?: LineDraftPoint[]; lastCreatedStationId?: string } | { kind: 'basemap'; pathId: string } | { kind: 'road'; roadId: string; styleId: string } | { kind?: 'line'; lineId: string; anchorStationId: string | null; phaseId?: string; draftPoints?: LineDraftPoint[]; lastCreatedStationId?: string }",
"export type DrawingMode = { kind: 'line'; lineId: string; anchorStationId: string | null; phaseId?: string; draftId?: string; draftPoints?: LineDraftPoint[]; lastCreatedStationId?: string } | { kind: 'basemap'; pathId: string } | { kind: 'road'; roadId: string; styleId: string } | { kind?: 'line'; lineId: string; anchorStationId: string | null; phaseId?: string; draftId?: string; draftPoints?: LineDraftPoint[]; lastCreatedStationId?: string }")

write('src/data/lineDrafts.ts', r'''import type { ActualRouteProject, LineDraft, LineDraftPoint } from './model'
import { uid } from './model'

export function normalizeLineDrafts(value: unknown): LineDraft[] | undefined {
  if (!Array.isArray(value)) return undefined
  const drafts = value.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id || typeof item.lineId !== 'string' || !item.lineId) return []
    const anchorStationId = item.anchorStationId === null ? null : typeof item.anchorStationId === 'string' ? item.anchorStationId : null
    const points = Array.isArray(item.points) ? item.points.flatMap(point => normalizePoint(point)) : []
    return [{
      id: item.id,
      lineId: item.lineId,
      anchorStationId,
      ...(typeof item.phaseId === 'string' && item.phaseId ? { phaseId: item.phaseId } : {}),
      points,
      ...(typeof item.lastCreatedStationId === 'string' && item.lastCreatedStationId ? { lastCreatedStationId: item.lastCreatedStationId } : {}),
    } satisfies LineDraft]
  })
  return drafts.length ? drafts : undefined
}

export function createLineDraft(project: ActualRouteProject, lineId: string, anchorStationId: string | null, phaseId?: string): { project: ActualRouteProject; draftId: string } {
  const next = structuredClone(project), draftId = uid('line-draft')
  next.lineDrafts ??= []
  next.lineDrafts.push({ id: draftId, lineId, anchorStationId, ...(phaseId ? { phaseId } : {}), points: [] })
  return { project: next, draftId }
}

export function replaceLineDraft(project: ActualRouteProject, draft: LineDraft): ActualRouteProject {
  const next = structuredClone(project)
  next.lineDrafts ??= []
  const index = next.lineDrafts.findIndex(item => item.id === draft.id)
  if (index >= 0) next.lineDrafts[index] = structuredClone(draft)
  else next.lineDrafts.push(structuredClone(draft))
  return next
}

export function deleteLineDraft(project: ActualRouteProject, draftId: string): ActualRouteProject {
  const next = structuredClone(project)
  next.lineDrafts = (next.lineDrafts ?? []).filter(item => item.id !== draftId)
  if (!next.lineDrafts.length) delete next.lineDrafts
  return next
}

export function cleanLineDraftReferences(project: ActualRouteProject): ActualRouteProject {
  if (!project.lineDrafts?.length) return project
  const next = structuredClone(project), lineIds = new Set(next.lines.map(line => line.id)), stationIds = new Set(next.stations.map(station => station.id)), phaseIds = new Set(next.openingPhases.map(phase => phase.id))
  next.lineDrafts = (next.lineDrafts ?? []).filter(draft => lineIds.has(draft.lineId) && draft.points.length > 0 && Boolean(draft.anchorStationId && stationIds.has(draft.anchorStationId))).map(draft => ({ ...draft, ...(draft.phaseId && phaseIds.has(draft.phaseId) ? { phaseId: draft.phaseId } : { phaseId: undefined }), ...(draft.lastCreatedStationId && stationIds.has(draft.lastCreatedStationId) ? { lastCreatedStationId: draft.lastCreatedStationId } : { lastCreatedStationId: undefined }) }))
  if (!next.lineDrafts.length) delete next.lineDrafts
  return next
}

function normalizePoint(value: unknown): LineDraftPoint[] {
  if (!value || typeof value !== 'object') return []
  const item = value as Record<string, unknown>, x = Number(item.x), y = Number(item.y)
  return typeof item.id === 'string' && item.id && Number.isFinite(x) && Number.isFinite(y) ? [{ id: item.id, x, y }] : []
}
''')

# Project JSON round-trip.
replace_once('src/import-export/projectJsonLegacy.ts',
"import { normalizeOperationEvents, normalizeOperationHistory } from '../data/operationEvents'",
"import { normalizeOperationEvents, normalizeOperationHistory } from '../data/operationEvents'\nimport { cleanLineDraftReferences, normalizeLineDrafts } from '../data/lineDrafts'")
replace_once('src/import-export/projectJsonLegacy.ts',
"  const normalizedOperationEvents = normalizeOperationEvents((parsed as Record<string, unknown>).operationEvents)",
"  const normalizedOperationEvents = normalizeOperationEvents((parsed as Record<string, unknown>).operationEvents)\n  const normalizedLineDrafts = normalizeLineDrafts((parsed as Record<string, unknown>).lineDrafts)")
replace_once('src/import-export/projectJsonLegacy.ts',
"    ...(normalizedOperationEvents ? { operationEvents: normalizedOperationEvents } : {}),\n    geometry:",
"    ...(normalizedOperationEvents ? { operationEvents: normalizedOperationEvents } : {}),\n    ...(normalizedLineDrafts ? { lineDrafts: normalizedLineDrafts } : {}),\n    geometry:")
replace_once('src/import-export/projectJsonLegacy.ts',
"  for (const line of project.lines) { const history = normalizeOperationHistory(line.operationHistory); if (history) line.operationHistory = history; else delete line.operationHistory }",
"  const cleanedDraftProject = cleanLineDraftReferences(project)\n  project.lineDrafts = cleanedDraftProject.lineDrafts\n  for (const line of project.lines) { const history = normalizeOperationHistory(line.operationHistory); if (history) line.operationHistory = history; else delete line.operationHistory }")

# Domain deletion also removes orphans drafts.
replace_once('src/data/operationsLegacy.ts',
"  next.openingPhases = next.openingPhases.filter(phase => !deletedIds.has(phase.lineId))\n  return pruneOrphanStations(next)",
"  next.openingPhases = next.openingPhases.filter(phase => !deletedIds.has(phase.lineId))\n  next.lineDrafts = (next.lineDrafts ?? []).filter(draft => !deletedIds.has(draft.lineId))\n  if (!next.lineDrafts.length) delete next.lineDrafts\n  return pruneOrphanStations(next)")
replace_once('src/data/operationsLegacy.ts',
"  next.lines.forEach((line) => { line.stationSequence = line.stationSequence.filter((id) => id !== stationId) })\n  return pruneOrphanStations(next)",
"  next.lines.forEach((line) => { line.stationSequence = line.stationSequence.filter((id) => id !== stationId) })\n  next.lineDrafts = (next.lineDrafts ?? []).filter(draft => draft.anchorStationId !== stationId)\n  if (!next.lineDrafts.length) delete next.lineDrafts\n  return pruneOrphanStations(next)")
replace_once('src/data/operationsLegacy.ts',
"  next.geometry.segments = next.geometry.segments.filter((segment) => stationIds.has(segment.fromStationId) && stationIds.has(segment.toStationId))\n  const segmentIds",
"  next.geometry.segments = next.geometry.segments.filter((segment) => stationIds.has(segment.fromStationId) && stationIds.has(segment.toStationId))\n  next.lineDrafts = (next.lineDrafts ?? []).filter(draft => draft.anchorStationId ? stationIds.has(draft.anchorStationId) : false)\n  if (!next.lineDrafts.length) delete next.lineDrafts\n  const segmentIds")

# App: create/resume/pause persistent drafts.
replace_once('src/App.tsx',
"import { setLinesBoolean, removeBackground as removeBackgroundCommand } from \"./data/editorCommands\";",
"import { setLinesBoolean, removeBackground as removeBackgroundCommand } from \"./data/editorCommands\";\nimport { createLineDraft, deleteLineDraft } from \"./data/lineDrafts\";")
replace_once('src/App.tsx',
"    let next = phase.project;\n    if (seed)\n      next = connectExistingStation(next, r.lineId, seed, null, phase.phaseId);\n    history.commit(next);\n    setActiveLineId(r.lineId);\n    setDrawing({\n      kind: \"line\",\n      lineId: r.lineId,\n      anchorStationId: seed ?? null,\n      phaseId: phase.phaseId,\n    });",
"    let next = phase.project;\n    if (seed)\n      next = connectExistingStation(next, r.lineId, seed, null, phase.phaseId);\n    const draft = createLineDraft(next, r.lineId, seed ?? null, phase.phaseId);\n    next = draft.project;\n    history.commit(next);\n    setActiveLineId(r.lineId);\n    setDrawing({\n      kind: \"line\",\n      lineId: r.lineId,\n      anchorStationId: seed ?? null,\n      phaseId: phase.phaseId,\n      draftId: draft.draftId,\n    });")

regex_once('src/App.tsx', r'''  const finishDrawing = \(\) => \{.*?\n  \};\n  const cancelDrawing = \(\) => \{.*?\n  \};\n  const exitDrawingTool = \(\) => \{.*?\n  \};''', r'''  const pauseLineDrawing = (message: string) => {
    if (drawing?.kind !== "line") return false;
    const draft = drawing.draftId ? history.project.lineDrafts?.find(item => item.id === drawing.draftId) : undefined;
    if (draft && draft.points.length === 0) history.replace(deleteLineDraft(history.project, draft.id));
    setDrawing(null);
    setNotice(draft?.points.length ? `${message}；未完成线路草稿已保留` : message);
    return true;
  };
  const finishDrawing = () => {
    if (pauseLineDrawing("已暂停线路绘制")) return;
    if (drawing?.kind === "basemap") {
      setDrawing(null);
      setNotice("底图路径已完成");
    } else if (drawing?.kind === "road") {
      if (roadDraft) {
        const result = finishCurrentRoad(history.project, roadDraft);
        if (result.committed) history.commit(result.project);
      }
      const roadId = uid("road");
      setRoadDraft({ id: roadId, points: [], styleId: roadStyleId, zIndex: 0, visible: true, locked: false, createdOrder: (history.project.roads?.length ?? 0) + 1 });
      setDrawing({ kind: "road", roadId, styleId: roadStyleId });
      setNotice("当前道路已完成；继续点击绘制下一条，Esc 退出");
    } else {
      setDrawing(null);
      setNotice("已回到直接编辑");
    }
  };
  const cancelDrawing = () => {
    if (pauseLineDrawing("已暂停线路绘制")) return;
    if (drawing) {
      if (drawing.kind === "road" && roadDraft && roadDraft.points.length > 0) {
        setRoadDraft({ ...roadDraft, points: [] });
        setNotice("已取消当前道路草稿；继续点击绘制，Esc 再次退出");
        return;
      }
      setRoadDraft(null);
      setDrawing(null);
      setNotice("已取消当前绘制");
    }
  };
  const exitDrawingTool = () => {
    if (pauseLineDrawing("已退出线路绘制")) return;
    setRoadDraft(null);
    if (drawing?.kind === "road") setSelection(null);
    setDrawing(null);
    setNotice("已退出绘制");
  };''')

regex_once('src/App.tsx', r'''  const extend = \(stationId: string\) => \{.*?\n  \};\n  const choose = \(lineId\?: string\) => \{.*?\n  \};\n  const startPhaseDrawing = \(.*?\n  \};''', r'''  const beginLineDraft = (lineId: string, stationId: string | null, phaseId?: string) => {
    const draft = createLineDraft(history.project, lineId, stationId, phaseId);
    history.replace(draft.project);
    setDrawing({ kind: "line", lineId, anchorStationId: stationId, ...(phaseId ? { phaseId } : {}), draftId: draft.draftId });
    setActiveLineId(lineId);
    return draft.draftId;
  };
  const extend = (stationId: string) => {
    const ids = stationLineIds(history.project, stationId);
    if (ids.length === 1) {
      if (isLineLocked(history.project, ids[0])) {
        setNotice("线路已锁定");
        return;
      }
      beginLineDraft(ids[0], stationId);
      return;
    }
    setChoice(stationId);
  };
  const choose = (lineId?: string) => {
    const stationId = choice!;
    setChoice(null);
    if (lineId) {
      if (isLineLocked(history.project, lineId)) {
        setNotice("线路已锁定");
        return;
      }
      beginLineDraft(lineId, stationId);
    } else setDialog({ seed: stationId });
  };
  const startPhaseDrawing = (
    phaseId: string,
    lineId: string,
    stationId: string | null,
  ) => {
    if (isLineLocked(history.project, lineId)) {
      setNotice("线路已锁定");
      return;
    }
    beginLineDraft(lineId, stationId, phaseId);
    setSelection(
      stationId
        ? { type: "station", id: stationId }
        : { type: "line", id: lineId },
    );
    setNotice("正在绘制开通阶段；新建区间和线路关系自动继承阶段日期");
  };
  const resumeLineDraft = (draftId: string) => {
    const draft = history.project.lineDrafts?.find(item => item.id === draftId);
    if (!draft) return;
    if (isLineLocked(history.project, draft.lineId)) { setNotice("线路已锁定"); return; }
    setDrawing({ kind: "line", lineId: draft.lineId, anchorStationId: draft.anchorStationId, ...(draft.phaseId ? { phaseId: draft.phaseId } : {}), draftId: draft.id });
    setActiveLineId(draft.lineId);
    setSelection(draft.anchorStationId ? { type: "station", id: draft.anchorStationId } : { type: "line", id: draft.lineId });
    setNotice("已继续未完成线路草稿");
  };
  const deletePausedLineDraft = (draftId: string) => {
    const draft = history.project.lineDrafts?.find(item => item.id === draftId);
    if (!draft || !window.confirm("删除这段未完成线路草稿？\n已完成的车站和站间区间不会受影响。")) return;
    history.commit(deleteLineDraft(history.project, draftId));
    setNotice("未完成线路草稿已删除");
  };''')

replace_once('src/App.tsx',
"              onFinishDrawing={finishDrawing}\n              view={view}",
"              onFinishDrawing={finishDrawing}\n              onResumeLineDraft={resumeLineDraft}\n              onDeleteLineDraft={deletePausedLineDraft}\n              view={view}")

# NetworkCanvas: persist every draft edit into project history, show paused drafts, resume/delete explicitly.
replace_once('src/renderer/NetworkCanvas.tsx',
"import type { ActualRouteProject, Road, Selection } from '../data/model'",
"import type { ActualRouteProject, LineDraft, Road, Selection } from '../data/model'")
replace_once('src/renderer/NetworkCanvas.tsx',
"import { appendStationToLineWithWaypoints, connectExistingStationWithWaypoints, demoteTerminalStationToDrawingPoint } from '../data/operations'",
"import { appendStationToLineWithWaypoints, connectExistingStationWithWaypoints, demoteTerminalStationToDrawingPoint } from '../data/operations'\nimport { replaceLineDraft } from '../data/lineDrafts'")
replace_once('src/renderer/NetworkCanvas.tsx',
"type LineDraftState = { lineId: string; phaseId?: string; anchorStationId: string | null; points: LineDraftPoint[]; lastCreatedStationId?: string }\ntype DrawingPointSelection",
"type DrawingPointSelection")
replace_once('src/renderer/NetworkCanvas.tsx',
"export function NetworkCanvas({ project, selection, selectedStationIds = [], onToggleStationSelection, drawing, roadDraft, phasePreview, calibration, onCalibrationPoint, onSelect, onCreatePoint, onConnectStation, onExtend, onFinishDrawing, onSegmentPoint, onPreview, onDragCommit, onEditBlocked, view, setView }:",
"export function NetworkCanvas({ project, selection, selectedStationIds = [], onToggleStationSelection, drawing, roadDraft, phasePreview, calibration, onCalibrationPoint, onSelect, onCreatePoint, onConnectStation, onExtend, onFinishDrawing, onResumeLineDraft, onDeleteLineDraft, onSegmentPoint, onPreview, onDragCommit, onEditBlocked, view, setView }:")
replace_once('src/renderer/NetworkCanvas.tsx',
"  onSelect: (selection: Selection) => void; onCreatePoint: (point: Point) => void; onConnectStation: (id: string) => void; onExtend: (id: string) => void; onFinishDrawing?: () => void\n  onSegmentPoint:",
"  onSelect: (selection: Selection) => void; onCreatePoint: (point: Point) => void; onConnectStation: (id: string) => void; onExtend: (id: string) => void; onFinishDrawing?: () => void; onResumeLineDraft?: (draftId: string) => void; onDeleteLineDraft?: (draftId: string) => void\n  onSegmentPoint:")
replace_once('src/renderer/NetworkCanvas.tsx',
"  const draftDrag = useRef<{ pointerId: number; id: string } | null>(null)",
"  const draftDrag = useRef<{ pointerId: number; id: string; before: ActualRouteProject; latest: LineDraft; moved: boolean } | null>(null)")
replace_once('src/renderer/NetworkCanvas.tsx',
"  const [lineDraft, setLineDraft] = useState<LineDraftState | null>(null)",
"  const [lineDraft, setLineDraft] = useState<LineDraft | null>(null)")
regex_once('src/renderer/NetworkCanvas.tsx', r'''  useEffect\(\(\) => \{\n    if \(drawing\?\.kind === 'line'\) \{\n      setLineDraft\(\{ lineId: drawing\.lineId, phaseId: drawing\.phaseId, anchorStationId: drawing\.anchorStationId, points: drawing\.draftPoints \?\? \[\], lastCreatedStationId: drawing\.lastCreatedStationId \}\)\n    \} else setLineDraft\(null\)\n    setDrawingPointSelection\(null\)\n  \}, \[drawing\?\.kind, drawing\?\.kind === 'line' \? drawing\.lineId : undefined, drawing\?\.kind === 'line' \? drawing\.phaseId : undefined, drawing\?\.kind === 'line' \? drawing\.anchorStationId : undefined\]\)''', r'''  useEffect(() => {
    if (drawing?.kind === 'line') {
      const stored = drawing.draftId ? project.lineDrafts?.find(item => item.id === drawing.draftId) : undefined
      setLineDraft(stored ? structuredClone(stored) : { id: drawing.draftId ?? `ephemeral:${drawing.lineId}`, lineId: drawing.lineId, phaseId: drawing.phaseId, anchorStationId: drawing.anchorStationId, points: drawing.draftPoints ?? [], lastCreatedStationId: drawing.lastCreatedStationId })
    } else setLineDraft(null)
    setDrawingPointSelection(null)
  }, [drawing?.kind, drawing?.kind === 'line' ? drawing.lineId : undefined, drawing?.kind === 'line' ? drawing.phaseId : undefined, drawing?.kind === 'line' ? drawing.anchorStationId : undefined, drawing?.kind === 'line' ? drawing.draftId : undefined, project.lineDrafts])''')

replace_once('src/renderer/NetworkCanvas.tsx',
"  const addDraftPointAt = (position: Point) => {\n    if (!lineDraft?.anchorStationId) return\n    const point = { id: uid('draft-waypoint'), x: position.x, y: position.y }\n    setLineDraft(current => current ? { ...current, points: [...current.points, point] } : current)\n    setDrawingPointSelection({ kind: 'draft', id: point.id })\n  }",
"  const addDraftPointAt = (position: Point) => {\n    if (!lineDraft?.anchorStationId) return\n    const point = { id: uid('draft-waypoint'), x: position.x, y: position.y }\n    const nextDraft = { ...lineDraft, points: [...lineDraft.points, point] }\n    setLineDraft(nextDraft)\n    onDragCommit(project, replaceLineDraft(project, nextDraft))\n    setDrawingPointSelection({ kind: 'draft', id: point.id })\n  }")

replace_once('src/renderer/NetworkCanvas.tsx',
"    const result = appendStationToLineWithWaypoints(project, lineDraft.lineId, point, before, lineDraft.anchorStationId, lineDraft.phaseId)\n    onDragCommit(project, result.project)\n    setLineDraft({ ...lineDraft, anchorStationId: result.stationId, points: after, lastCreatedStationId: result.stationId })",
"    const result = appendStationToLineWithWaypoints(project, lineDraft.lineId, point, before, lineDraft.anchorStationId, lineDraft.phaseId)\n    const nextDraft = { ...lineDraft, anchorStationId: result.stationId, points: after, lastCreatedStationId: result.stationId }\n    onDragCommit(project, replaceLineDraft(result.project, nextDraft))\n    setLineDraft(nextDraft)")
replace_once('src/renderer/NetworkCanvas.tsx',
"  const removeDraftPoint = (id: string) => {\n    setLineDraft(current => current ? { ...current, points: current.points.filter(item => item.id !== id) } : current)\n    setDrawingPointSelection(null)\n  }",
"  const removeDraftPoint = (id: string) => {\n    if (!lineDraft) return\n    const nextDraft = { ...lineDraft, points: lineDraft.points.filter(item => item.id !== id) }\n    setLineDraft(nextDraft)\n    onDragCommit(project, replaceLineDraft(project, nextDraft))\n    setDrawingPointSelection(null)\n  }")
replace_once('src/renderer/NetworkCanvas.tsx',
"    onDragCommit(project, result.project)\n    setLineDraft({ ...lineDraft, anchorStationId: result.anchorStationId, points: [...result.draftPoints, ...lineDraft.points], lastCreatedStationId: undefined })",
"    const nextDraft = { ...lineDraft, anchorStationId: result.anchorStationId, points: [...result.draftPoints, ...lineDraft.points], lastCreatedStationId: undefined }\n    onDragCommit(project, replaceLineDraft(result.project, nextDraft))\n    setLineDraft(nextDraft)")
replace_once('src/renderer/NetworkCanvas.tsx',
"    const result = connectExistingStationWithWaypoints(project, lineDraft.lineId, stationId, lineDraft.points, lineDraft.anchorStationId, lineDraft.phaseId)\n    onDragCommit(project, result.project)\n    setLineDraft({ ...lineDraft, anchorStationId: stationId, points: [], lastCreatedStationId: undefined })",
"    const result = connectExistingStationWithWaypoints(project, lineDraft.lineId, stationId, lineDraft.points, lineDraft.anchorStationId, lineDraft.phaseId)\n    const nextDraft = { ...lineDraft, anchorStationId: stationId, points: [], lastCreatedStationId: undefined }\n    onDragCommit(project, replaceLineDraft(result.project, nextDraft))\n    setLineDraft(nextDraft)")
replace_once('src/renderer/NetworkCanvas.tsx',
"        const result = appendStationToLineWithWaypoints(project, drawing.lineId, point, [], null, drawing.phaseId)\n        onDragCommit(project, result.project)\n        setLineDraft({ lineId: drawing.lineId, phaseId: drawing.phaseId, anchorStationId: result.stationId, points: [], lastCreatedStationId: result.stationId })",
"        const result = appendStationToLineWithWaypoints(project, drawing.lineId, point, [], null, drawing.phaseId)\n        const baseDraft = lineDraft ?? { id: drawing.draftId ?? `ephemeral:${drawing.lineId}`, lineId: drawing.lineId, phaseId: drawing.phaseId, anchorStationId: null, points: [] }\n        const nextDraft = { ...baseDraft, anchorStationId: result.stationId, points: [], lastCreatedStationId: result.stationId }\n        onDragCommit(project, replaceLineDraft(result.project, nextDraft))\n        setLineDraft(nextDraft)")

replace_once('src/renderer/NetworkCanvas.tsx',
"    if (draftDrag.current?.pointerId === event.pointerId) {\n      const point = pointerToWorld(event.clientX, event.clientY)\n      const id = draftDrag.current.id\n      setLineDraft(current => current ? { ...current, points: current.points.map(item => item.id === id ? { ...item, x: point.x, y: point.y } : item) } : current)\n      return\n    }",
"    if (draftDrag.current?.pointerId === event.pointerId) {\n      const point = pointerToWorld(event.clientX, event.clientY), drag = draftDrag.current, id = drag.id\n      const nextDraft = { ...drag.latest, points: drag.latest.points.map(item => item.id === id ? { ...item, x: point.x, y: point.y } : item) }\n      drag.latest = nextDraft\n      drag.moved = true\n      setLineDraft(nextDraft)\n      return\n    }")
replace_once('src/renderer/NetworkCanvas.tsx',
"    if (draftDrag.current?.pointerId === event.pointerId) { draftDrag.current = null; return }",
"    if (draftDrag.current?.pointerId === event.pointerId) { const drag = draftDrag.current; draftDrag.current = null; if (drag.moved) onDragCommit(drag.before, replaceLineDraft(drag.before, drag.latest)); return }")
replace_once('src/renderer/NetworkCanvas.tsx',
"draftDrag.current = { pointerId: event.pointerId, id: point.id };",
"draftDrag.current = { pointerId: event.pointerId, id: point.id, before: project, latest: structuredClone(lineDraft), moved: false };")

# Paused draft overlay: editor-only, resumable, explicitly deletable.
insert_marker = "  const lineDrawingOverlay = (() => {\n"
paused = r'''  const pausedLineDraftOverlay = !drawing ? <g data-layer="paused-line-drafts" data-editor="true">{(shown.lineDrafts ?? []).filter(draft => draft.points.length > 0).map(draft => {
    const anchor = draft.anchorStationId ? shown.stations.find(item => item.id === draft.anchorStationId) : undefined, rawLine = shown.lines.find(item => item.id === draft.lineId)
    if (!anchor || !rawLine) return null
    const line = lineWithEffectiveColor(shown, rawLine), endpoint = draft.points.at(-1)!
    const previewStation = { id: `__paused-draft-end__${draft.id}`, name: '', x: endpoint.x, y: endpoint.y, labelOffsetX: 0, labelOffsetY: 0 }
    const previewSegment = { id: `__paused-draft-segment__${draft.id}`, lineId: draft.lineId, fromStationId: anchor.id, toStationId: previewStation.id, mode: 'smooth' as const, structureType: 'underground' as const, structureNodes: [], waypoints: draft.points.slice(0, -1).map(point => ({ id: point.id, x: point.x, y: point.y, type: 'smooth' as const })) }
    const path = getSegmentPath({ ...shown, stations: [...shown.stations, previewStation] }, previewSegment)
    return <g key={draft.id} data-paused-line-draft-id={draft.id}>
      <path d={path} fill="none" stroke={line.color} strokeWidth={effectiveLineWidth(line, shown.settings)} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="10 7" opacity=".58" pointerEvents="none" />
      {draft.points.map(point => <circle key={point.id} cx={point.x} cy={point.y} r="5.5" fill="#fffdf9" stroke={line.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
      <g transform={`translate(${endpoint.x + 16} ${endpoint.y - 18})`}>
        <g data-resume-line-draft={draft.id} onPointerDown={event => { event.stopPropagation(); onResumeLineDraft?.(draft.id) }}><rect x="0" y="0" width="72" height="28" rx="7" fill="#fff" stroke={line.color}/><text x="36" y="19" textAnchor="middle" fontSize="13" fill="#252a27" pointerEvents="none">继续绘制</text></g>
        <g data-delete-line-draft={draft.id} transform="translate(76 0)" onPointerDown={event => { event.stopPropagation(); onDeleteLineDraft?.(draft.id) }}><rect x="0" y="0" width="28" height="28" rx="7" fill="#fff" stroke="#a1a5a2"/><text x="14" y="19" textAnchor="middle" fontSize="16" fill="#6a6f6c" pointerEvents="none">×</text></g>
      </g>
    </g>
  })}</g> : null

'''
replace_once('src/renderer/NetworkCanvas.tsx', insert_marker, paused + insert_marker)
replace_once('src/renderer/NetworkCanvas.tsx',
"    {lineDrawingOverlay}\n    <LineBadgesLayer",
"    {pausedLineDraftOverlay}\n    {lineDrawingOverlay}\n    <LineBadgesLayer")

# Tests: direct manipulation now commits each visible draft edit, and paused drafts expose explicit resume/delete.
replace_once('src/renderer/NetworkCanvas.direct.test.tsx',
"    expect(onCreatePoint).not.toHaveBeenCalled();expect(onFinishDrawing).not.toHaveBeenCalled();expect(onDragCommit).not.toHaveBeenCalled()\n    fireEvent.pointerDown(screen.getByText('切换为站点').parentElement!,{pointerId:33,bubbles:true})\n    expect(onDragCommit).toHaveBeenCalledTimes(1)\n    const next=onDragCommit.mock.calls[0][1] as typeof project",
"    expect(onCreatePoint).not.toHaveBeenCalled();expect(onFinishDrawing).not.toHaveBeenCalled();expect(onDragCommit).toHaveBeenCalledTimes(2)\n    fireEvent.pointerDown(screen.getByText('切换为站点').parentElement!,{pointerId:33,bubbles:true})\n    expect(onDragCommit).toHaveBeenCalledTimes(3)\n    const next=onDragCommit.mock.calls.at(-1)![1] as typeof project")
# Insert paused draft test before station drag test.
needle = "  it('drags a station directly and commits the whole drag once', () => {"
paused_test = r'''  it('keeps paused line drafts visible and offers explicit resume/delete actions', () => {
    const project=structuredClone(demoProject),onResumeLineDraft=vi.fn(),onDeleteLineDraft=vi.fn()
    project.lineDrafts=[{id:'draft-a',lineId:'line-a',anchorStationId:'s4',points:[{id:'p1',x:700,y:350},{id:'p2',x:760,y:390}]}]
    const {container}=render(<NetworkCanvas {...baseProps} project={project} onResumeLineDraft={onResumeLineDraft} onDeleteLineDraft={onDeleteLineDraft}/>)
    expect(container.querySelector('[data-paused-line-draft-id="draft-a"]')).toBeTruthy()
    fireEvent.pointerDown(container.querySelector('[data-resume-line-draft="draft-a"]')!,{pointerId:41,bubbles:true})
    expect(onResumeLineDraft).toHaveBeenCalledWith('draft-a')
    fireEvent.pointerDown(container.querySelector('[data-delete-line-draft="draft-a"]')!,{pointerId:42,bubbles:true})
    expect(onDeleteLineDraft).toHaveBeenCalledWith('draft-a')
  })

'''
replace_once('src/renderer/NetworkCanvas.direct.test.tsx', needle, paused_test + needle)

write('src/data/lineDrafts.test.ts', r'''import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { cleanLineDraftReferences, createLineDraft, deleteLineDraft, normalizeLineDrafts, replaceLineDraft } from './lineDrafts'

describe('persistent line drafts', () => {
  it('creates, updates and deletes editor-only incomplete tails without creating Segments', () => {
    const base=structuredClone(demoProject),beforeSegments=base.geometry.segments.length
    const created=createLineDraft(base,'line-a','s4')
    let next=replaceLineDraft(created.project,{id:created.draftId,lineId:'line-a',anchorStationId:'s4',points:[{id:'p1',x:700,y:360}]})
    expect(next.lineDrafts?.[0].points).toHaveLength(1)
    expect(next.geometry.segments).toHaveLength(beforeSegments)
    next=deleteLineDraft(next,created.draftId)
    expect(next.lineDrafts).toBeUndefined()
  })
  it('normalizes finite saved points and drops orphan/empty drafts at load cleanup', () => {
    const raw=normalizeLineDrafts([{id:'good',lineId:'line-a',anchorStationId:'s4',points:[{id:'p',x:1,y:2}]},{id:'bad',lineId:'line-a',anchorStationId:'s4',points:[{id:'p',x:'x',y:2}]}])!
    const project=structuredClone(demoProject);project.lineDrafts=raw
    const cleaned=cleanLineDraftReferences(project)
    expect(cleaned.lineDrafts?.map(item=>item.id)).toEqual(['good'])
  })
})
''')

# JSON round-trip coverage.
json_test = read('src/import-export/export.test.ts')
if not json_test.endswith('})\n'): raise RuntimeError('export.test.ts ending changed')
json_insert = r'''

  it('round-trips paused line drafts without turning them into Segments', () => {
    const project=structuredClone(demoProject),before=project.geometry.segments.length
    project.lineDrafts=[{id:'draft-save',lineId:'line-a',anchorStationId:'s4',points:[{id:'dp',x:710,y:365}]}]
    const restored=parseProjectJson(serializeProject(project))
    expect(restored.lineDrafts?.[0]).toMatchObject({id:'draft-save',lineId:'line-a',anchorStationId:'s4'})
    expect(restored.lineDrafts?.[0].points).toEqual([{id:'dp',x:710,y:365}])
    expect(restored.geometry.segments).toHaveLength(before)
  })
'''
write('src/import-export/export.test.ts', json_test[:-3] + json_insert + '})\n')

# Undo/redo coverage for draft edits now that they live in project history.
history_test = read('src/history/useProjectHistory.test.ts')
if not history_test.endswith('})\n'): raise RuntimeError('useProjectHistory.test.ts ending changed')
history_insert = r'''

  it('undoes and redoes one unfinished line-draft edit as project history', () => {
    const {result}=renderHook(()=>useProjectHistory(structuredClone(demoProject)))
    let draftId=''
    act(()=>{const created=createLineDraft(result.current.project,'line-a','s4');draftId=created.draftId;result.current.replace(created.project)})
    act(()=>result.current.commit(current=>replaceLineDraft(current,{id:draftId,lineId:'line-a',anchorStationId:'s4',points:[{id:'p1',x:700,y:360}]})))
    expect(result.current.project.lineDrafts?.[0].points).toHaveLength(1)
    act(()=>result.current.undo())
    expect(result.current.project.lineDrafts?.[0].points).toHaveLength(0)
    act(()=>result.current.redo())
    expect(result.current.project.lineDrafts?.[0].points).toHaveLength(1)
  })
'''
# add imports if needed
history_test = history_test.replace("import { useProjectHistory } from './useProjectHistory'", "import { useProjectHistory } from './useProjectHistory'\nimport { createLineDraft, replaceLineDraft } from '../data/lineDrafts'")
write('src/history/useProjectHistory.test.ts', history_test[:-3] + history_insert + '})\n')

replace_once('src/build.ts', "export const BUILD_VERSION = '2026-09-14-repeated-operation-history-81-2'", "export const BUILD_VERSION = '2026-09-15-persistent-line-drafts-82'")

print('Build82 persistent line drafts patch applied')
