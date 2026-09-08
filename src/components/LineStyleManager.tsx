import { useMemo, useState } from 'react'
import type { ActualRouteProject, LineStyle, LineStyleLayer } from '../data/model'
import { uid } from '../data/model'
import { BUILTIN_LINE_STYLES, ensureProjectLineStyles, getLineStyles } from '../data/lineStyles'
import { LayeredStrokeStyleEditor } from './LayeredStrokeStyleEditor'

export function LineStyleManager({ project, onChange, compact = false, selectedId: selectedIdProp, onSelectedIdChange, onEditStyle }: {
  project: ActualRouteProject
  onChange: (project: ActualRouteProject) => void
  compact?: boolean
  selectedId?: string
  onSelectedIdChange?: (styleId: string) => void
  onEditStyle?: () => void
}) {
  const styles = useMemo(() => getLineStyles(project), [project])
  const [internalSelectedId, setInternalSelectedId] = useState(BUILTIN_LINE_STYLES[0].id)
  const selectedId = selectedIdProp ?? internalSelectedId
  const selected = styles.find(style => style.id === selectedId) ?? styles[0]
  if (!selected) return null
  const selectStyle = (id: string) => { setInternalSelectedId(id); onSelectedIdChange?.(id) }
  const update = (mutate: (styles: LineStyle[]) => void) => {
    const next = structuredClone(project)
    const normalized = ensureProjectLineStyles(next)
    mutate(normalized)
    next.styles = normalized
    onChange(next)
  }
  const updateSelected = (mutate: (style: LineStyle) => void) => update(list => { const target = list.find(style => style.id === selected.id); if (target) mutate(target) })
  const addStyle = () => {
    const style: LineStyle = { id: uid('line_style'), name: '新样式 ' + (styles.length + 1), layers: [{ id: uid('line_layer'), colorMode: 'followLine', width: 1, widthMode: 'ratio', opacity: 1, lineCap: 'round', lineJoin: 'round' }] }
    update(list => list.push(style)); selectStyle(style.id)
  }
  const copyStyle = () => {
    const copy: LineStyle = structuredClone(selected); copy.id = uid('line_style'); copy.name = copy.name + ' 副本'; copy.layers = copy.layers.map(layer => ({ ...layer, id: uid('line_layer') }))
    update(list => list.push(copy)); selectStyle(copy.id)
  }
  const deleteStyle = () => {
    if (selected.builtin) return
    const next = structuredClone(project), list = ensureProjectLineStyles(next), index = list.findIndex(style => style.id === selected.id)
    if (index >= 0) list.splice(index, 1)
    next.styles = list
    for (const line of next.lines) if (line.lineStyleId === selected.id) line.lineStyleId = 'normal'
    onChange(next)
    selectStyle(BUILTIN_LINE_STYLES[0].id)
  }
  const resetBuiltin = () => {
    if (!selected.builtin) return
    const original = BUILTIN_LINE_STYLES.find(style => style.id === selected.id)
    if (original) {
      const next = structuredClone(project)
      next.styles = (next.styles ?? []).filter(style => style.id !== selected.id)
      onChange(next)
    }
  }
  const summary = <>
    <label className="field"><span>当前样式</span><select aria-label="线路样式管理" value={selected.id} onChange={event => selectStyle(event.target.value)}>{styles.map(style => <option key={style.id} value={style.id}>{style.name}{style.builtin ? '（内置）' : ''}</option>)}</select></label>
    <div className="line-style-actions"><button type="button" onClick={addStyle}>新建</button><button type="button" onClick={copyStyle}>复制</button>{compact && <button type="button" onClick={onEditStyle}>编辑当前样式</button>}{!compact && (selected.builtin ? <button type="button" onClick={resetBuiltin}>恢复内置</button> : <button type="button" className="danger" onClick={deleteStyle}>删除</button>)}</div>
  </>
  return <section className="line-style-manager" data-testid="line-style-manager">
    {summary}
    {!compact && <>
      <label className="field"><span>样式名称</span><input value={selected.name} disabled={selected.builtin} onChange={event => updateSelected(style => { style.name = event.target.value })} /></label>
      <label className="toggle-row">隐藏基础线路<input type="checkbox" checked={selected.hideBaseLine === true} disabled={selected.builtin} onChange={event => updateSelected(style => { style.hideBaseLine = event.target.checked || undefined })} /></label>
      <span className="eyebrow">线路图层</span>
      <LayeredStrokeStyleEditor kind="line" layers={selected.layers} disabled={selected.builtin} onChange={layers => updateSelected(style => { style.layers = layers as LineStyleLayer[] })} />
      {selected.builtin && <button type="button" onClick={resetBuiltin}>恢复内置</button>}
      {!selected.builtin && <button type="button" className="danger" onClick={deleteStyle}>删除样式</button>}
    </>}
  </section>
}
