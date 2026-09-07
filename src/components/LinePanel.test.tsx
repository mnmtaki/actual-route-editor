import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { LinePanel } from './LinePanel'
describe('line structure panel',()=>{
 it('keeps line structure but no longer renders global style controls',()=>{render(<LinePanel project={structuredClone(demoProject)} selection={null} activeLineId={null} onSelect={()=>{}} onChange={()=>{}} onAddLine={()=>{}}/>);expect(screen.getByRole('complementary',{name:'线路结构'})).toBeTruthy();expect(screen.queryByText('线路宽度')).toBeNull();expect(screen.queryByText('中文站名字号')).toBeNull()})
 it('keeps one color marker and semantic visible/locked controls per line',()=>{
  const {container}=render(<LinePanel project={structuredClone(demoProject)} selection={null} activeLineId={null} onSelect={()=>{}} onChange={()=>{}} onAddLine={()=>{}}/>)
  expect(container.querySelectorAll('.line-color')).toHaveLength(demoProject.lines.length)
  expect(container.querySelectorAll('.line-color-input')).toHaveLength(0)
  expect(screen.getAllByTitle('隐藏线路')).toHaveLength(demoProject.lines.length)
  expect(screen.getAllByTitle('锁定线路')).toHaveLength(demoProject.lines.length)
  expect(screen.getAllByLabelText(/隐藏线路$/)).toHaveLength(demoProject.lines.length)
  expect(screen.getAllByLabelText(/锁定线路$/)).toHaveLength(demoProject.lines.length)
 })
 it('reports modifier clicks and distinguishes active from secondary selected rows',()=>{
  const onSelect=vi.fn()
  const view=render(<LinePanel project={structuredClone(demoProject)} selection={{type:'line',id:'line-a'}} activeLineId='line-a' selectedLineIds={['line-a','line-b']} onSelect={onSelect} onChange={()=>{}} onAddLine={()=>{}}/>)
  expect(view.container.querySelector('.line-row.active')).toBeTruthy()
  expect(view.container.querySelector('.line-row.secondary-selected')).toBeTruthy()
  fireEvent.click(view.container.querySelectorAll('.line-row-main')[1],{ctrlKey:true})
  expect(onSelect).toHaveBeenCalledWith('line-b',{ctrlKey:true,metaKey:false,shiftKey:false})
 })
})
