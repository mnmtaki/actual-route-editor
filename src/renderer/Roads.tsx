import type { ActualRouteProject, Road, RoadStyleLayer } from "../data/model";
import {
  getRoadPathD,
  getRoadStyle,
  sortedVectorBasemapObjects,
} from "../data/roads";

export function RoadArtwork({
  road,
  project,
  presentation,
  selected,
  hitRadius,
  onPointerDown,
  onPointPointerDown,
}: {
  road: Road;
  project: ActualRouteProject;
  presentation: boolean;
  selected: boolean;
  hitRadius: number;
  onPointerDown?: (
    event: React.PointerEvent<SVGPathElement>,
    road: Road,
  ) => void;
  onPointPointerDown?: (
    event: React.PointerEvent<SVGCircleElement>,
    road: Road,
    pointId: string,
  ) => void;
}) {
  const style = getRoadStyle(project, road.styleId),
    d = getRoadPathD(road);
  if (!d) return null;
  return (
    <g
      key={road.id}
      data-road-id={road.id}
      data-z-index={road.zIndex}
      className={`road ${selected ? "selected" : ""}`}
    >
      {style.layers.map((layer: RoadStyleLayer) => (
        <path
          key={layer.id}
          d={d}
          fill="none"
          stroke={layer.color}
          strokeWidth={layer.width}
          strokeOpacity={layer.opacity}
          strokeDasharray={layer.dash?.join(" ")}
          strokeLinecap={layer.lineCap}
            strokeLinejoin={layer.lineJoin}
            pointerEvents="none"
          data-road-layer={layer.id}
        />
      ))}
      {!presentation && (
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={
            Math.max(...style.layers.map((layer) => layer.width), 1) +
            hitRadius * 2
          }
          pointerEvents={road.locked ? "none" : "stroke"}
          onPointerDown={(event) => onPointerDown?.(event, road)}
        />
      )}
      {!presentation && selected && !road.locked && (
        <g data-editor="true" className="road-points">
          {road.points.map((point) => (
            <g
              key={point.id}
              transform={`translate(${point.x} ${point.y})`}
              data-road-point-id={point.id}
            >
              <circle
                className="road-point-hit"
                r={hitRadius}
                fill="transparent"
                pointerEvents="all"
                onPointerDown={(event) =>
                  onPointPointerDown?.(event, road, point.id)
                }
              />
              <circle
                className="road-point-marker"
                r={4}
                fill="#fffdf8"
                stroke="#8c7b5a"
                strokeWidth={1.5}
                pointerEvents="none"
              />
            </g>
          ))}
        </g>
      )}
    </g>
  );
}

export function RoadsLayer({
  project,
  presentation = false,
  selectedId,
  hitRadius = 22,
  draft,
  onPointerDown,
  onPointPointerDown,
}: {
  project: ActualRouteProject;
  presentation?: boolean;
  selectedId?: string;
  hitRadius?: number;
  draft?: Road | null;
  onPointerDown?: (
    event: React.PointerEvent<SVGPathElement>,
    road: Road,
  ) => void;
  onPointPointerDown?: (
    event: React.PointerEvent<SVGCircleElement>,
    road: Road,
    pointId: string,
  ) => void;
}) {
  return (
    <g data-layer="roads">
      {sortedVectorBasemapObjects(project)
        .filter((item) => item.kind === "road")
        .map((item) => {
          const road = item.object as Road;
          return road.visible ? (
            <RoadArtwork
              key={road.id}
              road={road}
              project={project}
              presentation={presentation}
              selected={selectedId === road.id}
              hitRadius={hitRadius}
              onPointerDown={onPointerDown}
              onPointPointerDown={onPointPointerDown}
            />
          ) : null;
        })}
      {draft && (
        <RoadArtwork
          road={draft}
          project={project}
          presentation={false}
          selected
          hitRadius={hitRadius}
          onPointerDown={onPointerDown}
          onPointPointerDown={onPointPointerDown}
        />
      )}
    </g>
  );
}
