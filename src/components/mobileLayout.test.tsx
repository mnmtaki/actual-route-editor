import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { ContextActions } from './ContextActions'
import { StyleDrawer } from './StyleDrawer'

describe('mobile-ready information architecture hooks',()=>{
  it('uses the responsive Style Drawer class rather than an inline fixed desktop width',()=>{
    render(<StyleDrawer project={structuredClone(demoProject)} onChange={()=>{}} onClose={()=>{}}/>)
    const drawer=screen.getByRole('dialog',{name:'全局样式'})
    expect(drawer).toHaveClass('style-drawer')
    expect(drawer).not.toHaveAttribute('style')
  })
  it('uses the compact action-bar class shared by touch layout',()=>{
    render(<ContextActions project={demoProject} selection={{type:'segment',id:'a-1'}} onExtend={()=>{}} onInsertStation={()=>{}} onAddWaypoint={()=>{}} onStraighten={()=>{}} onStructureChange={()=>{}} onDelete={()=>{}}/>)
    expect(screen.getByRole('region',{name:'区间快捷操作'})).toHaveClass('context-action-bar')
  })
})
