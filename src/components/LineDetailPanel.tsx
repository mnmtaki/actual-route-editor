import { useState } from 'react'
import type { ActualRouteProject, LineStyleOverrides } from '../data/model'
import { uid } from '../data/model'
import { setLineLocked, setLineVisibility } from '../data/editorCommands'
import { isFakeLine, setLineFake } from '../data/fakeLines'
import { getEffectiveLineColor, getLineDisplayName } from '../data/lineIdentity'
import { effectiveLineWidth } from '../data/style'
import { getLineStyles } from '../data/lineStyles'
import { normalizeLineNameHistory, removeLineNameHistoryEntry, setCurrentLineName, updateLineNameHistoryEntry } from '../data/lineNameHistory'
import { normalizeLineDisplayCodeHistory, removeLineDisplayCodeHistoryEntry, resolveCurrentLineDisplayCode, setCurrentLineDisplayCode, updateLineDisplayCodeHistoryEntry } from '../data/lineDisplayCodeHistory'
import { normalizeLineParentHistory, removeLineParentHistoryEntry, updateLineParentHistoryEntry } from '../data/lineParentHistory'
import { normalizeLineColorHistory, removeLineColorHistoryEntry, setCurrentLineOwnColor, updateLineColorHistoryEntry } from '../data/lineColorHistory'
import { splitLineAtStation, type SplitSide } from '../data/operations'
import { OpeningPhaseEditor } from './OpeningPhaseEditor'
import type { OpeningPhasePath } from '../data/openingPhases'

const Field=({label,children}:{label:string;children:React.ReactNode})=><label className="field"><span>{label}</span>{children}</label>

function NumberField({label,value,onChange,min=1,max=120,step=.5}:{label:string;value:number;onChange:(value:number)=>void;min?:number;max?:number;step?:number}){
  return <Field label={label}><input aria-label={label} type="number" value={Number(value.toFixed(2))} min={min} max={max} step={step} onChange={event=>{const next=Number(event.target.value);if(Number.isFinite(next)&&next>=min&&next<=max)onChange(next)}}/></Field>
}

function DrillSection({title,children,testId}:{title:string;children:React.ReactNode;testId?:string}){
  return <details className="line-detail-drill" data-testid={testId}><summary><span>{title}</span><b aria-hidden="true">›</b></summary><div className="line-detail-drill-body">{children}</div></details>
}

function LineHistoryEditor({project,lineId,onChange}:{project:ActualRouteProject;lineId:string;onChange:(next:ActualRouteProject)=>void}){
  const line=project.lines.find(item=>item.id===lineId)
  if(!line)return null
  const patch=(mutate:(next:ActualRouteProject)=>void)=>{const next=structuredClone(project);mutate(next);onChange(next)}
  const names=normalizeLineNameHistory(line)??[{id:`name-base-${line.id}`,effectiveAt:null,name:line.name}]
  const codes=normalizeLineDisplayCodeHistory(line)??[{id:`display-code-base-${line.id}`,effectiveAt:null,displayCode:resolveCurrentLineDisplayCode(line)}]
  const colors=normalizeLineColorHistory(line)??[{id:`color-base-${line.id}`,effectiveAt:null,color:line.color}]
  const today=new Date().toISOString().slice(0,10)
  const safe=(fn:()=>void,message:string)=>{try{fn()}catch(error){window.alert(error instanceof Error?error.message:message)}}
  return <div className="line-history-editor">
    <section><h4>名称历史</h4>{names.map(entry=><div className="line-history-row" key={entry.id}><strong>{entry.effectiveAt??'初始'}</strong>{entry.effectiveAt!==null&&<input aria-label="名称生效日期" type="date" value={entry.effectiveAt} onChange={e=>patch(next=>safe(()=>updateLineNameHistoryEntry(next.lines.find(item=>item.id===line.id)!,{...entry,effectiveAt:e.target.value||null}),'线路名称历史无效'))}/>}<input aria-label="历史线路名称" value={entry.name} onChange={e=>patch(next=>safe(()=>updateLineNameHistoryEntry(next.lines.find(item=>item.id===line.id)!,{...entry,name:e.target.value}),'线路名称历史无效'))}/>{entry.effectiveAt!==null&&<button onClick={()=>patch(next=>removeLineNameHistoryEntry(next.lines.find(item=>item.id===line.id)!,entry.id))}>删除</button>}</div>)}<button onClick={()=>patch(next=>safe(()=>updateLineNameHistoryEntry(next.lines.find(item=>item.id===line.id)!,{id:uid('line-name'),effectiveAt:today,name:line.name}),'线路名称历史无效'))}>＋ 添加名称变更</button></section>
    <section><h4>编号历史</h4>{codes.map(entry=><div className="line-history-row" key={entry.id}><strong>{entry.effectiveAt??'初始'}</strong>{entry.effectiveAt!==null&&<input aria-label="编号生效日期" type="date" value={entry.effectiveAt} onChange={e=>patch(next=>safe(()=>updateLineDisplayCodeHistoryEntry(next.lines.find(item=>item.id===line.id)!,{...entry,effectiveAt:e.target.value||null}),'线路编号历史无效'))}/>}<input aria-label="历史线路编号" value={entry.displayCode} onChange={e=>patch(next=>safe(()=>updateLineDisplayCodeHistoryEntry(next.lines.find(item=>item.id===line.id)!,{...entry,displayCode:e.target.value}),'线路编号历史无效'))}/>{entry.effectiveAt!==null&&<button onClick={()=>patch(next=>removeLineDisplayCodeHistoryEntry(next.lines.find(item=>item.id===line.id)!,entry.id))}>删除</button>}</div>)}<button onClick={()=>patch(next=>safe(()=>updateLineDisplayCodeHistoryEntry(next.lines.find(item=>item.id===line.id)!,{id:uid('line-code'),effectiveAt:today,displayCode:resolveCurrentLineDisplayCode(line)}),'线路编号历史无效'))}>＋ 添加编号变更</button></section>
    <section><h4>颜色历史</h4>{colors.map(entry=><div className="line-history-row" key={entry.id}><strong>{entry.effectiveAt??'初始'}</strong>{entry.effectiveAt!==null&&<input aria-label="颜色生效日期" type="date" value={entry.effectiveAt} onChange={e=>patch(next=>safe(()=>updateLineColorHistoryEntry(next.lines.find(item=>item.id===line.id)!,{...entry,effectiveAt:e.target.value||null}),'线路颜色历史无效'))}/>}<input aria-label="历史线路颜色" type="color" value={entry.color} onChange={e=>patch(next=>safe(()=>updateLineColorHistoryEntry(next.lines.find(item=>item.id===line.id)!,{...entry,color:e.target.value}),'线路颜色历史无效'))}/>{entry.effectiveAt!==null&&<button onClick={()=>patch(next=>removeLineColorHistoryEntry(next.lines.find(item=>item.id===line.id)!,entry.id))}>删除</button>}</div>)}<button onClick={()=>patch(next=>safe(()=>updateLineColorHistoryEntry(next.lines.find(item=>item.id===line.id)!,{id:uid('line-color'),effectiveAt:today,color:line.color}),'线路颜色历史无效'))}>＋ 添加颜色变更</button></section>
  </div>
}

function LineSplitEditor({project,lineId,onChange}:{project:ActualRouteProject;lineId:string;onChange:(next:ActualRouteProject)=>void}){
  const line=project.lines.find(item=>item.id===lineId)
  const [open,setOpen]=useState(false)
  const [date,setDate]=useState(project.timeline.currentDate)
  const [side,setSide]=useState<SplitSide>('after')
  const [name,setName]=useState(`拆分线路 ${project.lines.length+1}`)
  const [color,setColor]=useState('#6b58c4')
  const [stationId,setStationId]=useState(line?.stationSequence[1]??'')
  if(!line||line.stationSequence.length<3)return null
  const index=line.stationSequence.indexOf(stationId),valid=index>0&&index<line.stationSequence.length-1
  return <div className="line-detail-operation">{!open?<button disabled={line.locked} onClick={()=>setOpen(true)}>拆分线路</button>:<>
    <Field label="拆分日期"><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field>
    <Field label="拆分站"><select aria-label="拆分站" value={stationId} onChange={e=>setStationId(e.target.value)}>{line.stationSequence.slice(1,-1).map(id=><option key={id} value={id}>{project.stations.find(station=>station.id===id)?.name??id}</option>)}</select></Field>
    <Field label="拆出一侧"><select value={side} onChange={e=>setSide(e.target.value as SplitSide)}><option value="after">线路序列后方</option><option value="before">线路序列前方</option></select></Field>
    <Field label="新线路名称"><input value={name} onChange={e=>setName(e.target.value)}/></Field>
    <Field label="新线路颜色"><input type="color" value={color} onChange={e=>setColor(e.target.value)}/></Field>
    <div className="line-detail-inline-actions"><button onClick={()=>setOpen(false)}>取消</button><button className="primary" disabled={!valid||!date} onClick={()=>{const result=splitLineAtStation(project,{lineId:line.id,splitStationId:stationId,side,openedAt:date,name,color});if(result.error){window.alert(result.error);return}onChange(result.project);setOpen(false)}}>确认拆分</button></div>
  </>}</div>
}


export function LineBranchPanel({project,lineId,onBack,onChange,onAddBranchLine,onOpenBranchSettings,onOpenLineSettings}:{
  project:ActualRouteProject
  lineId:string
  onBack:()=>void
  onChange:(next:ActualRouteProject)=>void
  onAddBranchLine?:(parentLineId:string)=>void
  onOpenBranchSettings?:(lineId:string)=>void
  onOpenLineSettings?:(lineId:string)=>void
}){
  const line=project.lines.find(item=>item.id===lineId)
  if(!line)return null
  const parentHistory=normalizeLineParentHistory(line)??[{id:`parent-base-${line.id}`,effectiveAt:null,parentLineId:line.parentLineId??null}]
  const currentEntry=parentHistory.at(-1)!
  const children=project.lines.filter(item=>item.parentLineId===line.id&&!isFakeLine(item))
  const patchParent=(entry:{id:string;effectiveAt:string|null;parentLineId:string|null})=>{
    const next=structuredClone(project)
    try{updateLineParentHistoryEntry(next,line.id,entry);onChange(next)}
    catch(error){window.alert(error instanceof Error?error.message:'主支关系无效')}
  }
  const today=new Date().toISOString().slice(0,10)
  return <div className="line-detail-panel" data-testid="line-branch-panel">
    <div className="line-detail-header"><button className="line-detail-back" aria-label="返回线路列表" onClick={onBack}>‹</button><span className="line-color" style={{background:getEffectiveLineColor(project,line)}}/><div><strong>{getLineDisplayName(project,line)||'未命名线路'}</strong><small>支线设置</small></div></div>
    <div className="line-detail-scroll">
      <section className="line-detail-section"><h3>当前关系</h3>
        <Field label="线路身份"><select aria-label="线路身份" value={line.parentLineId??''} onChange={e=>patchParent({...currentEntry,parentLineId:e.target.value||null})}><option value="">独立线路</option>{project.lines.filter(item=>item.id!==line.id&&!item.isFake).map(item=><option key={item.id} value={item.id}>「{getLineDisplayName(project,item)||item.id}」的支线</option>)}</select></Field>
        {!line.parentLineId&&!isFakeLine(line)&&!line.locked&&<button onClick={()=>onAddBranchLine?.(line.id)}>＋ 新建支线</button>}
      </section>
      <section className="line-detail-section"><h3>所属支线</h3>
        {children.length?children.map(child=><div className="line-detail-readonly" key={child.id}><span>{getLineDisplayName(project,child)||'支线'}</span><div className="line-detail-inline-actions"><button type="button" onClick={()=>onOpenBranchSettings?.(child.id)}>支线</button><button type="button" onClick={()=>onOpenLineSettings?.(child.id)}>设置</button></div></div>):<p className="line-detail-note">当前没有直属支线。</p>}
      </section>
      <section className="line-detail-section"><h3>关系历史</h3>
        {parentHistory.map(entry=><div className="line-history-row" key={entry.id}><strong>{entry.effectiveAt??'初始'}</strong>{entry.effectiveAt!==null&&<input aria-label="主支关系生效日期" type="date" value={entry.effectiveAt} onChange={e=>patchParent({...entry,effectiveAt:e.target.value||null})}/>}<select aria-label="历史线路身份" value={entry.parentLineId??''} onChange={e=>patchParent({...entry,parentLineId:e.target.value||null})}><option value="">独立线路</option>{project.lines.filter(item=>item.id!==line.id&&!item.isFake).map(item=><option key={item.id} value={item.id}>作为「{getLineDisplayName(project,item)||item.id}」的支线</option>)}</select>{entry.effectiveAt!==null&&<button onClick={()=>{const next=structuredClone(project);try{removeLineParentHistoryEntry(next,line.id,entry.id);onChange(next)}catch(error){window.alert(error instanceof Error?error.message:'主支关系历史无效')}}}>删除</button>}</div>)}
        <button onClick={()=>patchParent({id:uid('line-parent'),effectiveAt:today,parentLineId:line.parentLineId??null})}>＋ 添加关系变更</button>
      </section>
    </div>
  </div>
}

export function LineDetailPanel({project,lineId,onBack,onChange,onAddBranchLine,onAddLineBadge,onDelete,onPhasePreview,onStartPhaseDrawing}:{
  project:ActualRouteProject
  lineId:string
  onBack:()=>void
  onChange:(next:ActualRouteProject)=>void
  onAddBranchLine?:(parentLineId:string)=>void
  onAddLineBadge?:(lineId:string)=>void
  onDelete?:()=>void
  onPhasePreview?:(path:OpeningPhasePath|null)=>void
  onStartPhaseDrawing?:(phaseId:string,lineId:string,stationId:string|null)=>void
}){
  const line=project.lines.find(item=>item.id===lineId)
  if(!line)return null
  const patch=(mutate:(next:ActualRouteProject)=>void)=>{const next=structuredClone(project);mutate(next);onChange(next)}
  const setLineOverride=(key:keyof LineStyleOverrides,value:number)=>patch(next=>{const target=next.lines.find(item=>item.id===line.id)!;target.styleOverrides??={};target.styleOverrides[key]=value})
  const effectiveColor=getEffectiveLineColor(project,line)
  const effectiveWidth=effectiveLineWidth(line,project.settings)
  const endpointNames=[line.stationSequence[0],line.stationSequence.at(-1)].filter(Boolean).map(id=>project.stations.find(station=>station.id===id)?.name??id)
  return <div className="line-detail-panel" data-testid="line-detail-panel">
    <div className="line-detail-header"><button className="line-detail-back" aria-label="返回线路列表" onClick={onBack}>‹</button><span className="line-color" style={{background:effectiveColor}}/><div><strong>{getLineDisplayName(project,line)||'未命名线路'}</strong><small>线路设置</small></div></div>
    <div className="line-detail-scroll">
      <section className="line-detail-section"><h3>基本</h3>
        <Field label="名称"><input value={line.name} onChange={e=>patch(next=>setCurrentLineName(next.lines.find(item=>item.id===line.id)!,e.target.value))}/></Field>
        <Field label="副名称"><input value={line.nameSub??''} onChange={e=>patch(next=>{const target=next.lines.find(item=>item.id===line.id)!;target.nameSub=e.target.value||undefined})}/></Field>
        <Field label="线路编号"><input value={resolveCurrentLineDisplayCode(line)} onChange={e=>patch(next=>{try{setCurrentLineDisplayCode(next.lines.find(item=>item.id===line.id)!,e.target.value)}catch(error){window.alert(error instanceof Error?error.message:'线路编号无效')}})}/></Field>
      </section>
      <section className="line-detail-section"><h3>尺寸</h3>
        <NumberField label="线路宽度" value={effectiveWidth} min={1} max={120} onChange={value=>setLineOverride('lineWidth',value)}/>
        <NumberField label="站点大小" value={project.settings.stationSize} min={1} max={120} onChange={value=>patch(next=>{next.settings.stationSize=value})}/>
        <NumberField label="站名大小" value={project.settings.stationLabelSize} min={1} max={120} onChange={value=>patch(next=>{next.settings.stationLabelSize=value})}/>
        <p className="line-detail-note">站点大小与站名大小当前是工程全局默认值；单站覆盖仍在站点属性中设置。</p>
      </section>
      <section className="line-detail-section"><h3>样式</h3>
        <Field label="线路样式"><select aria-label="线路样式" value={line.lineStyleId??'normal'} onChange={e=>patch(next=>{next.lines.find(item=>item.id===line.id)!.lineStyleId=e.target.value})}>{getLineStyles(project).map(style=><option key={style.id} value={style.id}>{style.name}{style.builtin?'（内置）':''}</option>)}</select></Field>
        <NumberField label="层级" value={line.lineOrder} min={0} max={9999} step={1} onChange={value=>patch(next=>{next.lines.find(item=>item.id===line.id)!.lineOrder=Math.round(value)})}/>
      </section>
      <section className="line-detail-section"><h3>状态</h3>
        <label className="line-detail-toggle"><span>可见</span><input type="checkbox" checked={line.visible} onChange={e=>onChange(setLineVisibility(project,line.id,e.target.checked))}/></label>
        <label className="line-detail-toggle"><span>锁定</span><input type="checkbox" checked={line.locked} onChange={e=>onChange(setLineLocked(project,line.id,e.target.checked))}/></label>
        <label className="line-detail-toggle"><span>伪线</span><input type="checkbox" checked={isFakeLine(line)} onChange={e=>onChange(setLineFake(project,line.id,e.target.checked))}/></label>
        <div className="line-detail-readonly"><span>端点</span><strong>{endpointNames.length?endpointNames.join(' ↔ '):'暂无站点'}</strong></div>
      </section>
      <section className="line-detail-section"><h3>时间</h3>
        <Field label="开通日期"><input type="date" value={line.openedAt??''} onChange={e=>patch(next=>{next.lines.find(item=>item.id===line.id)!.openedAt=e.target.value||null})}/></Field>
        <Field label="停运日期"><input type="date" value={line.closedAt??''} onChange={e=>patch(next=>{next.lines.find(item=>item.id===line.id)!.closedAt=e.target.value||null})}/></Field>
      </section>
      <DrillSection title="发展历史" testId="line-history-drill"><LineHistoryEditor project={project} lineId={line.id} onChange={onChange}/>{onPhasePreview&&onStartPhaseDrawing&&<OpeningPhaseEditor project={project} line={line} onChange={onChange} onPreview={onPhasePreview} onStartDrawing={onStartPhaseDrawing}/>}</DrillSection>
      <DrillSection title="线路标签" testId="line-labels-drill"><p className="line-detail-note">已有 {line.lineBadges?.length??0} 个原生线路标签；AARC 导入标签保持源数据保真。</p><button onClick={()=>onAddLineBadge?.(line.id)}>＋ 添加线路标签</button></DrillSection>
      <DrillSection title="高级" testId="line-advanced-drill"><LineSplitEditor project={project} lineId={line.id} onChange={onChange}/>{line.source?.format==='aarc'&&<div className="line-detail-readonly"><span>AARC 源线路 ID</span><strong>{String(line.source.sourceLineId??line.source.lineId??'—')}</strong></div>}<button className="danger" onClick={onDelete}>删除线路</button></DrillSection>
    </div>
  </div>
}
