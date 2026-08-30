import { useEffect, useState } from 'react'
import type { ActualRouteProject } from '../data/model'

const toDay = (date: string) => Math.round(new Date(`${date}T00:00:00Z`).getTime() / 86400000)
const fromDay = (day: number) => new Date(day * 86400000).toISOString().slice(0, 10)
export function Timeline({ project, onChange }: { project: ActualRouteProject; onChange: (next: ActualRouteProject, transient?: boolean) => void }) {
  const t = project.timeline
  const dates = [...project.lines, ...project.stations, ...project.stationLineRelations, ...project.geometry.segments].flatMap((item) => [item.openedAt, item.closedAt]).filter((x): x is string => Boolean(x))
  const noDates = dates.length === 0
  const [expanded,setExpanded]=useState(!noDates)
  useEffect(()=>{if(!noDates)setExpanded(true)},[noDates])
  const update = (values: Partial<typeof t>, transient = false) => { const next = structuredClone(project); Object.assign(next.timeline, values); onChange(next, transient) }
  if(!expanded)return <footer className="timeline timeline-collapsed"><span><strong>发展史</strong> · 无时间数据</span><button onClick={()=>setExpanded(true)}>展开</button></footer>
  return <footer className="timeline">
    <div className="timeline-title"><span className="timeline-label">时间轴</span>{noDates ? <strong>无时间数据 · 显示全部</strong> : <input aria-label="当前日期" type="date" value={t.currentDate} min={t.startDate} max={t.endDate} onInput={(e) => update({ currentDate: e.currentTarget.value })} />}{noDates&&<button className="timeline-collapse-button" onClick={()=>setExpanded(false)}>收起</button>}</div>
    <div className="timeline-controls"><button onClick={() => update({ currentDate: t.startDate, playing: false })}>|◀</button><button className="play" onClick={() => update({ playing: !t.playing })}>{t.playing ? '暂停' : '播放'}</button><button onClick={() => update({ currentDate: t.endDate, playing: false })}>▶|</button></div>
    <span className="date-end">{t.startDate.replaceAll('-', '.')}</span><input aria-label="时间轴" type="range" disabled={noDates} min={toDay(t.startDate)} max={toDay(t.endDate)} value={toDay(t.currentDate)} onInput={(e) => update({ currentDate: fromDay(Number(e.currentTarget.value)) }, true)} /><span className="date-end">{t.endDate.replaceAll('-', '.')}</span>
  </footer>
}
