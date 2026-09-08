import { useState } from 'react'
import type { ActualRouteProject, RoadStyle, RoadStyleLayer } from '../data/model'
import { createRoadStyle, deleteRoadStyle, getRoadStyles, updateRoadStyle } from '../data/roads'
import { LayeredStrokeStyleEditor } from './LayeredStrokeStyleEditor'

export function RoadStyleManager({ project, onChange, compact = false, selectedId: selectedIdProp, onSelectedIdChange, onEditStyle }: {
  project: ActualRouteProject
  onChange: (project: ActualRouteProject) => void
  compact?: boolean
  selectedId?: string
  onSelectedIdChange?: (styleId: string) => void
  onEditStyle?: () => void
}) {
  const styles = getRoadStyles(project)
  const [selectedState, setSelectedState] = useState(styles[0]?.id ?? '')
  const selectedId = selectedIdProp ?? selectedState
  const selected = styles.find(style => style.id === selectedId) ?? styles[0]
  if (!selected) return null
  const selectStyle = (id: string) => { setSelectedState(id); onSelectedIdChange?.(id) }
  const create = () => { const result = createRoadStyle(project); onChange(result.project); selectStyle(result.styleId) }
  const copy = () => { const result = createRoadStyle(project, selected.id, selected.name + ' 副本'); onChange(result.project); selectStyle(result.styleId) }
  const resetBuiltin = () => {
    if (!selected.builtin) return
    const next = structuredClone(project)
    next.roadStyles = (next.roadStyles ?? []).filter(style => style.id !== selected.id)
    onChange(next)
  }
  const remove = () => { if (!selected.builtin) onChange(deleteRoadStyle(project, selected.id)) }
  const update = (patch: Partial<Pick<RoadStyle, 'name' | 'layers'>>) => onChange(updateRoadStyle(project, selected.id, patch))
  const summary = <>
    <label className="field"><span>当前样式</span><select aria-label="道路样式管理" value={selected.id} onChange={event => selectStyle(event.target.value)}>{styles.map(style => <option key={style.id} value={style.id}>{style.name}{style.builtin ? '（内置）' : ''}</option>)}</select></label>
    <div className="line-style-actions"><button type="button" onClick={create}>新建</button><button type="button" onClick={copy}>复制</button>{compact && <button type="button" onClick={onEditStyle}>编辑当前样式</button>}{!compact && (selected.builtin ? <button type="button" onClick={resetBuiltin}>恢复内置</button> : <button type="button" className="danger" onClick={remove}>删除</button>)}</div>
  </>
  return <section className="road-style-manager" data-testid="road-style-manager">
    {summary}
    {!compact && <>
      <label className="field"><span>样式名称</span><input value={selected.name} disabled={selected.builtin} onChange={event => update({ name: event.target.value })} /></label>
      <LayeredStrokeStyleEditor kind="road" layers={selected.layers} disabled={selected.builtin} onChange={layers => update({ layers: layers as RoadStyleLayer[] })} />
      {selected.builtin && <button type="button" onClick={resetBuiltin}>恢复内置</button>}
      {!selected.builtin && <button type="button" className="danger" onClick={remove}>删除样式</button>}
    </>}
  </section>
}
