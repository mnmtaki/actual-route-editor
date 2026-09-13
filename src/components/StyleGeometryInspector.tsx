import { useState } from 'react'
import type { ActualRouteProject, Selection, SegmentMode, StructureType } from '../data/model'
import { DEFAULT_CORNER_RADIUS, getWaypointCornerPlan } from '../geometry/path'
import { getLineStyles } from '../data/lineStyles'
import { isSegmentGeometryLocked } from '../data/lineLock'
import { markSegmentDateOverride, phaseForSegment } from '../data/openingPhases'
import { deleteStylePoint, getSegmentStyleIntervalAtProgress, resolveStructureNodeProgress, styleIntervalStatesAroundPoint, styleIntervalStatesEqual, updateStyleIntervalAtProgress, type StyleIntervalState } from '../data/structure'

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="field"><span>{label}</span>{children}</label>
const round = (value: number) => Math.round(value * 100) / 100

export function StyleGeometryInspector({ project, selection, onChange, onDelete, embedded=false }: { project: ActualRouteProject; selection: Selection; onChange: (next: ActualRouteProject) => void; onDelete: () => void; embedded?: boolean }) {
  const [deleteChoice, setDeleteChoice] = useState(false)
  const patch = (mutate: (next: ActualRouteProject) => void) => { const next=structuredClone(project); mutate(next); onChange(next) }
  const shell = (content: React.ReactNode) => <aside className={embedded?'mobile-inspector panel':'right-panel panel'}><div className="panel-heading"><div><h2>属性</h2><span className="panel-subtitle">当前选择</span></div></div><div className="inspector-body">{content}</div></aside>
  if (!selection || !['segment','waypoint','structureNode'].includes(selection.type)) return shell(null)
  const segmentId = selection.type === 'segment' ? selection.id : selection.segmentId
  const segment = project.geometry.segments.find(item => item.id === segmentId)
  if (!segment) return shell(<div className="empty-inspector"><p>当前对象已不存在，请重新选择。</p></div>)
  const locked = isSegmentGeometryLocked(project, segment.id)
  const orderedPoints = [...(segment.structureNodes ?? [])].map(node=>({node,progress:resolveStructureNodeProgress(project,segment,node)})).filter(item=>item.progress>1e-5&&item.progress<1-1e-5).sort((a,b)=>a.progress-b.progress||a.node.id.localeCompare(b.node.id))
  const stylePointName = (id: string) => { const index=orderedPoints.findIndex(item=>item.node.id===id); return index>=0?`样式点 ${index+1}`:'样式点' }
  const stationName = (id: string) => project.stations.find(station=>station.id===id)?.name ?? '未命名站'
  const styleName = (state: StyleIntervalState) => {
    const structure = state.structureType === 'elevated' ? '高架' : '普通 / 地下'
    const lineStyle = state.lineStyleId === undefined ? '跟随线路' : state.lineStyleId === null ? '基础线' : getLineStyles(project).find(style=>style.id===state.lineStyleId)?.name ?? state.lineStyleId
    return `${structure} · ${lineStyle}`
  }

  if (selection.type === 'segment') {
    const progress = selection.progress ?? .5, interval = getSegmentStyleIntervalAtProgress(project,segment,progress)
    const endNode = orderedPoints.find(item=>Math.abs(item.progress-interval.end)<1e-5)?.node
    const from = interval.startNodeId ? stylePointName(interval.startNodeId) : stationName(segment.fromStationId)
    const to = endNode ? stylePointName(endNode.id) : stationName(segment.toStationId)
    const currentState: StyleIntervalState = { structureType: interval.structureType, lineStyleId: interval.lineStyleId }
    const setState = (state: StyleIntervalState) => onChange(updateStyleIntervalAtProgress(project,segment.id,progress,state))
    const phase = phaseForSegment(project,segment.id)
    return shell(<>
      <h3>线路段</h3>
      <p className="meta-note"><strong>{from} — {to}</strong></p>
      <Field label="结构"><select disabled={locked} value={currentState.structureType} onChange={event=>setState({...currentState,structureType:event.target.value as StructureType})}><option value="underground">普通 / 地下</option><option value="elevated">高架</option></select></Field>
      <Field label="线路样式"><select disabled={locked} value={currentState.lineStyleId===undefined?'__inherit__':currentState.lineStyleId===null?'__base__':currentState.lineStyleId} onChange={event=>{const value=event.target.value;setState({...currentState,lineStyleId:value==='__inherit__'?undefined:value==='__base__'?null:value})}}><option value="__inherit__">跟随线路</option><option value="__base__">仅基础线路</option>{getLineStyles(project).map(style=><option key={style.id} value={style.id}>{style.name}{style.builtin?'（内置）':''}</option>)}</select></Field>
      <p className="meta-note">样式属于这段线路；样式点只负责划分边界。</p>
      <section className="station-label-layout"><span className="eyebrow">站间几何</span><Field label="绘制模式"><select disabled={locked} value={segment.mode} onChange={event=>patch(next=>{next.geometry.segments.find(item=>item.id===segment.id)!.mode=event.target.value as SegmentMode})}><option value="straight">直线</option><option value="smooth">平滑</option><option value="corner">折角</option><option value="rounded">局部圆角</option></select></Field><p className="meta-note">几何设置作用于 {stationName(segment.fromStationId)} — {stationName(segment.toStationId)}；控制点只改变线路形状。</p><button disabled={locked||!segment.waypoints.length} onClick={()=>patch(next=>{const original=project.geometry.segments.find(item=>item.id===segment.id)!;const target=next.geometry.segments.find(item=>item.id===segment.id)!;for(const node of target.structureNodes??[]){if(!node.waypointId)continue;const source=original.structureNodes?.find(item=>item.id===node.id);if(!source)continue;node.progress=resolveStructureNodeProgress(project,original,source);delete node.waypointId}target.waypoints=[];target.mode='straight'})}>清空控制点并恢复直线</button></section>
      <Field label="开通日期"><input type="date" value={segment.openedAt??''} onChange={event=>patch(next=>{markSegmentDateOverride(next,segment.id);next.geometry.segments.find(item=>item.id===segment.id)!.openedAt=event.target.value||null})}/></Field>
      <Field label="停运日期"><input type="date" value={segment.closedAt??''} onChange={event=>patch(next=>{next.geometry.segments.find(item=>item.id===segment.id)!.closedAt=event.target.value||null})}/></Field>
      {phase&&<p className="meta-note">开通阶段：{phase.name||'未命名阶段'}{phase.overriddenSegmentIds?.includes(segment.id)?'，已单独覆盖':''}</p>}
      <button className="danger" onClick={onDelete}>删除站间区间</button>
    </>)
  }

  if (selection.type === 'waypoint') {
    const waypoint=segment.waypoints.find(item=>item.id===selection.id)
    if(!waypoint)return shell(<div className="empty-inspector"><p>控制点已删除，请重新选择。</p></div>)
    const cornerPlan=getWaypointCornerPlan(project,segment,waypoint), defaultRadius=segment.cornerRadius??DEFAULT_CORNER_RADIUS
    const removeControlPoint=()=>patch(next=>{const original=project.geometry.segments.find(item=>item.id===segment.id)!;const target=next.geometry.segments.find(item=>item.id===segment.id)!;for(const node of target.structureNodes??[]){if(node.waypointId!==waypoint.id)continue;const source=original.structureNodes?.find(item=>item.id===node.id);if(!source)continue;node.progress=resolveStructureNodeProgress(project,original,source);delete node.waypointId}target.waypoints=target.waypoints.filter(item=>item.id!==waypoint.id)})
    return shell(<><h3>控制点</h3><Field label="点类型"><select disabled={locked} value={waypoint.type} onChange={event=>patch(next=>{next.geometry.segments.find(item=>item.id===segment.id)!.waypoints.find(item=>item.id===waypoint.id)!.type=event.target.value as 'smooth'|'corner'})}><option value="smooth">平滑</option><option value="corner">折角</option></select></Field>{cornerPlan&&<section className="corner-radius-control"><Field label="圆角半径"><input disabled={locked} type="number" inputMode="decimal" min="0" step="1" value={waypoint.cornerRadius??defaultRadius} onChange={event=>patch(next=>{const target=next.geometry.segments.find(item=>item.id===segment.id)?.waypoints.find(item=>item.id===waypoint.id);const value=Number(event.target.value);if(target&&Number.isFinite(value))target.cornerRadius=Math.max(0,value)})}/></Field><p className="meta-note">请求值 {round(cornerPlan.requestedRadius)}，实际值 {round(cornerPlan.effectiveRadius)}{cornerPlan.effectiveRadius+.01<cornerPlan.requestedRadius?'（受相邻腿长限制）':''}</p><button disabled={locked||waypoint.cornerRadius===undefined} onClick={()=>patch(next=>{const target=next.geometry.segments.find(item=>item.id===segment.id)?.waypoints.find(item=>item.id===waypoint.id);if(target)delete target.cornerRadius})}>使用默认值</button></section>}<p className="meta-note">控制点只改变线路形状，不改变线路段样式。与样式点重合时，两者仍是独立职责。</p><button className="danger" disabled={locked} onClick={removeControlPoint}>删除控制点</button></>)
  }

  const node=segment.structureNodes?.find(item=>item.id===selection.id)
  if(!node)return shell(<div className="empty-inspector"><p>样式点已删除，请重新选择。</p></div>)
  const states=styleIntervalStatesAroundPoint(project,segment.id,node.id), pointLabel=stylePointName(node.id)
  const remove=(keep:'before'|'after')=>{onChange(deleteStylePoint(project,segment.id,node.id,keep));setDeleteChoice(false)}
  return shell(<><h3>样式点</h3><p className="meta-note"><strong>{pointLabel}</strong></p><p className="meta-note">样式点只划分线路样式边界；拖动独立样式点只移动分界，不改变线路形状。{node.waypointId?' 当前与控制点重合，移动控制点时会一起移动。':''}</p>{deleteChoice&&states&&!styleIntervalStatesEqual(states.before,states.after)?<section className="station-label-layout"><span className="eyebrow">删除后保留哪一侧样式？</span><button type="button" onClick={()=>remove('before')}>保留前一段：{styleName(states.before)}</button><button type="button" onClick={()=>remove('after')}>保留后一段：{styleName(states.after)}</button><button type="button" onClick={()=>setDeleteChoice(false)}>取消</button></section>:<button className="danger" disabled={locked} onClick={()=>{if(!states||styleIntervalStatesEqual(states.before,states.after))remove('before');else setDeleteChoice(true)}}>删除样式点</button>}</>)
}
