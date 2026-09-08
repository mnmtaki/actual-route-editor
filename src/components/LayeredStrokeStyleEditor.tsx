import type { LineStyleLayer, RoadStyleLayer } from '../data/model'
import { uid } from '../data/model'
import { ColorControl } from './TypographyControls'

type Layer = LineStyleLayer | RoadStyleLayer

export function LayeredStrokeStyleEditor({
  layers,
  kind,
  disabled = false,
  onChange,
}: {
  layers: Layer[]
  kind: 'line' | 'road'
  disabled?: boolean
  onChange: (layers: Layer[]) => void
}) {
  const update = (index: number, patch: Partial<Layer>) => {
    onChange(layers.map((layer, layerIndex) => layerIndex === index ? { ...layer, ...patch } as Layer : layer))
  }
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= layers.length) return
    const next = [...layers]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  const remove = (index: number) => {
    if (layers.length <= 1) return
    onChange(layers.filter((_, layerIndex) => layerIndex !== index))
  }
  const add = () => {
    const layer: Layer = kind === 'line'
      ? { id: uid('line_layer'), colorMode: 'followLine', width: 1, widthMode: 'ratio', opacity: 1, lineCap: 'round', lineJoin: 'round' }
      : { id: uid('road-layer'), color: '#b9b3aa', width: 5, opacity: 1, lineCap: 'round', lineJoin: 'round' }
    onChange([...layers, layer])
  }
  return <div className="layered-stroke-style-editor" data-testid="layered-stroke-style-editor">
    <span className="eyebrow">图层</span>
    {layers.map((layer, index) => {
      const lineLayer = kind === 'line' ? layer as LineStyleLayer : null
      const title = `图层 ${index + 1}`
      return <section className="line-style-layer-editor layer-card" key={layer.id} data-layer-id={layer.id}>
        <strong>{title}</strong>
        {lineLayer && <label className="field"><span>颜色方式</span><select value={lineLayer.colorMode} disabled={disabled} onChange={event => update(index, { colorMode: event.target.value as LineStyleLayer['colorMode'] })}><option value="followLine">跟随线路颜色</option><option value="custom">自定义颜色</option></select></label>}
        {lineLayer?.colorMode === 'custom' && <ColorControl label="颜色" value={lineLayer.color ?? '#333333'} disabled={disabled} onChange={value => update(index, { color: value })} />}
        {!lineLayer && <ColorControl label="颜色" value={(layer as RoadStyleLayer).color} disabled={disabled} onChange={value => update(index, { color: value })} />}
        {lineLayer && <label className="field"><span>宽度方式</span><select value={lineLayer.widthMode ?? 'ratio'} disabled={disabled} onChange={event => update(index, { widthMode: event.target.value as LineStyleLayer['widthMode'] })}><option value="ratio">相对线路宽度</option><option value="absolute">绝对世界单位</option></select></label>}
        <label className="field"><span>宽度</span><input type="number" inputMode="decimal" min="0" step=".01" value={layer.width} disabled={disabled} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0) update(index, { width: value }) }} /></label>
        <label className="field"><span>不透明度</span><input type="number" inputMode="decimal" min="0" max="1" step=".05" value={layer.opacity ?? 1} disabled={disabled} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) update(index, { opacity: Math.max(0, Math.min(1, value)) }) }} /></label>
        <label className="field"><span>虚线间隔</span><input inputMode="decimal" placeholder="例如 8 4" value={layer.dash?.join(' ') ?? ''} disabled={disabled} onChange={event => { const dash = event.target.value.trim() ? event.target.value.trim().split(/[ ,]+/).map(Number).filter(value => Number.isFinite(value) && value >= 0) : undefined; update(index, { dash }) }} /></label>
        <label className="field"><span>线帽</span><select value={layer.lineCap ?? 'round'} disabled={disabled} onChange={event => update(index, { lineCap: event.target.value as Layer['lineCap'] })}><option value="round">圆端点</option><option value="butt">平端点</option><option value="square">方端点</option></select></label>
        <label className="field"><span>连接</span><select value={layer.lineJoin ?? 'round'} disabled={disabled} onChange={event => update(index, { lineJoin: event.target.value as Layer['lineJoin'] })}><option value="round">圆转角</option><option value="miter">尖转角</option><option value="bevel">斜切转角</option></select></label>
        <div className="line-style-layer-actions"><button type="button" disabled={disabled || index === 0} onClick={() => move(index, -1)}>上移</button><button type="button" disabled={disabled || index === layers.length - 1} onClick={() => move(index, 1)}>下移</button><button type="button" className="danger" disabled={disabled || layers.length <= 1} onClick={() => remove(index)}>删除图层</button></div>
      </section>
    })}
    <button type="button" disabled={disabled} onClick={add}>＋ 添加图层</button>
  </div>
}
