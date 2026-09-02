import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_STATION_LABEL_FONT_FAMILY } from '../data/model'
import { normalizeFontFamily, normalizeHexColor } from '../data/style'

export const CHINESE_FONT_PRESETS = [
  ['系统默认', DEFAULT_STATION_LABEL_FONT_FAMILY],
  ['微软雅黑', '"Microsoft YaHei", sans-serif'],
  ['等线', 'DengXian, sans-serif'],
  ['黑体', 'SimHei, sans-serif'],
  ['PingFang SC', '"PingFang SC", sans-serif'],
  ['Noto Sans CJK SC', '"Noto Sans CJK SC", sans-serif'],
  ['sans-serif', 'sans-serif'],
] as const
export const FOREIGN_FONT_PRESETS = [
  ['系统默认', DEFAULT_STATION_LABEL_FONT_FAMILY],
  ['Arial', 'Arial, sans-serif'], ['Helvetica', 'Helvetica, sans-serif'], ['Inter', 'Inter, sans-serif'],
  ['Roboto', 'Roboto, sans-serif'], ['Georgia', 'Georgia, serif'], ['Times New Roman', '"Times New Roman", serif'],
  ['sans-serif', 'sans-serif'], ['serif', 'serif'],
] as const

type Resettable = { overridden?: boolean; onReset?: () => void }
const Reset = ({overridden,onReset}:{overridden?:boolean;onReset?:()=>void}) => overridden&&onReset?<button type="button" className="inline-reset" onClick={onReset}>恢复全局</button>:null

export function FontFamilyControl({label,value,presets,onChange,overridden,onReset}:{label:string;value:string;presets:readonly (readonly [string,string])[];onChange:(value:string)=>void}&Resettable){
  const presetValues=useMemo(()=>presets.map(item=>item[1]),[presets]),isPreset=presetValues.includes(value),[custom,setCustom]=useState(!isPreset),[draft,setDraft]=useState(value)
  useEffect(()=>{setDraft(value);setCustom(!presetValues.includes(value))},[value,presetValues])
  const selected=custom?'__custom__':value
  return <div className="field typography-field"><span>{label}</span><div className="typography-control-row"><select aria-label={label} value={selected} onChange={event=>{if(event.target.value==='__custom__'){setCustom(true);return}setCustom(false);onChange(event.target.value)}}>{presets.map(([name,font])=><option key={font} value={font}>{name}</option>)}<option value="__custom__">自定义…</option></select><Reset overridden={overridden} onReset={onReset}/></div>{custom&&<input aria-label={`${label}自定义`} value={draft} placeholder="字体名称, fallback" onChange={event=>{const next=event.target.value;setDraft(next);const normalized=normalizeFontFamily(next);if(normalized)onChange(normalized)}}/>}</div>
}

export function FontWeightControl({label,value,onChange,overridden,onReset}:{label:string;value:number;onChange:(value:number)=>void}&Resettable){
  const values=[...new Set([300,400,500,600,700,800,value])].sort((a,b)=>a-b)
  return <div className="field typography-field"><span>{label}</span><div className="typography-control-row"><select aria-label={label} value={value} onChange={event=>onChange(Number(event.target.value))}>{values.map(weight=><option key={weight} value={weight}>{weight}</option>)}</select><Reset overridden={overridden} onReset={onReset}/></div></div>
}

export function ColorControl({label,value,onChange,overridden,onReset}:{label:string;value:string;onChange:(value:string)=>void}&Resettable){
  const [draft,setDraft]=useState(value)
  useEffect(()=>setDraft(value),[value])
  return <div className="field typography-field"><span>{label}</span><div className="color-control-row"><input aria-label={`${label}颜色选择`} type="color" value={normalizeHexColor(value)??'#000000'} onChange={event=>{setDraft(event.target.value);onChange(event.target.value)}}/><input aria-label={`${label} HEX`} value={draft} onChange={event=>{const next=event.target.value;setDraft(next);const normalized=normalizeHexColor(next);if(normalized)onChange(normalized)}} onBlur={()=>{if(!normalizeHexColor(draft))setDraft(value)}}/><Reset overridden={overridden} onReset={onReset}/></div></div>
}
