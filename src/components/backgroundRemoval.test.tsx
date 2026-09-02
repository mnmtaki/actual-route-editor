import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import type { ActualRouteProject } from '../data/model'
import { StyleDrawer } from './StyleDrawer'
import { MobileShell } from './MobileShell'

const withBackground=():ActualRouteProject=>{const project=structuredClone(demoProject);project.background={dataUrl:'data:image/png;base64,AA==',name:'map.png',x:10,y:20,width:400,height:240,opacity:.5,visible:true,locked:true};return project}
const mobileProps=(project:ActualRouteProject,onChange=vi.fn(),onRemoveBackground=vi.fn(()=>true))=>({project,selection:null,activeLineId:project.lines[0]?.id??null,onSelectLine:vi.fn(),onChange,onAddLine:vi.fn(),onOpenPresentation:vi.fn(),onAddText:vi.fn(),onImportProject:vi.fn(),onImportBackground:vi.fn(),onRemoveBackground,onExportProject:vi.fn(),onExportSvg:vi.fn(),onExportImage:vi.fn(),onShareProject:vi.fn(),onShareSvg:vi.fn(),onFitAll:vi.fn(),onZoomSelection:vi.fn(),onDeleteSelection:vi.fn(),onAddLineBadge:vi.fn(),onPhasePreview:vi.fn(),onStartPhaseDrawing:vi.fn(),canUndo:false,canRedo:false,onUndo:vi.fn(),onRedo:vi.fn()})

afterEach(()=>vi.unstubAllGlobals())

describe('basemap removal UI',()=>{
  it('hides the delete action when no basemap exists',()=>{
    render(<StyleDrawer project={structuredClone(demoProject)} onChange={vi.fn()} onClose={vi.fn()}/>)
    expect(screen.queryByRole('button',{name:'删除底图'})).toBeNull()
  })

  it('confirms and removes the basemap through the existing project snapshot callback',()=>{
    vi.stubGlobal('confirm',vi.fn(()=>true))
    const project=withBackground(),onChange=vi.fn()
    render(<StyleDrawer project={project} onChange={onChange} onClose={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button',{name:'删除底图'}))
    expect(confirm).toHaveBeenCalledWith('删除当前底图？\n删除后将从当前工程中移除底图，不影响线路和车站。')
    const next=onChange.mock.calls.at(-1)?.[0] as ActualRouteProject
    expect(next.background).toBeNull()
    expect(next.lines).toEqual(project.lines)
    expect(next.geometry).toEqual(project.geometry)
  })

  it('offers the same action in the mobile settings drawer only when a basemap exists',()=>{
    const onRemoveBackground=vi.fn(()=>true)
    render(<MobileShell {...mobileProps(withBackground(),vi.fn(),onRemoveBackground)}/>)
    fireEvent.click(screen.getByRole('button',{name:'设置'}))
    fireEvent.click(screen.getByRole('button',{name:'删除底图'}))
    expect(onRemoveBackground).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog',{name:'设置'})).toBeNull()
  })

  it('hides the mobile delete action without a basemap and removes it through the fallback path',()=>{
    const noBackground=render(<MobileShell {...mobileProps(structuredClone(demoProject))}/>)
    fireEvent.click(screen.getByRole('button',{name:'设置'}))
    expect(screen.queryByRole('button',{name:'删除底图'})).toBeNull()
    noBackground.unmount()
    vi.stubGlobal('confirm',vi.fn(()=>true))
    const project=withBackground(),onChange=vi.fn()
    render(<MobileShell {...mobileProps(project,onChange)} onRemoveBackground={undefined}/>)
    fireEvent.click(screen.getByRole('button',{name:'设置'}))
    fireEvent.click(screen.getByRole('button',{name:'删除底图'}))
    expect((onChange.mock.calls.at(-1)?.[0] as ActualRouteProject).background).toBeNull()
  })
})
