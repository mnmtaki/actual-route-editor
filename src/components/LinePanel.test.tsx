import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { LinePanel } from './LinePanel'

describe('line structure panel',()=>{
 it('keeps the top level compact: direct color, name, branch settings and settings only',()=>{
  const {container}=render(<LinePanel project={structuredClone(demoProject)} selection={null} activeLineId={null} onSelect={()=>{}} onChange={()=>{}} onAddLine={()=>{}}/>)
  expect(screen.getByRole('complementary',{name:'线路结构'})).toBeTruthy()
  expect(container.querySelectorAll('.line-list-color')).toHaveLength(demoProject.lines.length)
  expect(container.querySelectorAll('.line-state-button')).toHaveLength(0)
  expect(screen.getAllByRole('button',{name:/支线设置$/})).toHaveLength(demoProject.lines.length)
  expect(screen.getAllByRole('button',{name:/线路设置$/})).toHaveLength(demoProject.lines.length)
  expect(screen.queryByText('线路宽度')).toBeNull()
 })
 it('edits color directly in the first-level list',()=>{
  const onChange=vi.fn(),project=structuredClone(demoProject)
  render(<LinePanel project={project} selection={null} activeLineId={null} onSelect={()=>{}} onChange={onChange} onAddLine={()=>{}}/>)
  fireEvent.change(screen.getByLabelText('澄川线线路颜色'),{target:{value:'#123456'}})
  expect(onChange.mock.calls.at(-1)?.[0].lines.find((line:{id:string})=>line.id==='line-a').color).toBe('#123456')
 })
 it('opens general settings only from the settings button and can return',()=>{
  const onSelect=vi.fn()
  render(<LinePanel project={structuredClone(demoProject)} selection={null} activeLineId={null} onSelect={onSelect} onChange={()=>{}} onAddLine={()=>{}}/>)
  fireEvent.click(screen.getByRole('button',{name:'澄川线线路设置'}))
  expect(onSelect).toHaveBeenCalledWith('line-a')
  expect(screen.getByTestId('line-detail-panel')).toBeTruthy()
  for(const heading of ['基本','尺寸','样式','状态','时间','发展历史','线路标签','高级']) expect(screen.getByText(heading)).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'返回线路列表'}))
  expect(screen.queryByTestId('line-detail-panel')).toBeNull()
 })
 it('opens branch settings separately from the general settings',()=>{
  render(<LinePanel project={structuredClone(demoProject)} selection={null} activeLineId={null} onSelect={()=>{}} onChange={()=>{}} onAddLine={()=>{}}/>)
  fireEvent.click(screen.getByRole('button',{name:'澄川线支线设置'}))
  expect(screen.getByTestId('line-branch-panel')).toBeTruthy()
  expect(screen.getByText('当前关系')).toBeTruthy()
  expect(screen.getByText('所属支线')).toBeTruthy()
  expect(screen.getByText('关系历史')).toBeTruthy()
  expect(screen.queryByText('尺寸')).toBeNull()
 })
 it('plain name clicks select but do not enter a settings panel',()=>{
  const onSelect=vi.fn()
  render(<LinePanel project={structuredClone(demoProject)} selection={null} activeLineId={null} onSelect={onSelect} onChange={()=>{}} onAddLine={()=>{}}/>)
  fireEvent.click(screen.getByRole('button',{name:'澄川线'}))
  expect(onSelect).toHaveBeenCalledWith('line-a',{ctrlKey:false,metaKey:false,shiftKey:false})
  expect(screen.queryByTestId('line-detail-panel')).toBeNull()
  expect(screen.queryByTestId('line-branch-panel')).toBeNull()
 })
 it('keeps modifier clicks in multi-select mode without drilling down',()=>{
  const onSelect=vi.fn()
  const view=render(<LinePanel project={structuredClone(demoProject)} selection={{type:'line',id:'line-a'}} activeLineId='line-a' selectedLineIds={['line-a','line-b']} onSelect={onSelect} onChange={()=>{}} onAddLine={()=>{}}/>)
  fireEvent.click(view.container.querySelectorAll('.line-row-main')[1],{ctrlKey:true})
  expect(onSelect).toHaveBeenCalledWith('line-b',{ctrlKey:true,metaKey:false,shiftKey:false})
  expect(screen.queryByTestId('line-detail-panel')).toBeNull()
 })
 it('renders parent and child lines as a collapsible hierarchy',()=>{
  const project=structuredClone(demoProject)
  project.lines.push({id:'line-a-branch',name:'',color:'#000000',parentLineId:'line-a',stationSequence:['s1','s2'],lineOrder:3,visible:true,locked:false})
  const view=render(<LinePanel project={project} selection={null} activeLineId={null} onSelect={()=>{}} onChange={()=>{}} onAddLine={()=>{}}/>)
  expect(view.container.querySelectorAll('[data-line-id]')).toHaveLength(project.lines.length)
  expect(screen.getByText(/└ 支线/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'折叠支线'}))
  expect(screen.queryByText(/└ 支线/)).toBeNull()
  expect(screen.getByRole('button',{name:'展开支线'})).toBeTruthy()
 })
 it('offers branch creation inside branch settings, not in the top-level heading',()=>{
  const onAddBranchLine=vi.fn()
  render(<LinePanel project={structuredClone(demoProject)} selection={null} activeLineId={null} onSelect={()=>{}} onChange={()=>{}} onAddLine={()=>{}} onAddBranchLine={onAddBranchLine}/>)
  expect(screen.queryByRole('button',{name:/新建支线/})).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'澄川线支线设置'}))
  fireEvent.click(screen.getByRole('button',{name:'＋ 新建支线'}))
  expect(onAddBranchLine).toHaveBeenCalledWith('line-a')
 })
})
