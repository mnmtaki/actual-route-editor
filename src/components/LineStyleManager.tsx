import { useMemo, useState } from 'react'
import type { ActualRouteProject, LineStyle, LineStyleLayer } from '../data/model'
import { uid } from '../data/model'
import { BUILTIN_LINE_STYLES, ensureProjectLineStyles, getLineStyles } from '../data/lineStyles'

const parseDash = (value: string) => value.trim() ? value.trim().split(/[ ,]+/).map(Number).filter(item => Number.isFinite(item) && item >= 0) : undefined
const dashText = (value?: number[]) => value?.join(' ') ?? ''

export function LineStyleManager({ project, onChange }: { project: ActualRouteProject; onChange: (project: ActualRouteProject) => void }) {
  const styles = useMemo(() => getLineStyles(project), [project])
  const [selectedId, setSelectedId] = useState(BUILTIN_LINE_STYLES[0].id)
  const selected = styles.find(style => style.id === selectedId) ?? styles[0]
  const update = (mutate: (styles: LineStyle[]) => void) => {
    const next = structuredClone(project)
    const normalized = ensureProjectLineStyles(next)
    mutate(normalized)
    next.styles = normalized
    onChange(next)
  }
  const updateSelected = (mutate: (style: LineStyle) => void) => update(list => { const target = list.find(style => style.id === selected.id); if (target) mutate(target) })
  const updateLayer = (layerId: string, mutate: (layer: LineStyleLayer) => void) => updateSelected(style => { const layer = style.layers.find(item => item.id === layerId); if (layer) mutate(layer) })
  const addStyle = () => {
    const style: LineStyle = { id: uid('line_style'), name: '新样式 ' + (styles.length + 1), layers: [{ id: uid('line_layer'), colorMode: 'followLine', width: 1, widthMode: 'ratio', opacity: 1, lineCap: 'round', lineJoin: 'round' }] }
    update(list => list.push(style)); setSelectedId(style.id)
  }
  const copyStyle = () => {
    const copy: LineStyle = structuredClone(selected); copy.id = uid('line_style'); copy.name = copy.name + ' 副本'
    update(list => list.push(copy)); setSelectedId(copy.id)
  }
  const deleteStyle = () => {
    if (selected.builtin) return
    const next = structuredClone(project), list = ensureProjectLineStyles(next), index = list.findIndex(style => style.id === selected.id)
    if (index >= 0) list.splice(index, 1)
    next.styles = list
    for (const line of next.lines) if (line.lineStyleId === selected.id) line.lineStyleId = 'normal'
    onChange(next)
    setSelectedId(BUILTIN_LINE_STYLES[0].id)
  }
  const resetBuiltin = () => {
    if (!selected.builtin) return
    const original = BUILTIN_LINE_STYLES.find(style => style.id === selected.id)
    if (original) update(list => { const index = list.findIndex(style => style.id === selected.id); if (index >= 0) list[index] = structuredClone(original) })
  }
  if (!selected) return null
  return <section className="line-style-manager" data-testid="line-style-manager">
    <div className="field"><span>样式</span><select aria-label="线路样式管理" value={selected.id} onChange={event => setSelectedId(event.target.value)}>{styles.map(style => <option key={style.id} value={style.id}>{style.name}{style.builtin ? '（内置）' : ''}</option>)}</select></div>
    <div className="line-style-actions"><button type="button" onClick={addStyle}>新建</button><button type="button" onClick={copyStyle}>复制</button>{selected.builtin ? <button type="button" onClick={resetBuiltin}>恢复内置</button> : <button type="button" className="danger" onClick={deleteStyle}>删除</button>}</div>
    <label className="field"><span>样式名称</span><input value={selected.name} onChange={event => updateSelected(style => { style.name = event.target.value })} /></label>
    <label className="toggle-row">隐藏基础线路<input type="checkbox" checked={selected.hideBaseLine === true} onChange={event => updateSelected(style => { style.hideBaseLine = event.target.checked || undefined })} /></label>
    <div className="line-style-layers"><span className="eyebrow">线路图层</span>{selected.layers.map((layer, index) => <div className="line-style-layer-editor" key={layer.id} data-layer-id={layer.id}>
      <strong>图层 {index + 1}</strong>
      <label className="field"><span>颜色方式</span><select value={layer.colorMode} onChange={event => updateLayer(layer.id, item => { item.colorMode = event.target.value as LineStyleLayer['colorMode'] })}><option value="followLine">跟随线路颜色</option><option value="custom">自定义颜色</option></select></label>
      {layer.colorMode === 'custom' && <label className="field"><span>颜色</span><input type="color" value={layer.color ?? '#333333'} onChange={event => updateLayer(layer.id, item => { item.color = event.target.value })} /></label>}
      <label className="field"><span>宽度方式</span><select value={layer.widthMode ?? 'ratio'} onChange={event => updateLayer(layer.id, item => { item.widthMode = event.target.value as LineStyleLayer['widthMode'] })}><option value="ratio">相对线路宽度</option><option value="absolute">绝对世界单位</option></select></label>
      <label className="field"><span>宽度</span><input type="number" inputMode="decimal" min="0" step=".01" value={layer.width} onChange={event => updateLayer(layer.id, item => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0) item.width = value })} /></label>
      <label className="field"><span>不透明度</span><input type="number" inputMode="decimal" min="0" max="1" step=".05" value={layer.opacity ?? 1} onChange={event => updateLayer(layer.id, item => { const value = Number(event.target.value); if (Number.isFinite(value)) item.opacity = Math.max(0, Math.min(1, value)) })} /></label>
      <label className="field"><span>虚线间隔</span><input inputMode="decimal" placeholder="例如 8 4" value={dashText(layer.dash)} onChange={event => updateLayer(layer.id, item => { item.dash = parseDash(event.target.value) })} /></label>
      <label className="field"><span>线帽</span><select value={layer.lineCap ?? 'round'} onChange={event => updateLayer(layer.id, item => { item.lineCap = event.target.value as LineStyleLayer['lineCap'] })}><option value="round">圆</option><option value="butt">平</option><option value="square">方</option></select></label>
      <label className="field"><span>连接</span><select value={layer.lineJoin ?? 'round'} onChange={event => updateLayer(layer.id, item => { item.lineJoin = event.target.value as LineStyleLayer['lineJoin'] })}><option value="round">圆</option><option value="miter">尖角</option><option value="bevel">斜角</option></select></label>
      <div className="line-style-layer-actions"><button type="button" disabled={index === 0} onClick={() => updateSelected(style => { const current = style.layers[index - 1]; style.layers[index - 1] = style.layers[index]; style.layers[index] = current })}>上移</button><button type="button" disabled={index === selected.layers.length - 1} onClick={() => updateSelected(style => { const current = style.layers[index + 1]; style.layers[index + 1] = style.layers[index]; style.layers[index] = current })}>下移</button><button type="button" className="danger" disabled={selected.layers.length <= 1} onClick={() => updateSelected(style => { style.layers.splice(index, 1) })}>删除图层</button></div>
    </div>)}</div>
    <button type="button" onClick={() => updateSelected(style => { style.layers.push({ id: uid('line_layer'), colorMode: 'followLine', width: 1, widthMode: 'ratio', opacity: 1, lineCap: 'round', lineJoin: 'round' }) })}>＋ 添加图层</button>
  </section>
}
