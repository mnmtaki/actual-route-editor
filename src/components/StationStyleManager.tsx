import { useMemo, useState } from 'react'
import type { ActualRouteProject, StationStyle, StationStyleColorMode, StationStyleShape } from '../data/model'
import { assignStationStyle, createStationStyle, deleteStationStyle, getStationStyles, setProjectDefaultStationStyle } from '../data/stationStyles'
import { StationArtwork } from '../renderer/stationStyles'
import { ColorControl } from './TypographyControls'

const SHAPES: Array<[StationStyleShape, string]> = [['circle', '圆形'], ['square', '方形'], ['roundedRect', '圆角矩形'], ['capsule', '胶囊形'], ['diamond', '菱形']]
const MODES: Array<[StationStyleColorMode, string]> = [['fixed', '固定颜色'], ['background', '跟随画布背景'], ['none', '不显示']]
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="field"><span>{label}</span>{children}</label>

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max?: number; step: number; onChange: (value: number) => void }) {
  return <Field label={label}><input type="number" inputMode="decimal" min={min} max={max} step={step} value={value} onChange={event => { const next = Number(event.target.value); if (!Number.isFinite(next)) return; onChange(Math.max(min, max === undefined ? next : Math.min(max, next))) }} /></Field>
}

export function StationStyleManager({ project, onChange, compact = false, selectedId: selectedIdProp, onSelectedIdChange, onEditStyle, selectedStationIds = [] }: {
  project: ActualRouteProject
  onChange: (project: ActualRouteProject) => void
  compact?: boolean
  selectedId?: string
  onSelectedIdChange?: (styleId: string) => void
  onEditStyle?: () => void
  selectedStationIds?: string[]
}) {
  const styles = useMemo(() => getStationStyles(project), [project])
  const [internalSelectedId, setInternalSelectedId] = useState(styles[0]?.id ?? 'default')
  const selectedId = selectedIdProp ?? internalSelectedId
  const selected = styles.find(style => style.id === selectedId) ?? styles[0]
  if (!selected) return null
  const selectStyle = (id: string) => { setInternalSelectedId(id); onSelectedIdChange?.(id) }
  const update = (mutate: (style: StationStyle) => void) => {
    const next = structuredClone(project)
    const stylesForUpdate = getStationStyles(next).map(style => ({ ...style }))
    const target = stylesForUpdate.find(style => style.id === selected.id)
    if (!target) return
    mutate(target)
    next.stationStyles = stylesForUpdate
    onChange(next)
  }
  const add = () => { const result = createStationStyle(project, selected.id); onChange(result.project); selectStyle(result.styleId) }
  const copy = () => { const result = createStationStyle(project, selected.id, `${selected.name} 副本`); onChange(result.project); selectStyle(result.styleId) }
  const remove = () => { if (selected.builtin) return; onChange(deleteStationStyle(project, selected.id)); selectStyle('default') }
  const resetBuiltin = () => { if (!selected.builtin) return; const next = structuredClone(project); next.stationStyles = (next.stationStyles ?? []).filter(style => style.id !== selected.id); onChange(next) }
  const setDefault = () => { if (selected.id === (project.defaultStationStyleId ?? 'default')) return; onChange(setProjectDefaultStationStyle(project, selected.id)) }
  const applyBatch = () => { if (selectedStationIds.length > 1) onChange(assignStationStyle(project, selectedStationIds, selected.id)) }
  const setDimension = (key: 'width' | 'height', value: number) => update(style => { style[key] = value; if (style.lockAspect) style[key === 'width' ? 'height' : 'width'] = value })
  const previewStation = { id: 'station-style-preview', name: '预览', x: 0, y: 0, labelOffsetX: 0, labelOffsetY: 0 }
  const summary = <>
    <Field label="默认车站样式"><select aria-label="车站样式管理" value={selected.id} onChange={event => selectStyle(event.target.value)}>{styles.map(style => <option key={style.id} value={style.id}>{style.name}{style.builtin ? '（内置）' : ''}</option>)}</select></Field>
    <div className="line-style-actions"><button type="button" onClick={add}>新建</button><button type="button" onClick={copy}>复制</button>{selected.id === (project.defaultStationStyleId ?? 'default') ? <span className="meta-note">当前默认</span> : <button type="button" onClick={setDefault}>设为默认</button>}{compact && <button type="button" onClick={onEditStyle}>编辑当前样式</button>}{!compact && (selected.builtin ? <button type="button" onClick={resetBuiltin}>恢复内置</button> : <button type="button" className="danger" onClick={remove}>删除</button>)}</div>
    {selectedStationIds.length > 1 && <button type="button" onClick={applyBatch}>应用到已选 {selectedStationIds.length} 个普通站</button>}
  </>
  return <section className="station-style-manager" data-testid="station-style-manager">
    {summary}
    {!compact && <>
      <div className="station-style-preview"><span className="eyebrow">实时预览</span><svg viewBox="-90 -45 180 90" role="img" aria-label="车站样式预览"><line x1="-90" y1="0" x2="90" y2="0" stroke="#596161" strokeWidth="11" strokeLinecap="round" /><StationArtwork station={previewStation} style={selected} /></svg></div>
      <section className="style-section"><h3>几何</h3>
        <Field label="样式名称"><input value={selected.name} onChange={event => update(style => { style.name = event.target.value })} /></Field>
        <Field label="形状"><select value={selected.shape} onChange={event => update(style => { style.shape = event.target.value as StationStyleShape })}>{SHAPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
        <NumberField label="宽度" value={selected.width} min={0.1} step={0.5} onChange={value => setDimension('width', value)} />
        <NumberField label="高度" value={selected.height} min={0.1} step={0.5} onChange={value => setDimension('height', value)} />
        <label className="toggle-row">锁定宽高比<input type="checkbox" checked={selected.lockAspect} onChange={event => update(style => { style.lockAspect = event.target.checked; if (style.lockAspect) style.height = style.width })} /></label>
        <NumberField label="圆角" value={selected.cornerRadius} min={0} step={0.5} onChange={value => update(style => { style.cornerRadius = value })} />
        <NumberField label="旋转" value={selected.rotation} min={-360} max={360} step={1} onChange={value => update(style => { style.rotation = value })} />
      </section>
      <section className="style-section"><h3>填充</h3>
        <label className="toggle-row">启用填充<input type="checkbox" checked={selected.fillEnabled} onChange={event => update(style => { style.fillEnabled = event.target.checked })} /></label>
        <Field label="颜色方式"><select value={selected.fillColorMode} onChange={event => update(style => { style.fillColorMode = event.target.value as StationStyleColorMode })}>{MODES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
        {selected.fillColorMode === 'fixed' && <ColorControl label="填充颜色" value={selected.fillColor} onChange={value => update(style => { style.fillColor = value })} />}
        <NumberField label="填充透明度" value={selected.fillOpacity} min={0} max={1} step={0.05} onChange={value => update(style => { style.fillOpacity = value })} />
      </section>
      <section className="style-section"><h3>描边</h3>
        <label className="toggle-row">启用描边<input type="checkbox" checked={selected.strokeEnabled} onChange={event => update(style => { style.strokeEnabled = event.target.checked })} /></label>
        <Field label="颜色方式"><select value={selected.strokeColorMode} onChange={event => update(style => { style.strokeColorMode = event.target.value as StationStyleColorMode })}>{MODES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
        {selected.strokeColorMode === 'fixed' && <ColorControl label="描边颜色" value={selected.strokeColor} onChange={value => update(style => { style.strokeColor = value })} />}
        <NumberField label="描边宽度" value={selected.strokeWidth} min={0} step={0.5} onChange={value => update(style => { style.strokeWidth = value })} />
        <NumberField label="描边透明度" value={selected.strokeOpacity} min={0} max={1} step={0.05} onChange={value => update(style => { style.strokeOpacity = value })} />
      </section>
      <section className="style-section"><h3>外环</h3>
        <label className="toggle-row">启用外环<input type="checkbox" checked={selected.haloEnabled} onChange={event => update(style => { style.haloEnabled = event.target.checked })} /></label>
        <ColorControl label="外环颜色" value={selected.haloColor} onChange={value => update(style => { style.haloColor = value })} disabled={!selected.haloEnabled} />
        <NumberField label="外环宽度" value={selected.haloWidth} min={0} step={0.5} onChange={value => update(style => { style.haloWidth = value })} />
        <NumberField label="外环间距" value={selected.haloGap} min={0} step={0.5} onChange={value => update(style => { style.haloGap = value })} />
        <NumberField label="外环透明度" value={selected.haloOpacity} min={0} max={1} step={0.05} onChange={value => update(style => { style.haloOpacity = value })} />
      </section>
      {selected.builtin && <button type="button" onClick={resetBuiltin}>恢复内置</button>}
      {!selected.builtin && <button type="button" className="danger" onClick={remove}>删除样式</button>}
    </>}
  </section>
}
