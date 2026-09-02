import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { Inspector } from './Inspector'

describe('Inspector station history editing', () => {
  it('writes a station date to the selected Station-Line Relation instead of the spatial Station entity', () => {
    const project=structuredClone(demoProject),onChange=vi.fn()
    render(<Inspector project={project} selection={{type:'station',id:'s4'}} onChange={onChange} onDelete={()=>{}} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}} />)
    expect(screen.queryByLabelText('站点开通')).toBeNull()
    fireEvent.change(screen.getByLabelText('澄川线'),{target:{value:'2026-01-01'}})
    const next=onChange.mock.calls[0][0]
    expect(next.stationLineRelations.find((item:{stationId:string;lineId:string})=>item.stationId==='s4'&&item.lineId==='line-a').openedAt).toBe('2026-01-01')
    expect(next.stations.find((item:{id:string})=>item.id==='s4').openedAt).toBe('2000-01-01')
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
  it('offers adding a badge only from the selected Line inspector',()=>{const onAddLineBadge=vi.fn();render(<Inspector project={structuredClone(demoProject)} selection={{type:'line',id:'line-a'}} onChange={()=>{}} onDelete={()=>{}} onAddLineBadge={onAddLineBadge} onPhasePreview={()=>{}} onStartPhaseDrawing={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'添加线路标号'}));expect(onAddLineBadge).toHaveBeenCalledWith('line-a')})
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
