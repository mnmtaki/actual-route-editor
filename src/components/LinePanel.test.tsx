import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { LinePanel } from './LinePanel'

describe('line structure panel',()=>{
 it('keeps the top level as navigation only',()=>{
  const {container}=render(<LinePanel project={structuredClone(demoProject)} selection={null} activeLineId={null} onSelect={()=>{}} onChange={()=>{}} onAddLine={()=>{}}/>)
  expect(screen.getByRole('complementary',{name:'线路结构'})).toBeTruthy()
  expect(container.querySelectorAll('.line-color')).toHaveLength(demoProject.lines.length)
  expect(container.querySelectorAll('.line-state-button')).toHaveLength(0)
  expect(screen.queryByText('线路宽度')).toBeNull()
  expect(screen.queryByTitle('新建支线')).toBeNull()
 })
 it('opens the second-level line settings on a plain click and can return',()=>{
  const onSelect=vi.fn()
  render(<LinePanel project={structuredClone(demoProject)} selection={null} activeLineId={null} onSelect={onSelect} onChange={()=>{}} onAddLine={()=>{}}/>)
  fireEvent.click(screen.getByRole('button',{name:/澄川线/}))
  expect(onSelect).toHaveBeenCalledWith('line-a',{ctrlKey:false,metaKey:false,shiftKey:false})
  expect(screen.getByTestId('line-detail-panel')).toBeTruthy()
  expect(screen.getByText('基本')).toBeTruthy()
  expect(screen.getByText('尺寸')).toBeTruthy()
  expect(screen.getByText('样式')).toBeTruthy()
  expect(screen.getByText('状态')).toBeTruthy()
  expect(screen.getByText('时间')).toBeTruthy()
  expect(screen.getByText('发展历史')).toBeTruthy()
  expect(screen.getByText('线路标签')).toBeTruthy()
  expect(screen.getByText('高级')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'返回线路列表'}))
  expect(screen.queryByTestId('line-detail-panel')).toBeNull()
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
 it('moves visibility, lock, fake and branch creation into line settings',()=>{
  const project=structuredClone(demoProject),onChange=vi.fn(),onAddBranchLine=vi.fn()
  render(<LinePanel project={project} selection={null} activeLineId={null} onSelect={()=>{}} onChange={onChange} onAddLine={()=>{}} onAddBranchLine={onAddBranchLine}/>)
  fireEvent.click(screen.getByRole('button',{name:/澄川线/}))
  expect(screen.getByText('可见')).toBeTruthy()
  expect(screen.getByText('锁定')).toBeTruthy()
  expect(screen.getByText('伪线')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'＋ 新建支线'}))
  expect(onAddBranchLine).toHaveBeenCalledWith('line-a')
 })
})
