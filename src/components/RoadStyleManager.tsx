import type { ActualRouteProject } from "../data/model";
import { addRoadStyleLayer, createRoadStyle, deleteRoadStyle, getRoadStyles, moveRoadStyleLayer, removeRoadStyleLayer, updateRoadStyle } from "../data/roads";

export function RoadStyleManager({
  project,
  onChange,
}: {
  project: ActualRouteProject;
  onChange: (project: ActualRouteProject) => void;
}) {
  const styles = getRoadStyles(project);
  return (
    <div className="road-style-manager" data-testid="road-style-manager">
      {styles.map((style) => (
        <section key={style.id} className="road-style-row">
          <label className="style-select">
            <span>{style.name}</span>
            <input
              type="text"
              aria-label={`${style.name}名称`}
              disabled={style.builtin}
              value={style.name}
              onChange={(event) =>
                onChange(
                  updateRoadStyle(project, style.id, {
                    name: event.target.value,
                  }),
                )
              }
            />
          </label>
          <div className="road-style-layers">
            {style.layers.map((layer) => (
              <div key={layer.id} className="road-style-layer">
                <input
                  aria-label={`${style.name}颜色`}
                  type="color"
                  value={layer.color}
                  disabled={style.builtin}
                  onChange={(event) =>
                    onChange(
                      updateRoadStyle(project, style.id, {
                        layers: style.layers.map((item) =>
                          item.id === layer.id
                            ? { ...item, color: event.target.value }
                            : item,
                        ),
                      }),
                    )
                  }
                />
                <input
                  aria-label={`${style.name}线宽`}
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="1"
                  value={layer.width}
                  disabled={style.builtin}
                  onChange={(event) =>
                    onChange(
                      updateRoadStyle(project, style.id, {
                        layers: style.layers.map((item) =>
                          item.id === layer.id
                            ? {
                                ...item,
                                width: Math.max(
                                  1,
                                  Number(event.target.value) || 1,
                                ),
                              }
                            : item,
                        ),
                      }),
                    )
                  }
                />
                <input
                  aria-label={`${style.name}透明度`}
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  inputMode="decimal"
                  value={layer.opacity}
                  disabled={style.builtin}
                  onChange={(event) =>
                    onChange(updateRoadStyle(project, style.id, {
                      layers: style.layers.map((item) => item.id === layer.id ? { ...item, opacity: Math.max(0, Math.min(1, Number(event.target.value) || 0)) } : item),
                    }))
                  }
                />
                <input
                  aria-label={`${style.name}虚线`}
                  type="text"
                  placeholder="虚线"
                  value={layer.dash?.join(",") ?? ""}
                  disabled={style.builtin}
                  onChange={(event) => {
                    const dash = event.target.value.split(",").map(Number).filter((value) => Number.isFinite(value) && value >= 0)
                    onChange(updateRoadStyle(project, style.id, { layers: style.layers.map((item) => item.id === layer.id ? { ...item, ...(dash.length ? { dash } : { dash: undefined }) } : item) }))
                  }}
                />
                <select aria-label={`${style.name}端点`} value={layer.lineCap} disabled={style.builtin} onChange={(event) => onChange(updateRoadStyle(project, style.id, { layers: style.layers.map((item) => item.id === layer.id ? { ...item, lineCap: event.target.value as typeof item.lineCap } : item) }))}>
                  <option value="round">圆端点</option><option value="butt">平端点</option><option value="square">方端点</option>
                </select>
                <select aria-label={`${style.name}转角`} value={layer.lineJoin} disabled={style.builtin} onChange={(event) => onChange(updateRoadStyle(project, style.id, { layers: style.layers.map((item) => item.id === layer.id ? { ...item, lineJoin: event.target.value as typeof item.lineJoin } : item) }))}>
                  <option value="round">圆转角</option><option value="miter">尖转角</option><option value="bevel">斜切转角</option>
                </select>
                {!style.builtin && <span className="road-style-layer-actions"><button type="button" onClick={() => onChange(moveRoadStyleLayer(project, style.id, layer.id, -1))}>上移</button><button type="button" onClick={() => onChange(moveRoadStyleLayer(project, style.id, layer.id, 1))}>下移</button><button type="button" onClick={() => onChange(removeRoadStyleLayer(project, style.id, layer.id))}>删除层</button></span>}
              </div>
            ))}
          </div>
          {!style.builtin && <button type="button" onClick={() => onChange(addRoadStyleLayer(project, style.id))}>添加层</button>}
          {!style.builtin && (
            <button
              type="button"
              onClick={() => onChange(deleteRoadStyle(project, style.id))}
            >
              删除
            </button>
          )}
        </section>
      ))}
      <button type="button" onClick={() => onChange(createRoadStyle(project).project)}>{String.fromCharCode(65291)} 新建道路样式</button>
    </div>
  );
}
