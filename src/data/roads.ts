import type {
  ActualRouteProject,
  BasemapPath,
  Road,
  RoadPoint,
  RoadStyle,
  RoadStyleLayer,
} from "./model";
import { uid } from "./model";

export const ROAD_STYLE_IDS = {
  express: "road-express",
  arterial: "road-arterial",
  collector: "road-collector",
  local: "road-local",
} as const;
const layer = (
  id: string,
  color: string,
  width: number,
  opacity = 1,
): RoadStyleLayer => ({
  id,
  color,
  width,
  opacity,
  lineCap: "round",
  lineJoin: "round",
});
export const BUILTIN_ROAD_STYLES: readonly RoadStyle[] = [
  {
    id: ROAD_STYLE_IDS.express,
    name: "快速路",
    builtin: true,
    layers: [
      layer("express-casing", "#f4b942", 18),
      layer("express-main", "#fff5d6", 11),
    ],
  },
  {
    id: ROAD_STYLE_IDS.arterial,
    name: "主干路",
    builtin: true,
    layers: [
      layer("arterial-casing", "#c58a43", 14),
      layer("arterial-main", "#fffaf0", 8),
    ],
  },
  {
    id: ROAD_STYLE_IDS.collector,
    name: "次干路",
    builtin: true,
    layers: [
      layer("collector-casing", "#9b8c80", 10),
      layer("collector-main", "#f8f5ed", 5),
    ],
  },
  {
    id: ROAD_STYLE_IDS.local,
    name: "支路",
    builtin: true,
    layers: [layer("local-main", "#b9b3aa", 5)],
  },
];

const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const positive = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const cap = (value: unknown): RoadStyleLayer["lineCap"] =>
  value === "butt" || value === "square" ? value : "round";
const join = (value: unknown): RoadStyleLayer["lineJoin"] =>
  value === "miter" || value === "bevel" ? value : "round";

export function normalizeRoadStyles(value: unknown): RoadStyle[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: RoadStyle[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>,
      id = typeof raw.id === "string" ? raw.id : "";
    if (!id) continue;
    const layers = Array.isArray(raw.layers)
      ? raw.layers.flatMap((entry, index) => {
          if (!entry || typeof entry !== "object") return [];
          const value = entry as Record<string, unknown>,
            width = positive(value.width, 1),
            opacity = Math.max(0, Math.min(1, finite(value.opacity, 1)));
          return [
            {
              id:
                typeof value.id === "string" && value.id
                  ? value.id
                  : `${id}-layer-${index + 1}`,
              color:
                typeof value.color === "string" && value.color
                  ? value.color
                  : "#999999",
              width,
              opacity,
              ...(Array.isArray(value.dash)
                ? {
                    dash: value.dash
                      .map(Number)
                      .filter(
                        (number) => Number.isFinite(number) && number >= 0,
                      ),
                  }
                : {}),
              lineCap: cap(value.lineCap),
              lineJoin: join(value.lineJoin),
            } satisfies RoadStyleLayer,
          ];
        })
      : [];
    if (layers.length)
      result.push({
        id,
        name: typeof raw.name === "string" && raw.name ? raw.name : id,
        layers,
        ...(raw.builtin === true ? { builtin: true } : {}),
      });
  }
  return result.length ? result : undefined;
}

export function getRoadStyles(project: ActualRouteProject): RoadStyle[] {
  const saved = project.roadStyles ?? [];
  return BUILTIN_ROAD_STYLES.map((style) =>
    structuredClone(saved.find((item) => item.id === style.id) ?? style),
  )
    .concat(
      saved
        .filter(
          (style) => !BUILTIN_ROAD_STYLES.some((item) => item.id === style.id),
        )
        .map((style) => structuredClone(style)),
    )
    .map((style) => ({
      ...style,
      builtin: BUILTIN_ROAD_STYLES.some((item) => item.id === style.id),
    }));
}

export function getRoadStyle(
  project: ActualRouteProject,
  styleId: string | undefined,
): RoadStyle {
  const styles = getRoadStyles(project);
  return (
    styles.find((style) => style.id === styleId) ??
    styles.find((style) => style.id === ROAD_STYLE_IDS.local) ??
    styles[0]
  );
}

export function normalizeRoads(value: unknown): Road[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: Road[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>,
      id = typeof raw.id === "string" && raw.id ? raw.id : "";
    if (!id) continue;
    const points = Array.isArray(raw.points)
      ? raw.points.flatMap((entry, index) => {
          if (!entry || typeof entry !== "object") return [];
          const point = entry as Record<string, unknown>,
            x = Number(point.x),
            y = Number(point.y);
          return Number.isFinite(x) && Number.isFinite(y)
            ? [
                {
                  id:
                    typeof point.id === "string" && point.id
                      ? point.id
                      : `${id}-point-${index + 1}`,
                  x,
                  y,
                } satisfies RoadPoint,
              ]
            : [];
        })
      : [];
    if (points.length < 2) continue;
    result.push({
      id,
      ...(typeof raw.name === "string" && raw.name ? { name: raw.name } : {}),
      points,
      styleId:
        typeof raw.styleId === "string" ? raw.styleId : ROAD_STYLE_IDS.local,
      zIndex: finite(raw.zIndex, 0),
      visible: raw.visible !== false,
      locked: raw.locked === true,
      createdOrder: finite(raw.createdOrder, result.length),
    });
  }
  return result.length ? result : undefined;
}

export function createRoad(
  project: ActualRouteProject,
  styleId = ROAD_STYLE_IDS.local,
  firstPoint?: { x: number; y: number },
): { project: ActualRouteProject; roadId: string } {
  const next = structuredClone(project),
    roads = (next.roads ??= []),
    roadId = uid("road");
  roads.push({
    id: roadId,
    points: firstPoint
      ? [{ id: uid("road-point"), x: firstPoint.x, y: firstPoint.y }]
      : [],
    styleId,
    zIndex: 0,
    visible: true,
    locked: false,
    createdOrder: roads.length,
  });
  return { project: next, roadId };
}

export function appendRoadPoint(
  project: ActualRouteProject,
  roadId: string,
  point: { x: number; y: number },
): ActualRouteProject {
  const next = structuredClone(project),
    road = next.roads?.find((item) => item.id === roadId);
  if (
    road &&
    (road.points.length === 0 ||
      Math.hypot(
        road.points.at(-1)!.x - point.x,
        road.points.at(-1)!.y - point.y,
      ) > 1e-6)
  )
    road.points.push({ id: uid("road-point"), x: point.x, y: point.y });
  return next;
}

export function addRoad(
  project: ActualRouteProject,
  road: Omit<Road, "id" | "createdOrder"> & { id?: string },
): ActualRouteProject {
  const next = structuredClone(project),
    roads = (next.roads ??= []),
    id = road.id ?? uid("road");
  if (road.points.length < 2) return next;
  roads.push({ ...road, id, createdOrder: roads.length });
  return next;
}

export function finishCurrentRoad(
  project: ActualRouteProject,
  road: Road,
): { project: ActualRouteProject; committed: boolean } {
  if (road.points.length < 2) return { project, committed: false };
  return { project: addRoad(project, road), committed: true };
}

export function getRoadPathD(road: Road): string {
  return road.points.length
    ? `M ${road.points.map((point) => `${point.x} ${point.y}`).join(" L ")}`
    : "";
}

export function sortedVectorBasemapObjects(
  project: ActualRouteProject,
): Array<{
  kind: "road" | "basemap";
  object: Road | BasemapPath;
  index: number;
}> {
  const roads = (project.roads ?? []).map((object, index) => ({
    kind: "road" as const,
    object,
    index,
    order: object.createdOrder ?? index,
  }));
  const paths = (project.basemapPaths ?? []).map((object, index) => ({
    kind: "basemap" as const,
    object,
    index,
    order: index,
  }));
  return [...roads, ...paths].sort(
    (a, b) =>
      a.object.zIndex - b.object.zIndex ||
      a.order - b.order ||
      a.index - b.index ||
      a.object.id.localeCompare(b.object.id),
  );
}

export function moveRoadPoint(
  project: ActualRouteProject,
  roadId: string,
  pointId: string,
  point: { x: number; y: number },
): ActualRouteProject {
  const next = structuredClone(project),
    target = next.roads
      ?.find((road) => road.id === roadId)
      ?.points.find((item) => item.id === pointId);
  if (target) {
    target.x = point.x;
    target.y = point.y;
  }
  return next;
}

export function deleteRoadPoint(project: ActualRouteProject, roadId: string, pointId: string): ActualRouteProject {
  const next = structuredClone(project), road = next.roads?.find(item => item.id === roadId);
  if (road && road.points.length > 2) road.points = road.points.filter(point => point.id !== pointId);
  return next;
}

export function insertRoadPoint(project: ActualRouteProject, roadId: string, point: { x: number; y: number }): ActualRouteProject {
  const next = structuredClone(project), road = next.roads?.find(item => item.id === roadId);
  if (!road || road.points.length < 2) return next;
  let bestIndex = 0, bestDistance = Infinity, bestPoint = point;
  for (let index = 0; index + 1 < road.points.length; index += 1) {
    const a = road.points[index], b = road.points[index + 1], dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
    const projected = { x: a.x + dx * t, y: a.y + dy * t }, distance = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (distance < bestDistance) { bestDistance = distance; bestIndex = index; bestPoint = projected; }
  }
  road.points.splice(bestIndex + 1, 0, { id: uid('road-point'), x: bestPoint.x, y: bestPoint.y });
  return next;
}

export function moveRoad(
  project: ActualRouteProject,
  roadId: string,
  dx: number,
  dy: number,
): ActualRouteProject {
  const next = structuredClone(project),
    road = next.roads?.find((item) => item.id === roadId);
  road?.points.forEach((point) => {
    point.x += dx;
    point.y += dy;
  });
  return next;
}

export function setRoadZIndex(project: ActualRouteProject, roadId: string, zIndex: number): ActualRouteProject {
  const next = structuredClone(project), road = next.roads?.find(item => item.id === roadId);
  if (road && Number.isFinite(zIndex)) road.zIndex = zIndex;
  return next;
}

export function nudgeRoadZIndex(project: ActualRouteProject, roadId: string, direction: -1 | 1): ActualRouteProject {
  const road = project.roads?.find(item => item.id === roadId);
  return road ? setRoadZIndex(project, roadId, road.zIndex + direction) : structuredClone(project);
}

export function placeRoadZIndex(project: ActualRouteProject, roadId: string, edge: 'top' | 'bottom'): ActualRouteProject {
  const values = [...(project.basemapPaths ?? []), ...(project.roads ?? [])].map(item => item.zIndex), road = project.roads?.find(item => item.id === roadId);
  if (!road) return structuredClone(project);
  const target = values.length ? (edge === 'top' ? Math.max(...values) + 1 : Math.min(...values) - 1) : 0;
  return setRoadZIndex(project, roadId, target);
}

export function deleteRoad(
  project: ActualRouteProject,
  roadId: string,
): ActualRouteProject {
  const next = structuredClone(project);
  next.roads = (next.roads ?? []).filter((road) => road.id !== roadId);
  return next;
}

export function updateRoadStyle(
  project: ActualRouteProject,
  styleId: string,
  patch: Partial<Pick<RoadStyle, "name" | "layers">>,
): ActualRouteProject {
  const next = structuredClone(project),
    style = next.roadStyles?.find((item) => item.id === styleId);
  if (style && !style.builtin) Object.assign(style, patch);
  return next;
}

export function createRoadStyle(
  project: ActualRouteProject,
  sourceStyleId = ROAD_STYLE_IDS.local,
  name = "自定义道路",
): { project: ActualRouteProject; styleId: string } {
  const next = structuredClone(project),
    styles = (next.roadStyles ??= []),
    source = getRoadStyle(project, sourceStyleId),
    styleId = uid("road-style");
  styles.push({
    id: styleId,
    name,
    layers: source.layers.map((item) => ({ ...item, id: uid("road-layer") })),
  });
  return { project: next, styleId };
}

export function addRoadStyleLayer(
  project: ActualRouteProject,
  styleId: string,
  source?: Partial<RoadStyleLayer>,
): ActualRouteProject {
  const next = structuredClone(project), style = next.roadStyles?.find(item => item.id === styleId);
  if (!style || style.builtin) return next;
  style.layers.push({
    id: uid('road-layer'),
    color: source?.color ?? '#b9b3aa',
    width: positive(source?.width, 5),
    opacity: Math.max(0, Math.min(1, finite(source?.opacity, 1))),
    ...(source?.dash ? { dash: [...source.dash] } : {}),
    lineCap: source?.lineCap ?? 'round',
    lineJoin: source?.lineJoin ?? 'round',
  });
  return next;
}

export function removeRoadStyleLayer(
  project: ActualRouteProject,
  styleId: string,
  layerId: string,
): ActualRouteProject {
  const next = structuredClone(project), style = next.roadStyles?.find(item => item.id === styleId);
  if (!style || style.builtin || style.layers.length <= 1) return next;
  style.layers = style.layers.filter(item => item.id !== layerId);
  return next;
}

export function moveRoadStyleLayer(
  project: ActualRouteProject,
  styleId: string,
  layerId: string,
  direction: -1 | 1,
): ActualRouteProject {
  const next = structuredClone(project), style = next.roadStyles?.find(item => item.id === styleId);
  if (!style || style.builtin) return next;
  const index = style.layers.findIndex(item => item.id === layerId), target = index + direction;
  if (index < 0 || target < 0 || target >= style.layers.length) return next;
  [style.layers[index], style.layers[target]] = [style.layers[target], style.layers[index]];
  return next;
}

export function deleteRoadStyle(
  project: ActualRouteProject,
  styleId: string,
): ActualRouteProject {
  const next = structuredClone(project);
  if (BUILTIN_ROAD_STYLES.some((style) => style.id === styleId)) return next;
  next.roadStyles = (next.roadStyles ?? []).filter(
    (style) => style.id !== styleId,
  );
  next.roads?.forEach((road) => {
    if (road.styleId === styleId) road.styleId = ROAD_STYLE_IDS.local;
  });
  return next;
}

export function snapRoadPoint(
  project: ActualRouteProject,
  point: { x: number; y: number },
  threshold = 24,
): { x: number; y: number; snappedTo?: string } {
  let bestX = point.x, bestY = point.y, bestDistance = threshold, snappedTo: string | undefined;
  const consider = (x: number, y: number, id: string) => {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= bestDistance && (distance < bestDistance || !snappedTo || id.localeCompare(snappedTo) < 0)) { bestX = x; bestY = y; bestDistance = distance; snappedTo = id; }
  };
  for (const road of project.roads ?? []) {
    if (!road.visible) continue;
    road.points.forEach((item) => consider(item.x, item.y, item.id));
    for (let index = 0; index + 1 < road.points.length; index += 1) {
      const a = road.points[index],
        b = road.points[index + 1],
        dx = b.x - a.x,
        dy = b.y - a.y,
        length2 = dx * dx + dy * dy;
      const t = length2
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2,
            ),
          )
        : 0;
      consider(a.x + dx * t, a.y + dy * t, `${road.id}:${index}`);
    }
  }
  return snappedTo ? { x: bestX, y: bestY, snappedTo } : { x: point.x, y: point.y };
}
