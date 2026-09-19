import { useMemo, useState } from 'react'
import type { ActualRouteProject, Line } from '../data/model'
import { uid } from '../data/model'
import { getLineNameAt, normalizeLineNameHistory, removeLineNameHistoryEntry, updateLineNameHistoryEntry } from '../data/lineNameHistory'
import { getLineDisplayCodeAt, normalizeLineDisplayCodeHistory, removeLineDisplayCodeHistoryEntry, updateLineDisplayCodeHistoryEntry } from '../data/lineDisplayCodeHistory'
import { getLineParentIdAt, normalizeLineParentHistory, removeLineParentHistoryEntry, updateLineParentHistoryEntry } from '../data/lineParentHistory'
import { getLineOwnColorAt, normalizeLineColorHistory, removeLineColorHistoryEntry, updateLineColorHistoryEntry } from '../data/lineColorHistory'
import { getEffectiveLineColor, getLineDisplayName } from '../data/lineIdentity'

type HistoryDate = string | null
type FieldKind = 'name' | 'displayCode' | 'parent' | 'color'

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="field"><span>{label}</span>{children}</label>

function effectiveSnapshot(project: ActualRouteProject, line: Line, date: string) {
  return {
    name: getLineNameAt(line, date).name,
    displayCode: getLineDisplayCodeAt(line, date),
    parentLineId: getLineParentIdAt(line, date) ?? null,
    ownColor: getLineOwnColorAt(line, date),
    effectiveColor: getEffectiveLineColor(project, line, date),
  }
}

function changedAt(line: Line, date: HistoryDate) {
  const match = <T extends { effectiveAt: string | null }>(items: T[] | undefined) => items?.find(entry => entry.effectiveAt === date)
  return {
    name: match(normalizeLineNameHistory(line)),
    displayCode: match(normalizeLineDisplayCodeHistory(line)),
    parent: match(normalizeLineParentHistory(line)),
    color: match(normalizeLineColorHistory(line)),
  }
}

function historyDates(line: Line): string[] {
  return [...new Set([
    ...(normalizeLineNameHistory(line) ?? []).flatMap(entry => entry.effectiveAt ? [entry.effectiveAt] : []),
    ...(normalizeLineDisplayCodeHistory(line) ?? []).flatMap(entry => entry.effectiveAt ? [entry.effectiveAt] : []),
    ...(normalizeLineParentHistory(line) ?? []).flatMap(entry => entry.effectiveAt ? [entry.effectiveAt] : []),
    ...(normalizeLineColorHistory(line) ?? []).flatMap(entry => entry.effectiveAt ? [entry.effectiveAt] : []),
  ])].sort()
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '线路发展史无效'
}

export function LineHistoryEditor({ project, line, onChange }: { project: ActualRouteProject; line: Line; onChange: (next: ActualRouteProject) => void }) {
  const [draftDates, setDraftDates] = useState<string[]>([])
  const [newDate, setNewDate] = useState(project.timeline.currentDate)
  const persistedDates = useMemo(() => historyDates(line), [line])
  const dates = [...new Set([...persistedDates, ...draftDates])].sort()
  const currentDate = project.timeline.currentDate
  const current = effectiveSnapshot(project, line, currentDate)

  const mutate = (fn: (next: ActualRouteProject, target: Line) => void) => {
    const next = structuredClone(project)
    const target = next.lines.find(item => item.id === line.id)
    if (!target) return
    try {
      fn(next, target)
      onChange(next)
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  const updateField = (date: HistoryDate, kind: FieldKind, value: string | null) => mutate((next, target) => {
    const existing = changedAt(target, date)
    if (kind === 'name') updateLineNameHistoryEntry(target, { id: existing.name?.id ?? uid('line-name'), effectiveAt: date, name: String(value ?? '') })
    if (kind === 'displayCode') updateLineDisplayCodeHistoryEntry(target, { id: existing.displayCode?.id ?? uid('line-display-code'), effectiveAt: date, displayCode: String(value ?? '') })
    if (kind === 'parent') updateLineParentHistoryEntry(next, target.id, { id: existing.parent?.id ?? uid('line-parent'), effectiveAt: date, parentLineId: value || null })
    if (kind === 'color') updateLineColorHistoryEntry(target, { id: existing.color?.id ?? uid('line-color'), effectiveAt: date, color: String(value ?? '') })
    if (date) setDraftDates(items => items.filter(item => item !== date))
  })

  const removeField = (date: string, kind: FieldKind) => mutate((next, target) => {
    const existing = changedAt(target, date)
    if (kind === 'name' && existing.name) removeLineNameHistoryEntry(target, existing.name.id)
    if (kind === 'displayCode' && existing.displayCode) removeLineDisplayCodeHistoryEntry(target, existing.displayCode.id)
    if (kind === 'parent' && existing.parent) removeLineParentHistoryEntry(next, target.id, existing.parent.id)
    if (kind === 'color' && existing.color) removeLineColorHistoryEntry(target, existing.color.id)
  })

  const moveDate = (from: string, to: string) => {
    if (!to || to === from) return
    mutate((next, target) => {
      const existing = changedAt(target, from)
      if (existing.name) updateLineNameHistoryEntry(target, { ...existing.name, effectiveAt: to })
      if (existing.displayCode) updateLineDisplayCodeHistoryEntry(target, { ...existing.displayCode, effectiveAt: to })
      if (existing.parent) updateLineParentHistoryEntry(next, target.id, { ...existing.parent, effectiveAt: to })
      if (existing.color) updateLineColorHistoryEntry(target, { ...existing.color, effectiveAt: to })
    })
    setDraftDates(items => items.map(item => item === from ? to : item))
  }

  const addDate = () => {
    if (!newDate) return
    if (!dates.includes(newDate)) setDraftDates(items => [...items, newDate])
  }

  const renderRow = (date: HistoryDate) => {
    const snapshot = date
      ? effectiveSnapshot(project, line, date)
      : {
          name: normalizeLineNameHistory(line)?.[0]?.name ?? line.name,
          displayCode: normalizeLineDisplayCodeHistory(line)?.[0]?.displayCode ?? getLineDisplayCodeAt(line),
          parentLineId: normalizeLineParentHistory(line)?.[0]?.parentLineId ?? line.parentLineId ?? null,
          ownColor: normalizeLineColorHistory(line)?.[0]?.color ?? line.color,
          effectiveColor: date ? getEffectiveLineColor(project, line, date) : line.color,
        }
    const changed = changedAt(line, date)
    const isDraft = Boolean(date && draftDates.includes(date) && !persistedDates.includes(date))
    const parentName = snapshot.parentLineId ? getLineDisplayName(project, project.lines.find(item => item.id === snapshot.parentLineId) ?? line) : ''
    return <div className="station-name-history-entry line-history-date-entry" key={date ?? 'baseline'} data-history-date={date ?? 'baseline'} data-current-timeline-date={date === currentDate ? 'true' : undefined}>
      <div className="line-history-date-heading">
        <strong>{date ?? '初始状态'}</strong>
        {date === currentDate && <span className="eyebrow">当前时间轴</span>}
        {isDraft && <span className="meta-note">尚未保存任何变化</span>}
      </div>
      {date && <Field label="生效日期"><input aria-label={`${date} 生效日期`} type="date" value={date} onChange={event => moveDate(date, event.target.value)} /></Field>}
      <div className="line-history-field">
        <Field label="线路名称"><input aria-label={`${date ?? '初始'} 线路名称`} value={snapshot.name} onChange={event => updateField(date, 'name', event.target.value)} /></Field>
        {date && changed.name && <button type="button" onClick={() => removeField(date, 'name')}>取消此日名称变化</button>}
      </div>
      <div className="line-history-field">
        <Field label="线路代码 / 编号"><input aria-label={`${date ?? '初始'} 线路代码`} value={snapshot.displayCode} onChange={event => updateField(date, 'displayCode', event.target.value)} /></Field>
        {date && changed.displayCode && <button type="button" onClick={() => removeField(date, 'displayCode')}>取消此日代码变化</button>}
      </div>
      <div className="line-history-field">
        <Field label="线路身份"><select aria-label={`${date ?? '初始'} 线路身份`} value={snapshot.parentLineId ?? ''} onChange={event => updateField(date, 'parent', event.target.value || null)}><option value="">独立线路</option>{project.lines.filter(item => item.id !== line.id && !item.isFake).map(item => <option key={item.id} value={item.id}>作为「{getLineDisplayName(project, item) || item.id}」的支线</option>)}</select></Field>
        {snapshot.parentLineId && <p className="meta-note">此时继承「{parentName || snapshot.parentLineId}」所属线路族的显示颜色。</p>}
        {date && changed.parent && <button type="button" onClick={() => removeField(date, 'parent')}>取消此日身份变化</button>}
      </div>
      <div className="line-history-field">
        <Field label="线路固有颜色"><input aria-label={`${date ?? '初始'} 线路固有颜色`} type="color" value={snapshot.ownColor} onChange={event => updateField(date, 'color', event.target.value)} /></Field>
        {snapshot.parentLineId && <p className="meta-note">固有颜色 {snapshot.ownColor}；此时实际显示 {snapshot.effectiveColor}。</p>}
        {date && changed.color && <button type="button" onClick={() => removeField(date, 'color')}>取消此日颜色变化</button>}
      </div>
    </div>
  }

  return <section className="station-label-layout line-history-editor" data-testid="line-history-editor">
    <span className="eyebrow">线路发展史</span>
    <div className="line-history-current-summary" data-testid="line-history-current-summary">
      <strong>时间轴 {currentDate}</strong>
      <p>{current.name} · {current.displayCode} · {current.parentLineId ? '支线' : '独立线路'}</p>
      <p className="meta-note">固有颜色 {current.ownColor}；实际显示 {current.effectiveColor}</p>
    </div>
    {renderRow(null)}
    {dates.map(date => renderRow(date))}
    <div className="line-history-add-date">
      <Field label="新增发展史日期"><input aria-label="新增发展史日期" type="date" value={newDate} onChange={event => setNewDate(event.target.value)} /></Field>
      <button type="button" onClick={addDate}>＋ 添加发展史节点</button>
    </div>
    <p className="meta-note">同一天可以同时发生名称、编号、主支关系和固有颜色变化；未发生变化的字段自动沿用上一状态。每个字段都可单独取消，不会误删同日其它变化。</p>
  </section>
}
