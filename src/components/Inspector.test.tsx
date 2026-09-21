import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { Inspector } from './Inspector'

describe('Inspector line styles', () => {
  it('selects a LineStyle on the selected line', () => {
    const project = structuredClone(demoProject), onChange = vi.fn()
    render(<Inspector project={project} selection={{ type: 'line', id: 'line-a' }} onChange={onChange} onDelete={() => {}} onPhasePreview={() => {}} onStartPhaseDrawing={() => {}} />)
    fireEvent.change(screen.getByLabelText('线路样式'), { target: { value: 'elevated' } })
    expect(onChange.mock.calls.at(-1)?.[0].lines[0].lineStyleId).toBe('elevated')
  })
})

describe('Inspector station history editing', () => {
  it('switches a station between phase inheritance and an independent opening date without exposing relation internals', () => {
    const project=structuredClone(demoProject),onChange=vi.fn()
    project.openingPhases=[{id:'phase-a',lineId:'line-a',openedAt:'2000-01-01',segmentIds:['a-1','a-2','a-3'],stationRelationIds:['r-a-s1','r-a-s2','r-a-s3','r-a-s4'],overriddenSegmentIds:[],overriddenStationRelationIds:[]}]
    const view=render(<Inspector project={project} selection={{type:'station',id:'s4'}} onChange={onChange} onDelete={()=>{}} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}} />)
    expect(screen.getByText('车站开通')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('澄川线车站开通方式'),{target:{value:'custom'}})
    let next=onChange.mock.calls.at(-1)![0]
    expect(next.openingPhases[0].overriddenStationRelationIds).toContain('r-a-s4')
    view.rerender(<Inspector project={next} selection={{type:'station',id:'s4'}} onChange={onChange} onDelete={()=>{}} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}} />)
    fireEvent.change(screen.getByLabelText('开通日期'),{target:{value:'2021-06-01'}})
    next=onChange.mock.calls.at(-1)![0]
    expect(next.stationLineRelations.find((item:{stationId:string;lineId:string})=>item.stationId==='s4'&&item.lineId==='line-a').openedAt).toBe('2021-06-01')
    expect(next.stations.find((item:{id:string})=>item.id==='s4').openedAt).toBe('2000-01-01')
    view.rerender(<Inspector project={next} selection={{type:'station',id:'s4'}} onChange={onChange} onDelete={()=>{}} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}} />)
    expect(screen.getByText(/暂缓开通/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('澄川线车站开通方式'),{target:{value:'phase'}})
    next=onChange.mock.calls.at(-1)![0]
    expect(next.stationLineRelations.find((item:{id:string})=>item.id==='r-a-s4').openedAt).toBe('2000-01-01')
    expect(next.openingPhases[0].overriddenStationRelationIds).not.toContain('r-a-s4')
  })
  it('edits station label direction, distance and independent rotation without moving the Station',()=>{
    const project=structuredClone(demoProject),onChange=vi.fn()
    render(<Inspector project={project} selection={{type:'station',id:'s4'}} onChange={onChange} onDelete={()=>{}} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}} />)
    fireEvent.change(screen.getByLabelText('站名方向'),{target:{value:'right'}})
    let next=onChange.mock.calls.at(-1)![0],station=next.stations.find((item:{id:string})=>item.id==='s4')
    expect(station.x).toBe(820);expect(station.y).toBe(280);expect(station.labelOffsetY).toBe(0)
    fireEvent.change(screen.getByLabelText('站名旋转角度'),{target:{value:'30'}})
    next=onChange.mock.calls.at(-1)![0];expect(next.stations.find((item:{id:string})=>item.id==='s4').labelRotation).toBe(30)
  })
  it('creates and clears only an explicitly edited sparse override',()=>{const project=structuredClone(demoProject),onChange=vi.fn();const view=render(<Inspector project={project} selection={{type:'station',id:'s2'}} onChange={onChange} onDelete={()=>{}} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}}/>);fireEvent.change(screen.getByLabelText('站点大小'),{target:{value:'17'}});let next=onChange.mock.calls.at(-1)![0];expect(next.stations.find((item:{id:string})=>item.id==='s2').styleOverrides).toEqual({stationSize:17});view.rerender(<Inspector project={next} selection={{type:'station',id:'s2'}} onChange={onChange} onDelete={()=>{}} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'恢复全局'}));next=onChange.mock.calls.at(-1)![0];expect(next.stations.find((item:{id:string})=>item.id==='s2').styleOverrides).toBeUndefined();view.rerender(<Inspector project={project} selection={{type:'line',id:'line-a'}} onChange={onChange} onDelete={()=>{}} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}}/>);fireEvent.change(screen.getByLabelText('线路宽度'),{target:{value:'32'}});expect(onChange.mock.calls.at(-1)![0].lines.find((item:{id:string})=>item.id==='line-a').styleOverrides).toEqual({lineWidth:32})})
  it('creates typography overrides and restores one field to the latest global value',()=>{const project=structuredClone(demoProject),onChange=vi.fn(),props={selection:{type:'station' as const,id:'s2'},onChange,onDelete:()=>{},onPhasePreview:()=>{},onStartPhaseDrawing:()=>{}};const view=render(<Inspector project={project} {...props}/>);fireEvent.change(screen.getByLabelText('中文站名字体'),{target:{value:'SimHei, sans-serif'}});let next=onChange.mock.calls.at(-1)![0];expect(next.stations.find((item:{id:string})=>item.id==='s2').styleOverrides).toEqual({labelFontFamily:'SimHei, sans-serif'});next.settings.stationLabelFontFamily='DengXian, sans-serif';view.rerender(<Inspector project={next} {...props}/>);const field=screen.getByLabelText('中文站名字体').closest('.typography-field')!;fireEvent.click(field.querySelector('button')!);next=onChange.mock.calls.at(-1)![0];expect(next.stations.find((item:{id:string})=>item.id==='s2').styleOverrides).toBeUndefined();expect(next.settings.stationLabelFontFamily).toBe('DengXian, sans-serif')})
  it('edits the selected line label corner radius independently',()=>{const project=structuredClone(demoProject),line=project.lines.find(item=>item.id==='line-a')!,onChange=vi.fn();line.lineBadges=[{id:'badge-radius',x:100,y:80,size:40,rotation:0,visible:true}];render(<Inspector project={project} selection={{type:'lineLabel',id:'badge-radius',lineId:line.id,source:'native'}} onChange={onChange} onDelete={()=>{}} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}}/>);expect(screen.getByLabelText('线路标签圆角半径')).toHaveValue(8.8);fireEvent.change(screen.getByLabelText('线路标签圆角半径'),{target:{value:'5'}});expect(onChange.mock.calls.at(-1)![0].lines.find((item:{id:string})=>item.id===line.id).lineBadges[0].cornerRadius).toBe(5)})
  it('edits an imported AARC line label through the same line-label inspector concept',()=>{const project=structuredClone(demoProject),line=project.lines.find(item=>item.id==='line-a')!,onChange=vi.fn();project.textTags=[{id:'aarc-label',kind:'LineNameLabel',x:10,y:20,lineId:line.id,padding:1,width:50,source:{format:'aarc',kind:'text-tag',forId:1,targetKind:'line'}}];render(<Inspector project={project} selection={{type:'lineLabel',id:'aarc-label',lineId:line.id,source:'aarc'}} onChange={onChange} onDelete={()=>{}} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}}/>);expect(screen.getByRole('heading',{name:'线路标签'})).toBeInTheDocument();expect(screen.getByDisplayValue('AARC 导入（保真）')).toBeInTheDocument();fireEvent.change(screen.getByLabelText('AARC线路标签边距'),{target:{value:'2'}});expect(onChange.mock.calls.at(-1)![0].textTags[0].padding).toBe(2)})
  it('keeps selected-line inspector limited to direct visual properties',()=>{render(<Inspector project={structuredClone(demoProject)} selection={{type:'line',id:'line-a'}} onChange={()=>{}} onDelete={()=>{}} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}}/>);expect(screen.getByLabelText('线路样式')).toBeTruthy();expect(screen.getByLabelText('线路宽度')).toBeTruthy();expect(screen.queryByText('线路名称历史')).toBeNull();expect(screen.queryByRole('button',{name:'添加线路标签'})).toBeNull();expect(screen.queryByRole('button',{name:'拆分线路'})).toBeNull();expect(screen.queryByText('运营历史')).toBeNull()})
  it('edits one selected rounded corner immediately and clears only its local radius',()=>{
    const project=structuredClone(demoProject),segment=project.geometry.segments.find(item=>item.id==='a-1')!,onChange=vi.fn()
    segment.mode='rounded';segment.waypoints=[{id:'corner-a',x:260,y:360,type:'corner',cornerRadius:20},{id:'corner-b',x:330,y:420,type:'corner',cornerRadius:70}]
    const view=render(<Inspector project={project} selection={{type:'waypoint',id:'corner-a',segmentId:segment.id}} onChange={onChange} onDelete={()=>{}} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}}/>)
    fireEvent.change(screen.getByLabelText('圆角半径'),{target:{value:'25'}})
    let next=onChange.mock.calls.at(-1)![0],nextSegment=next.geometry.segments.find((item:{id:string})=>item.id===segment.id)
    expect(nextSegment.waypoints.find((item:{id:string})=>item.id==='corner-a').cornerRadius).toBe(25)
    expect(nextSegment.waypoints.find((item:{id:string})=>item.id==='corner-b').cornerRadius).toBe(70)
    view.rerender(<Inspector project={next} selection={{type:'waypoint',id:'corner-a',segmentId:segment.id}} onChange={onChange} onDelete={()=>{}} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}}/>)
    fireEvent.click(screen.getByText('使用默认值'))
    next=onChange.mock.calls.at(-1)![0];nextSegment=next.geometry.segments.find((item:{id:string})=>item.id===segment.id)
    expect(nextSegment.waypoints.find((item:{id:string})=>item.id==='corner-a').cornerRadius).toBeUndefined()
    expect(nextSegment.waypoints.find((item:{id:string})=>item.id==='corner-b').cornerRadius).toBe(70)
  })
})

describe('Inspector compound station summary', () => {
  it('shows passenger lines and compound member context without changing relations', () => {
    const project = structuredClone(demoProject)
    const station = project.stations.find(item => item.id === 's2')!
    station.compoundGroupId = 'civic'
    project.stations.push({ ...station, id: 's2-aux', name: '辅助成员', compoundGroupId: 'civic' })
    const onChange = vi.fn()
    render(<Inspector project={project} selection={{ type: 'station', id: 's2' }} onChange={onChange} onDelete={() => {}} onPhasePreview={() => {}} onStartPhaseDrawing={() => {}} />)
    expect(screen.getByTestId('compound-station-summary')).toHaveTextContent('复合换乘站')
    expect(screen.getByTestId('compound-station-summary')).toHaveTextContent('换乘线路')
    expect(screen.getByTestId('compound-station-summary')).toHaveTextContent('2 个')
    expect(screen.getByLabelText('换乘站宽度')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })
  it('keeps concrete member relations visible when inspecting an auxiliary station', () => {
    const project = structuredClone(demoProject)
    const canonical = project.stations.find(item => item.id === 's2')!
    canonical.compoundGroupId = 'civic'
    project.stations.push({ ...canonical, id: 's2-aux', name: '未命名站921', compoundGroupId: 'civic' })
    project.stationLineRelations.push({ id: 'r-aux-b', stationId: 's2-aux', lineId: 'line-b', openedAt: '2000-01-01' })
    const view = render(<Inspector project={project} selection={{ type: 'station', id: 's2-aux' }} onChange={() => {}} onDelete={() => {}} onPhasePreview={() => {}} onStartPhaseDrawing={() => {}} />)
    const summary = screen.getByTestId('compound-station-summary')
    expect(summary).toHaveTextContent('由其他成员承载')
    expect(summary).toHaveTextContent('本成员线路')
    expect(summary).toHaveTextContent('南北线')
    expect(screen.getByLabelText('南北线车站开通方式')).toBeTruthy()
    expect(view.container.querySelector('[data-testid="compound-station-summary"]')).toBeTruthy()
  })
})