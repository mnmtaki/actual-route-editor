import { useEffect, useRef, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { RasterExportDialog } from "./components/RasterExportDialog";
import { LinePanel } from "./components/LinePanel";
import { StyleDrawer } from "./components/StyleDrawer";
import { ProjectSettingsPanel } from "./components/ProjectSettingsPanel";
import { Inspector } from "./components/Inspector";
import { ContextActions } from "./components/ContextActions";
import { MobileShell } from "./components/MobileShell";
import { NetworkCanvas } from "./renderer/NetworkCanvas";
import type { ActualRouteProject, Selection, StructureType } from "./data/model";
import { uid } from "./data/model";
import { useProjectHistory } from "./history/useProjectHistory";
import {
  parseProjectJson,
  serializeProject,
} from "./import-export/projectJson";
import { detectProjectFormat } from "./import-export/detectProjectFormat";
import { convertAarcToActualRouteProject } from "./import-export/aarc";
import { importTopologyJson } from "./import-export/topologyAdapter";
import { exportSvg } from "./import-export/svgExport";
import { loadInitialProject, saveProjectToStorage } from "./data/storage";
import {
  addWaypointToSegment,
  appendStationToLine,
  batchDeleteLines,
  connectExistingStation,
  createLine,
  deleteLineAndOrphans,
  deleteStationConsistently,
  insertStationIntoSegment,
  stationLineIds,
} from "./data/operations";
import { selectLineInList, selectLinesByMarquee } from "./data/lineSelection";
import { LineMultiInspector } from "./components/LineMultiInspector";
import { StationMultiInspector } from "./components/StationMultiInspector";
import { getLineDisplayName } from "./data/lineIdentity";
import { PresentationPreview } from "./presentation/PresentationPreview";
import {
  createOpeningPhase,
  type OpeningPhasePath,
} from "./data/openingPhases";
import {
  addStructureNodeAtProgress,
  deleteStructureNode,
  setWaypointStructureAfter,
  updateStructureNode,
  type WaypointStructureChange,
} from "./data/structure";
import { findSegmentProgressForPoint } from "./geometry/path";
import {
  isAndroidApp,
  openImageDocument,
  openTextDocument,
  saveText,
  shareText,
} from "./platform/fileIO";
import "./direct-edit.css";
import {
  appendBasemapPoint,
  createBasemapPath,
  deleteBasemapPath,
  type DrawingMode,
} from "./data/basemapPaths";
import {
  appendRoadPoint,
  deleteRoad,
  deleteRoadPoint,
  finishCurrentRoad,
  snapRoadPoint,
} from "./data/roads";
import type { Road } from "./data/model";
import { isLineLocked, isSegmentGeometryLocked, isStationGeometryLocked, lockedStationMessage } from "./data/lineLock";
import { createLineLegend, getLineLegendWorldBounds } from "./data/lineLegend";
import { calibrationMetersPerWorldUnit } from "./data/distance";
import { getProjectName, projectFilename as makeProjectFilename } from "./data/projectMetadata";
import { setLinesBoolean, removeBackground as removeBackgroundCommand } from "./data/editorCommands";
type Drawing = DrawingMode;
type Point = { x: number; y: number };
export default function App() {
  const [initial] = useState(loadInitialProject),
    history = useProjectHistory(initial);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [rasterSvg, setRasterSvg] = useState<string | null>(null);
  const [styleOpen, setStyleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>(null),
    [activeLineId, setActiveLineId] = useState<string | null>(
      initial.lines[0]?.id ?? null,
    ),
    [selectedLineIds, setSelectedLineIds] = useState<string[]>([]),
    [selectedStationIds, setSelectedStationIds] = useState<string[]>([]),
    [selectionAnchorLineId, setSelectionAnchorLineId] = useState<string | null>(null),
    [view, setView] = useState({ x: 40, y: 40, width: 920, height: 680 }),
    [notice, setNotice] = useState("直接点选和拖动对象；拖空白平移"),
    [drawing, setDrawing] = useState<Drawing | null>(null),
    [roadDraft, setRoadDraft] = useState<Road | null>(null),
    [roadStyleId, setRoadStyleId] = useState("road-local"),
    [dialog, setDialog] = useState<{ seed?: string } | null>(null),
    [choice, setChoice] = useState<string | null>(null),
    [segmentPoint, setSegmentPoint] = useState<{ id: string; p: Point } | null>(
      null,
    ),
    [phasePreview, setPhasePreview] = useState<OpeningPhasePath | null>(null),
    [calibration, setCalibration] = useState<{ points: Point[] } | null>(null),
    [calibrationDialog, setCalibrationDialog] = useState<{ a: Point; b: Point; value: string; unit: 'm' | 'km' } | null>(null);
  const projectInput = useRef<HTMLInputElement>(null),
    topologyInput = useRef<HTMLInputElement>(null),
    backgroundInput = useRef<HTMLInputElement>(null),
    nameRef = useRef<HTMLInputElement>(null),
    colorRef = useRef<HTMLInputElement>(null),
    dateRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      if (!saveProjectToStorage(history.project))
        setNotice("自动保存不可用，请导出工程 JSON");
    }, 400);
    return () => clearTimeout(t);
  }, [history.project]);
  useEffect(() => {
    const close = () => {
      setSelection(null);
      setSelectedLineIds([]);
      setSelectedStationIds([]);
      setSelectionAnchorLineId(null);
      setActiveLineId(null);
    };
    window.addEventListener("actual-route-close-context", close);
    return () =>
      window.removeEventListener("actual-route-close-context", close);
  }, []);
  useEffect(() => {
    if (selection?.type === "line") {
      if (!selectedLineIds.includes(selection.id)) {
        setSelectedLineIds([selection.id]);
        setSelectionAnchorLineId(selection.id);
      }
      if (activeLineId !== selection.id) setActiveLineId(selection.id);
    } else if (selectedLineIds.length) {
      setSelectedLineIds([]);
      setSelectionAnchorLineId(null);
    }
  }, [selection?.type, selection && "id" in selection ? selection.id : undefined]);
  useEffect(() => {
    if (selection?.type === "station") {
      if (!selectedStationIds.includes(selection.id)) setSelectedStationIds([selection.id]);
    } else if (selectedStationIds.length) setSelectedStationIds([]);
  }, [selection?.type, selection && "id" in selection ? selection.id : undefined]);
  const applyLineSelection = (state: { selectedLineIds: string[]; activeLineId: string | null; selectionAnchorLineId: string | null }) => {
    setSelectedLineIds(state.selectedLineIds);
    setActiveLineId(state.activeLineId);
    setSelectionAnchorLineId(state.selectionAnchorLineId);
    setSelection(state.activeLineId ? { type: "line", id: state.activeLineId } : null);
  };
  const handleLineSelect = (lineId: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) => {
    applyLineSelection(selectLineInList({
      lineIds: history.project.lines.map(line => line.id),
      lineId,
      selectedLineIds,
      activeLineId,
      selectionAnchorLineId,
      ...modifiers,
    }));
  };
  const handleLineMarquee = (hitLineIds: string[], additive: boolean) => {
    applyLineSelection(selectLinesByMarquee(
      history.project.lines.map(line => line.id),
      hitLineIds,
      selectedLineIds,
      activeLineId,
      additive,
    ));
  };
  const clearLineSelection = () => {
    setSelectedLineIds([]);
    setSelectionAnchorLineId(null);
    setActiveLineId(null);
    setSelection(null);
  };
  const resetLineSelectionForProject = (project: ActualRouteProject) => {
    setSelectedLineIds([]);
    setSelectionAnchorLineId(null);
    setActiveLineId(project.lines[0]?.id ?? null);
    setSelection(null);
    setSelectedStationIds([]);
  };
  const handleCanvasSelect = (next: Selection) => {
    if (next?.type === "line") applyLineSelection({ selectedLineIds: [next.id], activeLineId: next.id, selectionAnchorLineId: next.id });
    else {
      setSelectedLineIds([]);
      setSelectionAnchorLineId(null);
      setSelectedStationIds(next?.type === "station" ? [next.id] : []);
      setSelection(next);
    }
  };
  const toggleStationSelection = (stationId: string) => {
    setSelectedLineIds([]);
    setSelectionAnchorLineId(null);
    setSelectedStationIds(current => {
      const next = current.includes(stationId) ? current.filter(id => id !== stationId) : [...current, stationId];
      setSelection(next.length ? { type: "station", id: next.at(-1)! } : null);
      return next;
    });
  };
  const batchSetLineValue = (field: "visible" | "locked", value: boolean) => {
    if (selectedLineIds.length < 2) return;
    history.commit(current => setLinesBoolean(current, selectedLineIds, field, value));
  };
  const batchDeleteSelectedLines = () => {
    if (selectedLineIds.length < 2) return;
    const lockedIds = new Set(history.project.lines.filter(line => selectedLineIds.includes(line.id) && line.locked).map(line => line.id));
    const next = batchDeleteLines(history.project, selectedLineIds);
    if (next === history.project) {
      setNotice("所选线路均已锁定，无法删除");
      return;
    }
    history.commit(next);
    const remaining = selectedLineIds.filter(id => next.lines.some(line => line.id === id));
    const nextActive = activeLineId && remaining.includes(activeLineId) ? activeLineId : (remaining[0] ?? null);
    setSelectedLineIds(remaining);
    setSelectionAnchorLineId(nextActive);
    setActiveLineId(nextActive);
    setSelection(nextActive ? { type: "line", id: nextActive } : null);
    if (lockedIds.size) setNotice(String(lockedIds.size) + " 条锁定线路已保留");
  };
  useEffect(() => {
    if (!history.project.timeline.playing) return;
    const t = setInterval(() => {
      const n = structuredClone(history.project),
        d = new Date(`${n.timeline.currentDate}T00:00:00`);
      d.setMonth(d.getMonth() + 3);
      const v = d.toISOString().slice(0, 10);
      if (v >= n.timeline.endDate) {
        n.timeline.currentDate = n.timeline.endDate;
        n.timeline.playing = false;
      } else n.timeline.currentDate = v;
      history.replace(n);
    }, 240);
    return () => clearInterval(t);
  }, [history.project, history.replace]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (calibration || calibrationDialog)) {
        event.preventDefault();
        setCalibration(null);
        setCalibrationDialog(null);
        setNotice("已取消距离标定");
        return;
      }
      if (!drawing) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input,textarea,select,[contenteditable="true"]'))
        return;
      if (event.key === "Enter") {
        event.preventDefault();
        finishDrawing();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelDrawing();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawing, calibration, calibrationDialog]);
  const bounds = (ids?: Set<string>) => {
    const s = ids
      ? history.project.stations.filter((x) => ids.has(x.id))
      : history.project.stations;
    const legendBounds = !ids && history.project.lineLegend?.visible ? getLineLegendWorldBounds(history.project, history.project.lineLegend) : null;
    if (!s.length && !legendBounds) return { x: 0, y: 0, width: 1000, height: 700 };
    const xs = s.map((x) => x.x),
      ys = s.map((x) => x.y),
      p = 100;
    if (legendBounds) { xs.push(legendBounds.x, legendBounds.x + legendBounds.width); ys.push(legendBounds.y, legendBounds.y + legendBounds.height) }
    return {
      x: Math.min(...xs) - p,
      y: Math.min(...ys) - p,
      width: Math.max(300, Math.max(...xs) - Math.min(...xs) + p * 2),
      height: Math.max(220, Math.max(...ys) - Math.min(...ys) + p * 2),
    };
  };
  const fitAll = () => setView(bounds());
  const zoomSelection = () =>
    selection?.type === "station"
      ? setView(bounds(new Set([selection.id])))
      : fitAll();
  const startLine = () => setDialog({});
  const confirmLine = () => {
    const seed = dialog?.seed;
    const openedAt =
      dateRef.current?.value || history.project.timeline.currentDate;
    const r = createLine(history.project, {
      name: nameRef.current?.value ?? "",
      color: colorRef.current?.value ?? "#6b58c4",
      openedAt,
    });
    const phase = createOpeningPhase(r.project, {
      lineId: r.lineId,
      name: "一期",
      openedAt,
      revealStartStationId: seed,
    });
    let next = phase.project;
    if (seed)
      next = connectExistingStation(next, r.lineId, seed, null, phase.phaseId);
    history.commit(next);
    setActiveLineId(r.lineId);
    setDrawing({
      kind: "line",
      lineId: r.lineId,
      anchorStationId: seed ?? null,
      phaseId: phase.phaseId,
    });
    setSelection(
      seed ? { type: "station", id: seed } : { type: "line", id: r.lineId },
    );
    setDialog(null);
    setNotice("连续点击画布创建站点；新对象自动继承“一期”开通日期");
  };
  const startBasemapDrawing = (category: "water" | "terrain" | "other") => {
    const result = createBasemapPath(history.project, category, {
      x: view.x + view.width / 2,
      y: view.y + view.height / 2,
    });
    history.commit(result.project);
    setDrawing({ kind: "basemap", pathId: result.pathId });
    setSelection({ type: "basemapPath", id: result.pathId });
    setNotice("正在绘制底图路径；点击地图添加节点，完成后结束绘制");
  };
  const startRoadDrawing = (styleId = roadStyleId) => {
    setRoadStyleId(styleId);
    const roadId = uid("road");
    setRoadDraft({
      id: roadId,
      points: [],
      styleId,
      zIndex: 0,
      visible: true,
      locked: false,
      createdOrder: history.project.roads?.length ?? 0,
    });
    setDrawing({ kind: "road", roadId, styleId });
    setSelection({ type: "road", id: roadId });
    setNotice(
      "正在绘制道路；点击地图添加节点，Enter/双击完成当前道路，Esc退出",
    );
  };
  const finishDrawing = () => {
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
    setRoadDraft(null);
    if (drawing?.kind === "road") setSelection(null);
    setDrawing(null);
    setNotice("已退出绘制");
  };
  const createAt = (p: Point) => {
    if (!drawing) return;
    if (drawing.kind === "basemap") {
      history.commit(appendBasemapPoint(history.project, drawing.pathId, p));
      return;
    }
    if (drawing.kind === "road") {
      const snapped = snapRoadPoint(history.project, p);
      setRoadDraft(
        (current) =>
          (current &&
            appendRoadPoint(
              { ...history.project, roads: [current] },
              current.id,
              snapped,
            ).roads?.[0]) ??
          current,
      );
      return;
    }
    if (drawing.kind === "line" && isLineLocked(history.project, drawing.lineId)) {
      setNotice("线路已锁定");
      return;
    }
    const r = appendStationToLine(
      history.project,
      drawing.lineId,
      p,
      drawing.anchorStationId,
      drawing.phaseId,
    );
    history.commit(r.project);
    setDrawing({ ...drawing, anchorStationId: r.stationId });
    setSelection({ type: "station", id: r.stationId });
  };
  const connect = (id: string) => {
    if (!drawing || drawing.kind !== "line") return;
    if (isLineLocked(history.project, drawing.lineId)) {
      setNotice("线路已锁定");
      return;
    }
    if (drawing.anchorStationId === id) {
      setDrawing(null);
      setNotice("环线已闭合");
      return;
    }
    const station = history.project.stations.find((s) => s.id === id);
    if (confirm(`连接到已有站“${station?.name ?? "未命名站"}”？`)) {
      history.commit(
        connectExistingStation(
          history.project,
          drawing.lineId,
          id,
          drawing.anchorStationId,
          drawing.phaseId,
        ),
      );
      setDrawing({ ...drawing, anchorStationId: id });
      setSelection({ type: "station", id });
    }
  };
  const extend = (stationId: string) => {
    const ids = stationLineIds(history.project, stationId);
    if (ids.length === 1) {
      if (isLineLocked(history.project, ids[0])) {
        setNotice("线路已锁定");
        return;
      }
      setDrawing({ kind: "line", lineId: ids[0], anchorStationId: stationId });
      setActiveLineId(ids[0]);
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
      setDrawing({ kind: "line", lineId, anchorStationId: stationId });
      setActiveLineId(lineId);
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
    setDrawing({ kind: "line", lineId, anchorStationId: stationId, phaseId });
    setActiveLineId(lineId);
    setSelection(
      stationId
        ? { type: "station", id: stationId }
        : { type: "line", id: lineId },
    );
    setNotice("正在绘制开通阶段；新建区间和线路关系自动继承阶段日期");
  };
  const removeBackground = () => {
    if (!history.project.background) return false;
    if (
      !window.confirm(
        "删除当前底图？\n删除后将从当前工程中移除底图，不影响线路和车站。",
      )
    )
      return false;
    history.commit((current) => removeBackgroundCommand(current));
    if (selection?.type === "background") setSelection(null);
    setNotice("已删除底图");
    return true;
  };
  const startCalibration = () => {
    setCalibration({ points: [] });
    setCalibrationDialog(null);
    setSettingsOpen(false);
    setNotice("请在地图上点击两个已知距离的点");
  };
  const handleCalibrationPoint = (point: Point) => {
    if (!calibration || calibrationDialog) return;
    if (calibration.points.length === 0) {
      setCalibration({ points: [point] });
      setNotice("已记录第一个标定点，请点击第二个点");
      return;
    }
    const a = calibration.points[0];
    setCalibration({ points: [a, point] });
    setCalibrationDialog({ a, b: point, value: "", unit: "m" });
  };
  const commitCalibration = () => {
    if (!calibrationDialog) return;
    const { a, b, value, unit } = calibrationDialog;
    const metersPerWorldUnit = calibrationMetersPerWorldUnit(a, b, Number(value), unit);
    if (!metersPerWorldUnit) {
      setNotice("请输入大于 0 的实际距离");
      return;
    }
    history.commit(current => ({ ...structuredClone(current), distanceScale: { metersPerWorldUnit }, settings: { ...current.settings, worldUnitsPerKm: 1000 / metersPerWorldUnit } }));
    setCalibration(null);
    setCalibrationDialog(null);
    setNotice(`距离比例已更新：1 坐标单位 = ${metersPerWorldUnit.toFixed(3)} 米`);
  };
  const deleteSelection = () => {
    if (!selection) return;
    if (selection.type === "line" && selectedLineIds.length > 1) {
      batchDeleteSelectedLines();
      return;
    }
    if (selection.type === "background") {
      removeBackground();
      return;
    }
    if (selection.type === "line" && isLineLocked(history.project, selection.id)) {
      setNotice("线路已锁定");
      return;
    }
    if (selection.type === "station" && isStationGeometryLocked(history.project, selection.id)) {
      setNotice(lockedStationMessage(history.project, selection.id));
      return;
    }
    if ((selection.type === "segment" || selection.type === "waypoint" || selection.type === "structureNode") && isSegmentGeometryLocked(history.project, selection.type === "segment" ? selection.id : selection.segmentId)) {
      setNotice("线路已锁定");
      return;
    }
    let n = history.project;
    if (selection.type === "station")
      n = deleteStationConsistently(n, selection.id);
    else if (selection.type === "line")
      n = deleteLineAndOrphans(n, selection.id);
    else if (selection.type === "lineBadge") {
      n = structuredClone(n);
      const line = n.lines.find((item) => item.id === selection.lineId);
      if (line)
        line.lineBadges = (line.lineBadges ?? []).filter(
          (item) => item.id !== selection.id,
        );
    } else {
      n = structuredClone(n);
      if (selection.type === "segment") {
        n.geometry.segments = n.geometry.segments.filter(
          (s) => s.id !== selection.id,
        );
        n.openingPhases.forEach((phase) => {
          phase.segmentIds = phase.segmentIds.filter(
            (id) => id !== selection.id,
          );
          phase.overriddenSegmentIds = phase.overriddenSegmentIds?.filter(
            (id) => id !== selection.id,
          );
        });
      } else if (selection.type === "waypoint") {
        const s = n.geometry.segments.find((s) => s.id === selection.segmentId);
        if (s) {
          s.waypoints = s.waypoints.filter((w) => w.id !== selection.id);
          s.structureNodes = (s.structureNodes ?? []).filter(
            (node) => node.waypointId !== selection.id,
          );
        }
      } else if (selection.type === "structureNode")
        n = deleteStructureNode(n, selection.segmentId, selection.id);
      else if (selection.type === "mapElement")
        n.mapElements = (n.mapElements ?? []).filter(
          (item) => item.id !== selection.id,
        );
      else if (selection.type === "lineLegend") delete n.lineLegend;
      else if (selection.type === "basemapPath")
        n = deleteBasemapPath(n, selection.id);
      else if (selection.type === "road") n = deleteRoad(n, selection.id);
      else if (selection.type === "roadPoint") n = deleteRoadPoint(n, selection.roadId, selection.id);
    }
    history.commit(n);
    if (selection.type === "line") clearLineSelection();
    else { setSelectedStationIds([]); setSelection(null); }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === "Escape" && selectedLineIds.length) {
        event.preventDefault();
        clearLineSelection();
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedLineIds.length > 1) {
        event.preventDefault();
        batchDeleteSelectedLines();
      } else if (selectedLineIds.length === 1 && selection?.type === "line") {
        event.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLineIds, selection, activeLineId, history.project]);
  const segmentAction = (kind: "station" | "waypoint" | "straight") => {
    if (selection?.type !== "segment") return;
    if (isSegmentGeometryLocked(history.project, selection.id)) {
      setNotice("线路已锁定");
      return;
    }
    const p = segmentPoint?.id === selection.id ? segmentPoint.p : null;
    if (kind === "straight") {
      const n = structuredClone(history.project),
        s = n.geometry.segments.find((s) => s.id === selection.id);
      if (s) {
        s.waypoints = [];
        s.mode = "straight";
      }
      history.commit(n);
      return;
    }
    if (!p) return;
    if (kind === "station") {
      const r = insertStationIntoSegment(history.project, selection.id, p);
      history.commit(r.project);
      if (r.stationId) setSelection({ type: "station", id: r.stationId });
    } else {
      const r = addWaypointToSegment(history.project, selection.id, p);
      history.commit(r.project);
      if (r.waypointId)
        setSelection({
          type: "waypoint",
          id: r.waypointId,
          segmentId: selection.id,
        });
    }
  };
  const setStructureAtPoint = (
    value: "underground" | "elevated",
  ) => {
    if (selection?.type !== "segment") return;
    if (isSegmentGeometryLocked(history.project, selection.id)) {
      setNotice("线路已锁定");
      return;
    }
    const point = segmentPoint?.id === selection.id ? segmentPoint.p : null,
      segment = history.project.geometry.segments.find(
        (item) => item.id === selection.id,
      );
    if (!point || !segment) return;
    const result = addStructureNodeAtProgress(
      history.project,
      segment.id,
      findSegmentProgressForPoint(history.project, segment, point),
      value,
    );
    history.commit(result.project);
    if (result.nodeId)
      setSelection({
        type: "structureNode",
        id: result.nodeId,
        segmentId: segment.id,
      });
  };
  const setSelectedSegmentStructure = (value: StructureType) => {
    if (selection?.type !== "segment") return;
    if (isSegmentGeometryLocked(history.project, selection.id)) {
      setNotice("线路已锁定");
      return;
    }
    history.commit(current => {
      const next = structuredClone(current);
      const segment = next.geometry.segments.find(item => item.id === selection.id);
      if (segment) segment.structureType = value;
      return next;
    });
  };
  const setWaypointStructure = (
    value: WaypointStructureChange,
  ) => {
    if (selection?.type !== "waypoint") return;
    if (isSegmentGeometryLocked(history.project, selection.segmentId)) {
      setNotice("线路已锁定");
      return;
    }
    history.commit(
      setWaypointStructureAfter(
        history.project,
        selection.segmentId,
        selection.id,
        value,
      ),
    );
  };
  const setSelectedStructureNode = (
    value: "underground" | "elevated",
  ) => {
    if (selection?.type !== "structureNode") return;
    if (isSegmentGeometryLocked(history.project, selection.segmentId)) {
      setNotice("线路已锁定");
      return;
    }
    history.commit(
      updateStructureNode(
        history.project,
        selection.segmentId,
        selection.id,
        value,
      ),
    );
  };
  const read = (i: HTMLInputElement, cb: (t: string, f: File) => void) => {
    const f = i.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => cb(String(r.result), f);
    r.readAsText(f, "UTF-8");
    i.value = "";
  };
  const importProject = (i: HTMLInputElement) =>
    read(i, (t, f) => {
      try {
        const raw = JSON.parse(t),
          format = detectProjectFormat(raw);
        if (format === "unknown")
          throw new Error(
            "无法识别 JSON：既不是实际走向工程，也不是 AARC 工程",
          );
        if (format === "aarc") {
          const result = convertAarcToActualRouteProject(raw, f.name),
            n = result.project;
          history.commit(n);
          resetLineSelectionForProject(n);
          const xs = n.stations.map((s) => s.x),
            ys = n.stations.map((s) => s.y),
            pad = 100;
          if (xs.length)
            setView({
              x: Math.min(...xs) - pad,
              y: Math.min(...ys) - pad,
              width: Math.max(300, Math.max(...xs) - Math.min(...xs) + pad * 2),
              height: Math.max(
                220,
                Math.max(...ys) - Math.min(...ys) + pad * 2,
              ),
            });
          console.warn("AARC import warnings", result.summary.warnings);
          setNotice(
            "已导入 AARC 工程； " +
              result.summary.realLineCount +
              " 条真实线路； " +
              result.summary.stationCount +
              " 个车站； " +
              result.summary.totalWaypointCount +
              " 个路径点（显式 " +
              result.summary.explicitWaypointCount +
              "； 隐式转角 " +
              result.summary.implicitCornerCount +
              "）； " +
              result.summary.ignoredHelperCount +
              " 个辅助对象已忽略； " +
              result.summary.warningCount +
              " 条兼容性警告",
          );
        } else {
          const n = parseProjectJson(t);
          history.commit(n);
          resetLineSelectionForProject(n);
          setNotice("工程 JSON 已恢复");
        }
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "导入失败");
      }
    });
  const importTopology = (i: HTMLInputElement) =>
    read(i, (t, f) => {
      try {
        const raw = JSON.parse(t);
        if (detectProjectFormat(raw) === "aarc") {
          const result = convertAarcToActualRouteProject(raw, f.name),
            n = result.project;
          history.commit(n);
          resetLineSelectionForProject(n);
          const xs = n.stations.map((s) => s.x),
            ys = n.stations.map((s) => s.y),
            pad = 100;
          if (xs.length)
            setView({
              x: Math.min(...xs) - pad,
              y: Math.min(...ys) - pad,
              width: Math.max(300, Math.max(...xs) - Math.min(...xs) + pad * 2),
              height: Math.max(
                220,
                Math.max(...ys) - Math.min(...ys) + pad * 2,
              ),
            });
          console.warn("AARC import warnings", result.summary.warnings);
          setNotice(
            "已导入 AARC 工程； " +
              result.summary.realLineCount +
              " 条真实线路； " +
              result.summary.stationCount +
              " 个车站； " +
              result.summary.totalWaypointCount +
              " 个路径点（显式 " +
              result.summary.explicitWaypointCount +
              "； 隐式转角 " +
              result.summary.implicitCornerCount +
              "）； " +
              result.summary.ignoredHelperCount +
              " 个辅助对象已忽略； " +
              result.summary.warningCount +
              " 条兼容性警告",
          );
        } else {
          const n = importTopologyJson(t);
          history.commit(n);
          resetLineSelectionForProject(n);
          setNotice("旧拓扑已转换；坐标已重新初始化");
        }
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "导入失败");
      }
    });
  const importBg = (i: HTMLInputElement) => {
    const f = i.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () =>
        history.commit((c) => ({
          ...structuredClone(c),
          background: {
            dataUrl: String(r.result),
            name: f.name,
            x: 50,
            y: 50,
            width: 850,
            height: (850 * img.height) / img.width,
            opacity: 0.55,
            visible: true,
            locked: true,
          },
        }));
      img.src = String(r.result);
    };
    r.readAsDataURL(f);
    i.value = "";
  };
  const importNativeJson = async (kind: "project" | "topology") => {
    if (!isAndroidApp()) {
      if (kind === "project") projectInput.current?.click();
      else topologyInput.current?.click();
      return;
    }
    try {
      const file = await openTextDocument(),
        t = file.text ?? "",
        raw = JSON.parse(t),
        format = detectProjectFormat(raw);
      if (format === "aarc") {
        const result = convertAarcToActualRouteProject(raw, file.name),
          n = result.project;
        history.commit(n);
        resetLineSelectionForProject(n);
        setView(bounds());
        setNotice(
          "已导入 AARC 工程； " +
            result.summary.realLineCount +
            " 条真实线路； " +
            result.summary.stationCount +
            " 个车站； " +
            result.summary.totalWaypointCount +
            " 个路径点",
        );
      } else if (kind === "project") {
        const n = parseProjectJson(t);
        history.commit(n);
        resetLineSelectionForProject(n);
        setNotice("工程 JSON 已恢复");
      } else {
        const n = importTopologyJson(t);
        history.commit(n);
        resetLineSelectionForProject(n);
        setNotice("旧拓扑已转换；坐标已重新初始化");
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "导入失败");
    }
  };
  const importNativeBackground = async () => {
    if (!isAndroidApp()) {
      backgroundInput.current?.click();
      return;
    }
    try {
      const file = await openImageDocument();
      if (!file.dataUrl) return;
      const img = new Image();
      img.onload = () =>
        history.commit((c) => ({
          ...structuredClone(c),
          background: {
            dataUrl: file.dataUrl!,
            name: file.name,
            x: 50,
            y: 50,
            width: 850,
            height: (850 * img.height) / img.width,
            opacity: 0.55,
            visible: true,
            locked: true,
          },
        }));
      img.src = file.dataUrl;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "底图导入失败");
    }
  };
  const projectFilename = makeProjectFilename(history.project, ".actual-route.json"),
    projectText = () => serializeProject(history.project);
  const svgFile = () => {
    const canvas = document.getElementById(
      "network-canvas",
    ) as SVGSVGElement | null;
    return canvas
      ? exportSvg(canvas, history.project.settings.exportBackground)
      : null;
  };
  const saveProjectFile = () =>
    saveText(projectFilename, projectText(), "application/json")
      .then(() => setNotice("工程 JSON 已保存"))
      .catch((e) => setNotice(e instanceof Error ? e.message : "保存失败"));
  const saveSvgFile = () => {
    const text = svgFile();
    if (text)
      return saveText(makeProjectFilename(history.project, ".svg"), text, "image/svg+xml")
        .then(() => setNotice("SVG 已保存"))
        .catch((e) => setNotice(e instanceof Error ? e.message : "保存失败"));
  };
  const shareProjectFile = () =>
    shareText(projectFilename, projectText(), "application/json").catch((e) =>
      setNotice(e instanceof Error ? e.message : "分享失败"),
    );
  const shareSvgFile = () => {
    const text = svgFile();
    if (text)
      return shareText(
        makeProjectFilename(history.project, ".svg"),
        text,
        "image/svg+xml",
      ).catch((e) => setNotice(e instanceof Error ? e.message : "分享失败"));
  };
  const addMapElement = () => {
    const id = uid("map"),
      x = view.x + view.width / 2,
      y = view.y + view.height / 2;
    history.commit((current) => {
      const next = structuredClone(current);
      next.mapElements ??= [];
      next.mapElements.push({
        id,
        type: "text",
        x,
        y,
        text: "文本",
        fontSize: 28,
        fontWeight: "bold",
        textAlign: "middle",
        rotation: 0,
        visible: true,
      });
      return next;
    });
    setSelection({ type: "mapElement", id });
    setNotice("已添加自由文本，可直接拖动");
  };
  const addLineBadge = (lineId: string) => {
    const id = uid("line_badge"),
      x = view.x + view.width / 2,
      y = view.y + view.height / 2;
    history.commit((current) => {
      const next = structuredClone(current),
        line = next.lines.find((item) => item.id === lineId);
      if (!line) return current;
      line.lineBadges ??= [];
      line.lineBadges.push({ id, x, y, size: 42, rotation: 0, visible: true });
      return next;
    });
    setSelection({ type: "lineBadge", id, lineId });
    setNotice("已添加线路标号，可直接拖动");
  };
  const addLineLegend = () => {
    if (history.project.lineLegend) {
      setSelection({ type: 'lineLegend', id: history.project.lineLegend.id });
      setNotice('已选中线路图例');
      return;
    }
    const result = createLineLegend(history.project, { x: view.x + view.width * .08, y: view.y + view.height * .08 });
    history.commit(result.project);
    if (result.legendId) setSelection({ type: 'lineLegend', id: result.legendId });
    setNotice('已添加线路图例，可在属性中编辑');
  };
  return (
    <>
      <MobileShell
        project={history.project}
        selection={selection}
        drawing={Boolean(drawing)}
        roadDrawing={drawing?.kind === "road"}
        roadStyleId={roadStyleId}
        onRoadStyleChange={setRoadStyleId}
        activeLineId={activeLineId}
        selectedLineIds={selectedLineIds}
        selectedStationIds={selectedStationIds}
        onSelectLine={(id) => handleLineSelect(id)}
        onStartLineMultiSelect={(id) => handleLineSelect(id)}
        onToggleLineSelection={(id) => handleLineSelect(id, { ctrlKey: true })}
        onToggleStationSelection={toggleStationSelection}
        onClearLineSelection={clearLineSelection}
        onBatchSetLinesVisible={value => batchSetLineValue("visible", value)}
        onBatchSetLinesLocked={value => batchSetLineValue("locked", value)}
        onBatchDeleteLines={batchDeleteSelectedLines}
        onSelectRoad={(id) => setSelection({ type: "road", id })}
        onSelectBasemapPath={(id) => setSelection({ type: "basemapPath", id })}
        onChange={history.commit}
        onPreviewChange={history.replace}
        onCommitChange={history.commitFrom}
        onAddLine={startLine}
        onOpenPresentation={() => setPresentationOpen(true)}
        onAddText={addMapElement}
        onAddRoad={() => startRoadDrawing()}
        onAddBasemapPath={startBasemapDrawing}
        onImportProject={() => void importNativeJson("project")}
        onImportTopology={() => void importNativeJson("topology")}
        onImportBackground={() => void importNativeBackground()}
        onExportProject={() => void saveProjectFile()}
        onExportSvg={() => void saveSvgFile()}
        onExportImage={() => setRasterSvg(svgFile())}
        onShareProject={() => void shareProjectFile()}
        onShareSvg={() => void shareSvgFile()}
        onFitAll={fitAll}
        onZoomSelection={zoomSelection}
        onDeleteSelection={deleteSelection}
        onAddLineBadge={addLineBadge}
        onOpenStationStyles={() => setStyleOpen(true)}
        onAddLineLegend={addLineLegend}
        onSelectLineLegend={() => { if (history.project.lineLegend) setSelection({ type: 'lineLegend', id: history.project.lineLegend.id }) }}
        onPhasePreview={setPhasePreview}
        onStartPhaseDrawing={startPhaseDrawing}
        onExtend={extend}
        onInsertStation={() => segmentAction("station")}
        onAddWaypoint={() => segmentAction("waypoint")}
        onStraighten={() => segmentAction("straight")}
        onStructureChange={setSelectedSegmentStructure}
        onSetStructureAtPoint={setStructureAtPoint}
        onWaypointStructureChange={setWaypointStructure}
        onStructureNodeChange={setSelectedStructureNode}
        onFinishDrawing={finishDrawing}
        onExitDrawing={exitDrawingTool}
        onStartCalibration={startCalibration}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={history.undo}
        onRedo={history.redo}
        nativeFiles={isAndroidApp()}
      />
      <div className="app-shell">
        <Toolbar
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          undo={history.undo}
          redo={history.redo}
          fitAll={fitAll}
          zoomSelection={zoomSelection}
          onNewLine={startLine}
          onAddText={addMapElement}
          onAddRoad={() => startRoadDrawing()}
          onAddBasemapPath={startBasemapDrawing}
          onAddLineLegend={addLineLegend}
          onSelectLineLegend={() => { if (history.project.lineLegend) setSelection({ type: 'lineLegend', id: history.project.lineLegend.id }) }}
          lineLegend={history.project.lineLegend}
          basemapPaths={history.project.basemapPaths}
          onSelectBasemapPath={(id) =>
            setSelection({ type: "basemapPath", id })
          }
          onStyle={() => setStyleOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onPresentation={() => setPresentationOpen(true)}
          projectName={getProjectName(history.project)}
          onProjectNameChange={(name) => history.commit((current) => {
            const next = structuredClone(current)
            next.projectName = name
            next.name = name
            return next
          })}
          drawing={!!drawing}
          onFinish={finishDrawing}
          importProject={() => void importNativeJson("project")}
          importTopology={() => void importNativeJson("topology")}
          importBackground={() => void importNativeBackground()}
          exportProject={() => void saveProjectFile()}
          exportSvg={() => void saveSvgFile()}
          exportImage={() => setRasterSvg(svgFile())}
          shareProject={() => void shareProjectFile()}
          shareSvg={() => void shareSvgFile()}
          nativeFiles={isAndroidApp()}
        />
        <input
          ref={projectInput}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => importProject(e.currentTarget)}
        />
        <input
          ref={topologyInput}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => importTopology(e.currentTarget)}
        />
        <input
          ref={backgroundInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => importBg(e.currentTarget)}
        />
        <main className="workspace">
          <LinePanel
            project={history.project}
            selection={selection}
            activeLineId={activeLineId}
            selectedLineIds={selectedLineIds}
            onSelect={handleLineSelect}
            onSelectionChange={handleLineMarquee}
            onClearSelection={clearLineSelection}
            onChange={history.commit}
            onAddLine={startLine}
          />
          <section className="canvas-wrap">
            <div className="canvas-status">
              <span>{getProjectName(history.project)}</span>
              <span>{Math.round((920 / view.width) * 100)}%</span>
              <span>{notice}</span>
            </div>
            {drawing && (
              <div className="creation-banner">
                {drawing.kind === "basemap"
                  ? "正在绘制底图路径"
                  : drawing.kind === "road"
                    ? "正在绘制道路"
                    : `正在绘制 ${getLineDisplayName(history.project, drawing.lineId) || "线路"}`}
                ； 点击空白新增节点； 点击已有站接入
              </div>
            )}
            <NetworkCanvas
              project={history.project}
              selection={selection}
              selectedStationIds={selectedStationIds}
              onToggleStationSelection={toggleStationSelection}
              drawing={drawing}
              roadDraft={roadDraft}
              phasePreview={phasePreview}
              calibration={calibration}
              onCalibrationPoint={handleCalibrationPoint}
              onSelect={handleCanvasSelect}
              onCreatePoint={createAt}
              onConnectStation={connect}
              onExtend={extend}
              onSegmentPoint={(id, p) => setSegmentPoint({ id, p })}
              onPreview={history.replace}
              onDragCommit={history.commitFrom}
              onEditBlocked={setNotice}
              onFinishDrawing={finishDrawing}
              view={view}
              setView={setView}
            />
            <ContextActions
              project={history.project}
              selection={selection}
              onExtend={extend}
              onInsertStation={() => segmentAction("station")}
              onAddWaypoint={() => segmentAction("waypoint")}
              onStraighten={() => segmentAction("straight")}
              onStructureChange={setSelectedSegmentStructure}
              onSetStructureAtPoint={setStructureAtPoint}
              onWaypointStructureChange={setWaypointStructure}
              onStructureNodeChange={setSelectedStructureNode}
              onDelete={deleteSelection}
            />
          </section>
          {selectedLineIds.length > 1 ? <LineMultiInspector
            project={history.project}
            selectedLineIds={selectedLineIds}
            onChange={history.commit}
            onDelete={batchDeleteSelectedLines}
            onSetVisible={value => batchSetLineValue("visible", value)}
            onSetLocked={value => batchSetLineValue("locked", value)}
          /> : selectedStationIds.length > 1 ? <StationMultiInspector project={history.project} selectedStationIds={selectedStationIds} onChange={history.commit} /> : <Inspector
            project={history.project}
            selection={selection}
            onChange={history.commit}
            onDelete={deleteSelection}
            onAddLineBadge={addLineBadge}
            onOpenStationStyles={() => setStyleOpen(true)}
            onPhasePreview={setPhasePreview}
            onStartPhaseDrawing={startPhaseDrawing}
          />}
        </main>
        {styleOpen && (
          <StyleDrawer
            project={history.project}
            onChange={history.commit}
            onPreviewChange={history.replace}
            onCommitChange={history.commitFrom}
            onClose={() => setStyleOpen(false)}
          />
        )}
        {settingsOpen && <aside className="project-settings-overlay" role="dialog" aria-label="工程设置"><header><div><h2>工程设置</h2><span className="panel-subtitle">工程名称与距离比例</span></div><button data-android-back-dismiss className="icon-button" aria-label="关闭工程设置" onClick={() => setSettingsOpen(false)}>×</button></header><ProjectSettingsPanel project={history.project} onChange={history.commit} onStartCalibration={startCalibration}/></aside>}
        {dialog && (
          <div
            data-android-back-dismiss
            className="line-dialog-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) setDialog(null);
            }}
          >
            <div className="line-dialog">
              <h2>{dialog.seed ? "从本站新建线路" : "新建线路"}</h2>
              <label className="field">
                <span>线路名称</span>
                <input
                  ref={nameRef}
                  autoFocus
                  defaultValue={`新线路 ${history.project.lines.length + 1}`}
                />
              </label>
              <label className="field">
                <span>线路颜色</span>
                <input ref={colorRef} type="color" defaultValue="#6b58c4" />
              </label>
              <label className="field">
                <span>可选开通时间</span>
                <input
                  ref={dateRef}
                  type="date"
                  defaultValue={history.project.timeline.currentDate}
                />
              </label>
              <div className="line-dialog-actions">
                <button onClick={() => setDialog(null)}>取消</button>
                <button className="primary" onClick={confirmLine}>
                  开始绘制
                </button>
              </div>
            </div>
          </div>
        )}
        {choice && (
          <div className="line-choice">
            <h3>从这里继续</h3>
            {stationLineIds(history.project, choice).map((id) => (
              <button key={id} onClick={() => choose(id)}>
                {getLineDisplayName(history.project, id)}
              </button>
            ))}
            <button className="primary" onClick={() => choose()}>
              ＋ 新建线路
            </button>
            <button data-android-back-dismiss onClick={() => setChoice(null)}>
              取消
            </button>
          </div>
        )}
        {calibrationDialog && <div className="line-dialog-backdrop" data-android-back-dismiss onClick={event => { if (event.target === event.currentTarget) { setCalibrationDialog(null); setCalibration(null) } }}><div className="line-dialog calibration-dialog"><h2>输入实际距离</h2><p>两个标定点之间的真实距离</p><label className="field"><span>距离</span><input autoFocus type="number" inputMode="decimal" min="0.000001" step="0.1" value={calibrationDialog.value} onChange={event => setCalibrationDialog({ ...calibrationDialog, value: event.currentTarget.value })}/></label><label className="field"><span>单位</span><select value={calibrationDialog.unit} onChange={event => setCalibrationDialog({ ...calibrationDialog, unit: event.currentTarget.value as 'm' | 'km' })}><option value="m">米</option><option value="km">千米</option></select></label><div className="line-dialog-actions"><button onClick={() => { setCalibrationDialog(null); setCalibration(null) }}>取消</button><button className="primary" onClick={commitCalibration}>应用比例</button></div></div></div>}
        {rasterSvg && (
          <RasterExportDialog
            projectName={getProjectName(history.project)}
            svgText={rasterSvg}
            onClose={() => setRasterSvg(null)}
            onNotice={setNotice}
          />
        )}{" "}
        {presentationOpen && (
          <PresentationPreview
            project={history.project}
            onClose={() => setPresentationOpen(false)}
            onSettingsChange={(settings) =>
              history.commit((current) => ({
                ...structuredClone(current),
                presentation: settings,
              }))
            }
          />
        )}
      </div>
    </>
  );
}
