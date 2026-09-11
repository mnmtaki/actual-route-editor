import { useState } from 'react'
import type { ActualRouteProject, TransferStyle, TransferStyleTemplate } from '../data/model'
import { createTransferStyle, deleteTransferStyle, getTransferStyles, updateTransferStyle } from '../data/transferStyles'
import { ColorControl } from './TypographyControls'

const TEMPLATE_OPTIONS: Array<[TransferStyleTemplate, string]> = [
  ['default', 'ActualRoute 胶囊和彩点'],
  ['shanghai', '白色自适应胶囊'],
  ['guangzhouClassic', '广州经典编号环'],
  ['guangzhou2024', '广州 2024 编号网格'],
  ['beijing', '北京圆形箭头'],
  ['kunming', '昆明循环箭头'],
  ['metroman', '地铁通白色节点'],
]
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="field"><span>{label}</span>{children}</label>

export function TransferStyleManager({ project, onChange, compact = false, onEditStyle }: { project: ActualRouteProject; onChange: (project: ActualRouteProject) => void; compact?: boolean; onEditStyle?: () => void }) {
  const styles = getTransferStyles(project)
  const [selectedId, setSelectedId] = useState(styles[0]?.id ?? '')
  const selected = styles.find(style => style.id === selectedId) ?? styles[0]
  const update = (patch: Partial<TransferStyle>) => { if (!selected || selected.builtin) return; onChange(updateTransferStyle(project, selected.id, patch)) }
  const add = () => { const result = createTransferStyle(project, project.defaultTransferStyleId); onChange(result.project); setSelectedId(result.styleId) }
  const remove = () => { if (!selected || selected.builtin) return; onChange(deleteTransferStyle(project, selected.id)); setSelectedId('') }
  return <div className="transfer-style-manager" data-testid="transfer-style-manager">
    <Field label="换乘样式"><select aria-label="换乘样式管理" value={selected?.id ?? ''} onChange={event => setSelectedId(event.target.value)}>{styles.map(style => <option key={style.id} value={style.id}>{style.name}{style.builtin ? '（内置）' : ''}</option>)}{!styles.length && <option value="">尚无自定义样式</option>}</select></Field>
    <div className="line-style-actions"><button type="button" onClick={add}>新建</button>{compact && onEditStyle && <button type="button" onClick={onEditStyle}>编辑当前样式</button>}{selected && !selected.builtin && <button type="button" className="danger" onClick={remove}>删除</button>}</div>
    {selected && !selected.builtin && <>
      <Field label="样式名称"><input value={selected.name} onChange={event => update({ name: event.target.value })} /></Field>
      <Field label="模板"><select value={selected.template} onChange={event => update({ template: event.target.value as TransferStyleTemplate })}>{TEMPLATE_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      {!compact && <><ColorControl label="外框填充" value={selected.shellFill} onChange={value => update({ shellFill: value })} /><ColorControl label="外框描边" value={selected.shellStroke} onChange={value => update({ shellStroke: value })} /><Field label="描边宽度"><input type="number" inputMode="decimal" min="0" step=".25" value={selected.shellStrokeWidth} onChange={event => update({ shellStrokeWidth: Math.max(0, Number(event.target.value) || 0) })} /></Field><label className="toggle-row">显示彩点<input type="checkbox" checked={selected.dotsVisible} onChange={event => update({ dotsVisible: event.target.checked })} /></label></>}
      <p className="meta-note">自定义样式可在预设中心复制内置样式后继续调整。</p>
    </>}
  </div>
}
