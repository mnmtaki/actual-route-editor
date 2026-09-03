import type { ActualRouteProject } from "../data/model";
import { getRoadStyles } from "../data/roads";

export function RoadPanel({
  project,
  selectedId,
  onSelect,
  onAdd,
  activeStyleId,
  onStyleChange,
  drawing = false,
  onFinish,
  onExit,
}: {
  project: ActualRouteProject;
  selectedId?: string;
  onSelect: (id: string) => void;
  onAdd: (styleId: string) => void;
  activeStyleId?: string;
  onStyleChange?: (styleId: string) => void;
  drawing?: boolean;
  onFinish?: () => void;
  onExit?: () => void;
}) {
  const styles = getRoadStyles(project);
  return (
    <section
      className="mobile-drawer-section road-panel"
      data-testid="road-panel"
    >
      <div className="eyebrow">道路</div>
      <p className="meta-note">
        道路是独立的地图中心线，可连续点击绘制；完成后仍可自由拖动节点。
      </p>
      <div className="field">
        <span>道路样式</span>
        <select
          aria-label="道路样式"
          value={activeStyleId ?? styles.find((style) => style.name === "支路")?.id ?? styles[0]?.id ?? ""}
          onChange={(event) => onStyleChange?.(event.target.value)}
        >
          <option value="">请选择</option>
          {styles.map((style) => (
            <option key={style.id} value={style.id}>
              {style.name}
            </option>
          ))}
        </select>
      </div>
      <button
        className="primary"
        onClick={(event) => {
          const select =
            event.currentTarget.parentElement?.querySelector("select");
          onAdd(select?.value || styles[0]?.id || "road-local");
        }}
      >
        绘制道路
      </button>
      {drawing && (
        <div className="road-drawing-actions">
          {onFinish && <button type="button" className="primary" onClick={onFinish}>完成当前道路</button>}
          {onExit && <button type="button" onClick={onExit}>退出绘制</button>}
        </div>
      )}
      <div className="road-list">
        {(project.roads ?? []).map((road) => (
          <button
            type="button"
            key={road.id}
            className={selectedId === road.id ? "active" : ""}
            onClick={() => onSelect(road.id)}
          >
            <span>{road.name || "未命名道路"}</span>
            <small>
              {styles.find((style) => style.id === road.styleId)?.name ?? "支路"}{road.visible ? "，显示" : "，已隐藏"}{road.locked ? "，已锁定" : ""}
            </small>
          </button>
        ))}
        {!(project.roads ?? []).length && (
          <p className="meta-note">还没有道路。</p>
        )}
      </div>
    </section>
  );
}
