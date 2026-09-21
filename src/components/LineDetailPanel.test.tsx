import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { LineBranchPanel, LineDetailPanel } from './LineDetailPanel'

const common = {
  onBack: () => {},
  onPhasePreview: () => {},
  onStartPhaseDrawing: () => {},
}

describe('line detail management',()=>{
  it('exposes the requested general information architecture without branch controls',()=>{
    render(<LineDetailPanel project={structuredClone(demoProject)} lineId="line-a" onChange={()=>{}} {...common}/>)
    expect(screen.getByText('基本')).toBeTruthy()
    expect(screen.getByText('尺寸')).toBeTruthy()
    expect(screen.getByText('样式')).toBeTruthy()
    expect(screen.getByText('状态')).toBeTruthy()
    expect(screen.getByText('时间')).toBeTruthy()
    expect(screen.getByText('发展历史')).toBeTruthy()
    expect(screen.getByText('线路标签')).toBeTruthy()
    expect(screen.getByText('高级')).toBeTruthy()
    expect(screen.getByText('名称')).toBeTruthy()
    expect(screen.getByText('副名称')).toBeTruthy()
    expect(screen.getByText('线路编号')).toBeTruthy()
    expect(screen.getByLabelText('线路宽度')).toBeTruthy()
    expect(screen.getByLabelText('站点大小')).toBeTruthy()
    expect(screen.getByLabelText('站名大小')).toBeTruthy()
    expect(screen.queryByLabelText('线路身份')).toBeNull()
    expect(screen.queryByLabelText('线路颜色')).toBeNull()
  })

  it('edits width locally while station and station-name size remain explicit global defaults',()=>{
    const project=structuredClone(demoProject),onChange=vi.fn()
    render(<LineDetailPanel project={project} lineId="line-a" onChange={onChange} {...common}/>)
    fireEvent.change(screen.getByLabelText('线路宽度'),{target:{value:'23'}})
    expect(onChange.mock.calls.at(-1)?.[0].lines.find((line:{id:string})=>line.id==='line-a').styleOverrides.lineWidth).toBe(23)
    fireEvent.change(screen.getByLabelText('站点大小'),{target:{value:'16'}})
    expect(onChange.mock.calls.at(-1)?.[0].settings.stationSize).toBe(16)
    fireEvent.change(screen.getByLabelText('站名大小'),{target:{value:'20'}})
    expect(onChange.mock.calls.at(-1)?.[0].settings.stationLabelSize).toBe(20)
  })

  it('keeps histories together under development history and line labels under their own drilldown',()=>{
    const onAddLineBadge=vi.fn()
    render(<LineDetailPanel project={structuredClone(demoProject)} lineId="line-a" onChange={()=>{}} onAddLineBadge={onAddLineBadge} {...common}/>)
    fireEvent.click(screen.getByText('发展历史'))
    expect(screen.getByText('名称历史')).toBeTruthy()
    expect(screen.getByText('编号历史')).toBeTruthy()
    expect(screen.getByText('颜色历史')).toBeTruthy()
    expect(screen.getByText('运营历史')).toBeTruthy()
    expect(screen.queryByText('主支关系历史')).toBeNull()
    fireEvent.click(screen.getByText('线路标签'))
    fireEvent.click(screen.getByRole('button',{name:'＋ 添加线路标签'}))
    expect(onAddLineBadge).toHaveBeenCalledWith('line-a')
  })

  it('moves structural split into advanced and keeps it atomic',()=>{
    const project=structuredClone(demoProject),onChange=vi.fn()
    render(<LineDetailPanel project={project} lineId="line-a" onChange={onChange} {...common}/>)
    fireEvent.click(screen.getByText('高级'))
    fireEvent.click(screen.getByRole('button',{name:'拆分线路'}))
    fireEvent.change(screen.getByLabelText('拆分日期'),{target:{value:'2020-01-01'}})
    fireEvent.change(screen.getByText('新线路名称').closest('label')!.querySelector('input')!,{target:{value:'5号线'}})
    fireEvent.click(screen.getByRole('button',{name:'确认拆分'}))
    const next=onChange.mock.calls.at(-1)?.[0]
    expect(next.lines).toHaveLength(project.lines.length+1)
    expect(next.lines.at(-1).name).toBe('5号线')
  })
})

describe('branch settings',()=>{
  it('keeps branch identity, branch creation and relationship history in a separate panel',()=>{
    const onAddBranchLine=vi.fn()
    render(<LineBranchPanel project={structuredClone(demoProject)} lineId="line-a" onBack={()=>{}} onChange={()=>{}} onAddBranchLine={onAddBranchLine}/>)
    expect(screen.getByText('当前关系')).toBeTruthy()
    expect(screen.getByLabelText('线路身份')).toBeTruthy()
    expect(screen.getByText('所属支线')).toBeTruthy()
    expect(screen.getByText('关系历史')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'＋ 新建支线'}))
    expect(onAddBranchLine).toHaveBeenCalledWith('line-a')
  })


  it('lists only real child lines and exposes branch/settings navigation',()=>{
    const project=structuredClone(demoProject),openBranch=vi.fn(),openSettings=vi.fn()
    project.lines.push(
      {id:'real-branch',name:'机场支线',color:'#000000',parentLineId:'line-a',stationSequence:['s1','s2'],lineOrder:3,visible:true,locked:false},
      {id:'fake-branch',name:'',color:'#000000',parentLineId:'line-a',isFake:true,stationSequence:[],lineOrder:4,visible:true,locked:false},
    )
    render(<LineBranchPanel project={project} lineId="line-a" onBack={()=>{}} onChange={()=>{}} onOpenBranchSettings={openBranch} onOpenLineSettings={openSettings}/>)
    expect(screen.getByText('机场支线')).toBeTruthy()
    expect(screen.queryByText('伪线')).toBeNull()
    const section=screen.getByText('所属支线').closest('section')!
    fireEvent.click(section.querySelectorAll('button')[0])
    fireEvent.click(section.querySelectorAll('button')[1])
    expect(openBranch).toHaveBeenCalledWith('real-branch')
    expect(openSettings).toHaveBeenCalledWith('real-branch')
  })

  it('updates the latest relationship entry instead of inventing another baseline',()=>{
    const project=structuredClone(demoProject),line=project.lines.find(item=>item.id==='line-a')!,onChange=vi.fn()
    line.parentHistory=[
      {id:'base-real',effectiveAt:null,parentLineId:null},
      {id:'dated-real',effectiveAt:'2010-01-01',parentLineId:null},
    ]
    render(<LineBranchPanel project={project} lineId="line-a" onBack={()=>{}} onChange={onChange}/>)
    fireEvent.change(screen.getByLabelText('线路身份'),{target:{value:'line-b'}})
    const nextLine=onChange.mock.calls.at(-1)?.[0].lines.find((item:{id:string})=>item.id==='line-a')
    expect(nextLine.parentHistory.filter((entry:{effectiveAt:string|null})=>entry.effectiveAt===null)).toHaveLength(1)
    expect(nextLine.parentHistory.find((entry:{id:string})=>entry.id==='dated-real').parentLineId).toBe('line-b')
  })
})
