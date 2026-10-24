import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { getSegmentPath } from '../geometry/path'
import { NetworkCanvas } from './NetworkCanvas'

beforeAll(() => {
  class TestPointerEvent extends MouseEvent { pointerId: number; constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } }
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: TestPointerEvent })
  Object.defineProperty(SVGElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } })
})

const baseProps = { selection: null, drawing: null, onSelect: vi.fn(), onCreatePoint: vi.fn(), onConnectStation: vi.fn(), onExtend: vi.fn(), onSegmentPoint: vi.fn(), onPreview: vi.fn(), onDragCommit: vi.fn(), view: { x: 0, y: 0, width: 920, height: 680 }, setView: vi.fn() }

describe('direct manipulation gestures', () => {
  it('enters line drawing only on an intentional release of the separate +, never on press or drag', () => {
    const project = structuredClone(demoProject)
    const onExtend = vi.fn(), onSelect = vi.fn(), onDragCommit = vi.fn()
    const station = project.stations.find(item => item.id === 's2')!
    const { container } = render(<NetworkCanvas {...baseProps} project={project}
      selection={{ type: 'station', id: station.id }} onExtend={onExtend} onSelect={onSelect} onDragCommit={onDragCommit} />)
    const plus = container.querySelector('[data-station-extend-id="s2"]')!
    const position = plus.getAttribute('transform')!
    expect(position).toContain('translate(')
    const [px, py] = position.slice('translate('.length, -1).split(' ').map(Number)
    const stationHit = container.querySelector('[data-layer="stations"] [data-station-id="s2"]')!
    const stationHitRadius = Number(container.querySelector('.station-extend-hit')?.getAttribute('r'))
    expect(Math.hypot(px - station.x, py - station.y)).toBeGreaterThan(stationHitRadius * 2)

    fireEvent.pointerDown(plus, { pointerId: 81, clientX: px, clientY: py, bubbles: true })
    expect(onExtend).not.toHaveBeenCalled()
    fireEvent.pointerMove(plus, { pointerId: 81, clientX: px + 38, clientY: py + 20, bubbles: true })
    fireEvent.pointerUp(plus, { pointerId: 81, clientX: px + 38, clientY: py + 20, bubbles: true })
    expect(onExtend).not.toHaveBeenCalled()

    fireEvent.pointerDown(stationHit, { pointerId: 82, clientX: station.x, clientY: station.y, bubbles: true })
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}),
    })
    fireEvent.pointerMove(svg, { pointerId: 82, clientX: station.x + 42, clientY: station.y + 27, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 82, clientX: station.x + 42, clientY: station.y + 27, bubbles: true })
    expect(onExtend).not.toHaveBeenCalled()
    expect(onDragCommit).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith({ type: 'station', id: station.id })

    fireEvent.pointerDown(plus, { pointerId: 83, clientX: px, clientY: py, bubbles: true })
    expect(onExtend).not.toHaveBeenCalled()
    fireEvent.pointerUp(plus, { pointerId: 83, clientX: px + 1, clientY: py + 1, bubbles: true })
    expect(onExtend).toHaveBeenCalledTimes(1)
    expect(onExtend).toHaveBeenCalledWith(station.id)
  })

  it('ignores cancelled and distant + presses but remains keyboard-operable', () => {
    const onExtend = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={demoProject}
      selection={{ type: 'station', id: 's4' }} onExtend={onExtend} />)
    const plus = container.querySelector('[data-station-extend-id="s4"]')!
    fireEvent.pointerDown(plus, { pointerId: 88, clientX: 100, clientY: 100, bubbles: true })
    fireEvent.pointerCancel(plus, { pointerId: 88, bubbles: true })
    fireEvent.pointerUp(plus, { pointerId: 88, clientX: 100, clientY: 100, bubbles: true })
    fireEvent.pointerDown(plus, { pointerId: 89, clientX: 100, clientY: 100, bubbles: true })
    fireEvent.pointerUp(plus, { pointerId: 89, clientX: 121, clientY: 101, bubbles: true })
    expect(onExtend).not.toHaveBeenCalled()
    fireEvent.keyDown(plus, { key: 'Enter', bubbles: true })
    expect(onExtend).toHaveBeenCalledTimes(1)
  })

  it('adds endpoint control points immediately and commits them when a point switches to Station',()=>{
    const project=structuredClone(demoProject),onCreatePoint=vi.fn(),onFinishDrawing=vi.fn(),onDragCommit=vi.fn()
    const {container}=render(<NetworkCanvas {...baseProps} project={project} onCreatePoint={onCreatePoint} onFinishDrawing={onFinishDrawing} onDragCommit={onDragCommit} drawing={{kind:'line' as const,lineId:'line-a',anchorStationId:'s4',phaseId:undefined}}/>)
    const firstPlus=container.querySelector('[data-line-draft-add="true"]')!
    fireEvent.pointerDown(firstPlus,{pointerId:31,bubbles:true})
    expect(container.querySelectorAll('[data-draft-point-id]')).toHaveLength(1)
    const secondPlus=container.querySelector('[data-line-draft-add="true"]')!
    fireEvent.pointerDown(secondPlus,{pointerId:32,bubbles:true})
    expect(container.querySelectorAll('[data-draft-point-id]')).toHaveLength(2)
    expect(onCreatePoint).not.toHaveBeenCalled();expect(onFinishDrawing).not.toHaveBeenCalled();expect(onDragCommit).not.toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByText('切换为站点').parentElement!,{pointerId:33,bubbles:true})
    expect(onDragCommit).toHaveBeenCalledTimes(1)
    const next=onDragCommit.mock.calls[0][1] as typeof project
    expect(next.stations).toHaveLength(project.stations.length+1)
    expect(next.geometry.segments).toHaveLength(project.geometry.segments.length+1)
    const added=next.geometry.segments.find(item=>!project.geometry.segments.some(before=>before.id===item.id))!
    expect(added.fromStationId).toBe('s4')
    expect(added.waypoints).toHaveLength(1)
  })
  it('shows lightweight selectable handles for the actual corners of a selected rounded Segment',()=>{
    const project=structuredClone(demoProject),segment=project.geometry.segments.find(item=>item.id==='a-1')!,onSelect=vi.fn()
    segment.mode='rounded';segment.waypoints=[{id:'corner-a',x:270,y:350,type:'corner',cornerRadius:20},{id:'corner-b',x:330,y:420,type:'corner',cornerRadius:70}]
    const {container}=render(<NetworkCanvas {...baseProps} project={project} selection={{type:'segment',id:segment.id}} onSelect={onSelect}/>)
    const handles=[...container.querySelectorAll('[data-corner-handle="true"]')]
    expect(handles.map(handle=>handle.getAttribute('data-waypoint-id'))).toEqual(['corner-a','corner-b'])
    expect(Number(container.querySelector('.waypoint-hit')?.getAttribute('r'))).toBeGreaterThanOrEqual(20)
    fireEvent.pointerDown(handles[0],{pointerId:13,clientX:270,clientY:350,bubbles:true})
    expect(onSelect).toHaveBeenCalledWith({type:'waypoint',id:'corner-a',segmentId:segment.id})
  })
  it('uses sparse explicit line width overrides and ignores legacy line fields',()=>{
    const project=structuredClone(demoProject);project.settings.lineWidth=30;project.lines.forEach((line,index)=>{line.lineWidth=8+index});project.lines[0].styleOverrides={lineWidth:44}
    const {container}=render(<NetworkCanvas {...baseProps} project={project}/>)
    const widths=[...container.querySelectorAll('.segment-main')].map(path=>path.getAttribute('stroke-width'))
    expect(widths).toContain('44');expect(widths).toContain('30');expect(widths).not.toContain('8')
  })
  it('strokes adjacent AARC station segments as one continuous capped path while keeping each hit target', () => {
    const project = structuredClone(demoProject)
    const line = project.lines.find(item => item.id === 'line-a')!
    line.source = { format: 'aarc', lineId: 1, sourceLineId: 1, raw: { cap: 'square' } }
    const segments = project.geometry.segments.filter(segment => segment.lineId === line.id)
    segments.forEach((segment, index) => {
      segment.source = { format: 'aarc', lineId: 1, sourceLineId: 1, pointIds: [index + 1, index + 2], raw: { sourceSegmentIndex: index } }
      segment.mode = 'straight'; segment.waypoints = []; segment.structureType = 'underground'; segment.structureNodes = []
    })
    const { container } = render(<NetworkCanvas {...baseProps} project={project} />)
    const group = container.querySelector('[data-aarc-continuous-line="line-a"]')!
    expect(group.querySelectorAll('.segment-main')).toHaveLength(1)
    expect(group.querySelector('.segment-main')).toHaveAttribute('stroke-linecap', 'square')
    expect(group.querySelectorAll('.segment-hit')).toHaveLength(segments.length)
  })

  it('selects and drags imported AARC line labels through the unified lineLabel selection', () => {
    const project=structuredClone(demoProject),line=project.lines.find(item=>item.id==='line-a')!
    project.textTags=[{id:'aarc-line-label',kind:'LineNameLabel',x:200,y:150,lineId:line.id,padding:1,source:{format:'aarc',kind:'text-tag',forId:1,targetKind:'line'}}]
    project.aarc={format:'aarc',raw:{lines:[{id:1,name:line.name,color:line.color,pts:[]}]}}
    const onSelect=vi.fn(),onDragCommit=vi.fn()
    const {container}=render(<NetworkCanvas {...baseProps} project={project} onSelect={onSelect} onDragCommit={onDragCommit}/>)
    const svg=container.querySelector('svg')!;vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:920,bottom:680,width:920,height:680,toJSON:()=>({})})
    const label=container.querySelector('[data-line-label-id="aarc-line-label"]')!
    fireEvent.pointerDown(label,{pointerId:19,clientX:200,clientY:150,bubbles:true})
    fireEvent.pointerMove(svg,{pointerId:19,clientX:240,clientY:175,bubbles:true})
    fireEvent.pointerUp(svg,{pointerId:19,clientX:240,clientY:175,bubbles:true})
    expect(onSelect).toHaveBeenCalledWith({type:'lineLabel',id:'aarc-line-label',lineId:'line-a',source:'aarc'})
    expect(onDragCommit).toHaveBeenCalledTimes(1)
    expect(onDragCommit.mock.calls[0][1].textTags[0]).toMatchObject({x:240,y:175})
  })


  it.each([
    { kind: 'FreeMapText' as const, id: 'unbound-text', text: '孤立地图文字' },
    { kind: 'TerrainNameLabel' as const, id: 'terrain-text', text: '狸岩区' },
    { kind: 'MapIcon' as const, id: 'map-icon', text: undefined },
  ])('directly selects and drags imported AARC $kind without changing siblings or original data', ({ kind, id, text }) => {
    const project = structuredClone(demoProject)
    project.aarc = {
      format: 'aarc',
      raw: { lines: [{ id: 87, type: 1, name: '狸岩区', nameSub: 'Liyan District', color: '#777777' }] },
    }
    project.textTags = [
      {
        id, kind, x: 600, y: 450,
        ...(text ? { text, textOverride: text } : {}),
        ...(kind === 'TerrainNameLabel' ? { source: { format: 'aarc' as const, kind: 'text-tag' as const, forId: 87, targetKind: 'terrain' as const } } : {}),
        ...(kind === 'MapIcon' ? { iconId: 'sample-icon' } : {}),
      },
      { id: 'unchanged', kind: 'FreeMapText', x: 100, y: 90, text: '不应移动' },
    ]
    const onSelect = vi.fn(), onDragCommit = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={project} onSelect={onSelect} onDragCommit={onDragCommit} />)
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const tag = container.querySelector(`[data-aarc-text-tag-id="${id}"]`)!
    expect(tag.querySelector('[data-editor="true"]')).not.toBeNull()
    fireEvent.pointerDown(tag, { pointerId: 77, clientX: 600, clientY: 450, bubbles: true })
    expect(onSelect).toHaveBeenCalledWith({ type: 'aarcTextTag', id })
    fireEvent.pointerMove(svg, { pointerId: 77, clientX: 650, clientY: 470, bubbles: true })
    expect(container.querySelectorAll(`[data-aarc-text-tag-id="${id}"]`)).toHaveLength(1)
    fireEvent.pointerUp(svg, { pointerId: 77, clientX: 650, clientY: 470, bubbles: true })
    expect(onDragCommit).toHaveBeenCalledTimes(1)
    const changed = onDragCommit.mock.calls[0][1]
    expect(changed.textTags.find((tag: { id: string }) => tag.id === id)).toMatchObject({ x: 650, y: 470 })
    expect(changed.textTags.find((tag: { id: string }) => tag.id === 'unchanged')).toMatchObject({ x: 100, y: 90 })
    expect(project.textTags[0]).toMatchObject({ x: 600, y: 450 })
  })

  it('shows selected marker for imported independent text and does not commit on click only', () => {
    const project = structuredClone(demoProject)
    project.textTags = [{ id: 'text-only', kind: 'FreeMapText', x: 300, y: 180, text: '测试文字' }]
    const onSelect = vi.fn(), onDragCommit = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={project} selection={{ type: 'aarcTextTag', id: 'text-only' }} onSelect={onSelect} onDragCommit={onDragCommit} />)
    const svg = container.querySelector('svg')!
    const tag = container.querySelector('[data-aarc-text-tag-id="text-only"]')!
    expect(tag.classList.contains('selected')).toBe(true)
    expect(tag.querySelector('circle[data-editor="true"]')).not.toBeNull()
    fireEvent.pointerDown(tag, { pointerId: 81, clientX: 300, clientY: 180, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 81, clientX: 300, clientY: 180, bubbles: true })
    expect(onSelect).toHaveBeenCalledWith({ type: 'aarcTextTag', id: 'text-only' })
    expect(onDragCommit).not.toHaveBeenCalled()
  })

  it('selects and drags an AARC fake-only station marker without deleting its line point', () => {
    const project=structuredClone(demoProject),onSelect=vi.fn(),onDragCommit=vi.fn()
    project.aarc={format:'aarc',raw:{
      lines:[{id:901,isFake:true,type:0,color:'#397b79',pts:[771,772]}],
      points:[{id:771,pos:[550,380],sta:1,name:'伪线站点'},{id:772,pos:[670,380],sta:0}],
    }}
    const {container}=render(<NetworkCanvas {...baseProps} project={project} onSelect={onSelect} onDragCommit={onDragCommit}/>)
    const svg=container.querySelector('svg')!
    vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:920,bottom:680,width:920,height:680,toJSON:()=>({})})
    const hit=container.querySelector('[data-aarc-fake-station-hit="771"] circle')!
    fireEvent.pointerDown(hit,{pointerId:151,clientX:550,clientY:380,bubbles:true})
    expect(onSelect).toHaveBeenCalledWith({type:'aarcFakeStation',id:'771'})
    fireEvent.pointerMove(svg,{pointerId:151,clientX:585,clientY:395,bubbles:true})
    fireEvent.pointerUp(svg,{pointerId:151,clientX:585,clientY:395,bubbles:true})
    expect(onDragCommit).toHaveBeenCalledTimes(1)
    const raw=onDragCommit.mock.calls[0][1].aarc.raw
    expect(raw.points[0].pos).toEqual([585,395])
    expect(raw.lines[0].pts).toEqual([771,772])
    expect((project.aarc?.raw?.points as Array<{pos:number[]}>)[0].pos).toEqual([550,380])
  })

  it('selects, previews and drags sunken AARC text instead of leaving it unclickable', () => {
    const project=structuredClone(demoProject),onSelect=vi.fn(),onDragCommit=vi.fn()
    project.textTags=[{id:'sunken-zone',kind:'FreeMapText',x:450,y:260,sunken:true,text:'下沉地名'}]
    const {container}=render(<NetworkCanvas {...baseProps} project={project} onSelect={onSelect} onDragCommit={onDragCommit}/>)
    const svg=container.querySelector('svg')!
    vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:920,bottom:680,width:920,height:680,toJSON:()=>({})})
    const tag=container.querySelector('[data-aarc-text-tag-layer="sunken"] [data-aarc-text-tag-id="sunken-zone"]')!
    const hit=tag.querySelector('[data-editor="true"]')!
    fireEvent.pointerDown(hit,{pointerId:152,clientX:450,clientY:260,bubbles:true})
    expect(onSelect).toHaveBeenCalledWith({type:'aarcTextTag',id:'sunken-zone'})
    fireEvent.pointerMove(svg,{pointerId:152,clientX:475,clientY:270,bubbles:true})
    expect(container.querySelectorAll('[data-aarc-text-tag-id="sunken-zone"]')).toHaveLength(1)
    fireEvent.pointerUp(svg,{pointerId:152,clientX:475,clientY:270,bubbles:true})
    expect(onDragCommit).toHaveBeenCalledTimes(1)
    expect(onDragCommit.mock.calls[0][1].textTags[0]).toMatchObject({x:475,y:270})
  })

  it('selects and moves isolated AARC fake terrain artwork while preserving the raw line record', () => {
    const project=structuredClone(demoProject),onSelect=vi.fn(),onDragCommit=vi.fn()
    project.aarc={format:'aarc',raw:{
      lines:[{id:902,isFake:true,type:1,color:'#81a476',pts:[773,774]}],
      points:[{id:773,pos:[550,430],sta:0},{id:774,pos:[670,430],sta:0}],
    }}
    const {container}=render(<NetworkCanvas {...baseProps} project={project} onSelect={onSelect} onDragCommit={onDragCommit}/>)
    const svg=container.querySelector('svg')!
    vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:920,bottom:680,width:920,height:680,toJSON:()=>({})})
    const hit=container.querySelector('[data-aarc-fake-terrain-hit="902"]')!
    fireEvent.pointerDown(hit,{pointerId:153,clientX:600,clientY:430,bubbles:true})
    expect(onSelect).toHaveBeenCalledWith({type:'aarcFakeTerrain',id:'902'})
    fireEvent.pointerMove(svg,{pointerId:153,clientX:620,clientY:442,bubbles:true})
    fireEvent.pointerUp(svg,{pointerId:153,clientX:620,clientY:442,bubbles:true})
    expect(onDragCommit).toHaveBeenCalledTimes(1)
    const raw=onDragCommit.mock.calls[0][1].aarc.raw
    expect(raw.points.map((point:{pos:number[]})=>point.pos)).toEqual([[570,442],[690,442]])
    expect(raw.lines[0].pts).toEqual([773,774])
  })

  it('clicks a visual AARC point link and exposes the ordinary object inspector selection',()=>{
    const project=structuredClone(demoProject),onSelect=vi.fn()
    project.aarc={format:'aarc',pointLinks:[{pts:[981,982],type:1}],raw:{
      lines:[],points:[{id:981,pos:[600,530],sta:1},{id:982,pos:[700,530],sta:1}],
      pointLinks:[{pts:[981,982],type:1}],
    }}
    const {container}=render(<NetworkCanvas {...baseProps} project={project} onSelect={onSelect}/>)
    const hit=container.querySelector('[data-aarc-point-link-hit="aarc-point-link-0"]')!
    fireEvent.pointerDown(hit,{pointerId:154,clientX:650,clientY:530,bubbles:true})
    expect(onSelect).toHaveBeenCalledWith({type:'aarcPointLink',id:'aarc-point-link-0'})
  })

  it('keeps station markers and labels visible when a native line is switched to fake', () => {
    const project = structuredClone(demoProject)
    project.lines.find(line => line.id === 'line-a')!.isFake = true
    project.timeline.currentDate = '2005-01-01'
    const { container } = render(<NetworkCanvas {...baseProps} project={project} />)
    expect(container.querySelectorAll('[data-layer="stations"] [data-station-id]')).toHaveLength(4)
    const labels = [...container.querySelectorAll('[data-layer="station-labels"] .station-label')].map(node => node.textContent)
    expect(labels).toEqual(expect.arrayContaining(['云港', '市民广场', '青塔', '临江']))
    expect(container.querySelectorAll('[data-layer="segments"] .segment-main').length).toBeGreaterThan(0)
  })

  it('drags a station directly and commits the whole drag once', () => {
    const onPreview = vi.fn(), onDragCommit = vi.fn(), setView = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={demoProject} onPreview={onPreview} onDragCommit={onDragCommit} setView={setView} />)
    const svg = container.querySelector('svg')!
    Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 920 })
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const stationGroup = screen.getByTestId('transfer-s2').closest('.station-hit')!
    const original = demoProject.stations.find(station => station.id === 's2')!
    fireEvent.pointerDown(stationGroup, { pointerId: 7, clientX: original.x, clientY: original.y, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 7, clientX: original.x + 80, clientY: original.y + 35, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 7, clientX: original.x + 80, clientY: original.y + 35, bubbles: true })
    expect(onDragCommit).toHaveBeenCalledTimes(1)
    const moved = onDragCommit.mock.calls[0][1]
    const movedStation = moved.stations.find((station: { id: string }) => station.id === 's2')
    expect(movedStation.x).toBeCloseTo(original.x + 80)
    expect(movedStation.y).toBeCloseTo(original.y + 35)
    expect(getSegmentPath(moved, moved.geometry.segments.find((segment: { id: string }) => segment.id === 'a-1')!)).toContain(`${original.x + 80} ${original.y + 35}`)
  })


  it('optionally snaps a dragged Station to AARC-style neighbor rays and shows guides', () => {
    const onDragCommit = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={demoProject} snapOptions={{ node: false, neighbor: true, grid: false }} onDragCommit={onDragCommit} />)
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const station = screen.getByTestId('transfer-s2').closest('.station-hit')!
    fireEvent.pointerDown(station, { pointerId: 51, clientX: 390, clientY: 350, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 51, clientX: 392, clientY: 132, bubbles: true })
    expect(container.querySelectorAll('[data-layer="alignment-guides"] line').length).toBeGreaterThanOrEqual(1)
    fireEvent.pointerUp(svg, { pointerId: 51, clientX: 392, clientY: 132, bubbles: true })
    const moved = onDragCommit.mock.calls[0][1].stations.find((item: { id: string }) => item.id === 's2')
    expect(moved.x).toBeCloseTo(390)
    expect(container.querySelector('[data-layer="alignment-guides"]')).toBeNull()
  })

  it('snaps directly to a nearby node when node snapping is enabled', () => {
    const onDragCommit = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={demoProject} snapOptions={{ node: true, neighbor: false, grid: false }} onDragCommit={onDragCommit} />)
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const station = screen.getByTestId('transfer-s2').closest('.station-hit')!
    fireEvent.pointerDown(station, { pointerId: 53, clientX: 390, clientY: 350, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 53, clientX: 392, clientY: 132, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 53, clientX: 392, clientY: 132, bubbles: true })
    const moved = onDragCommit.mock.calls[0][1].stations.find((item: { id: string }) => item.id === 's2')
    expect(moved.x).toBe(390)
    expect(moved.y).toBe(130)
  })

  it('bypasses all editor snapping while Alt is held', () => {
    const onDragCommit = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={demoProject} snapOptions={{ node: true, neighbor: true, grid: true }} onDragCommit={onDragCommit} />)
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const station = screen.getByTestId('transfer-s2').closest('.station-hit')!
    fireEvent.pointerDown(station, { pointerId: 52, clientX: 390, clientY: 350, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 52, clientX: 392, clientY: 132, altKey: true, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 52, clientX: 392, clientY: 132, altKey: true, bubbles: true })
    const moved = onDragCommit.mock.calls[0][1].stations.find((item: { id: string }) => item.id === 's2')
    expect(moved.x).toBeCloseTo(392)
    expect(moved.y).toBeCloseTo(132)
  })

  it('pans from canvas background without starting an object drag', () => {
    const setView = vi.fn(), onDragCommit = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={demoProject} setView={setView} onDragCommit={onDragCommit} />)
    const svg = container.querySelector('svg')!
    Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 920 })
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const background = container.querySelector('.canvas-bg')!
    const viewport = container.querySelector('[data-layer="camera-viewport"]')!
    fireEvent.pointerDown(background, { pointerId: 8, clientX: 100, clientY: 100, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 8, clientX: 140, clientY: 120, bubbles: true })
    expect(svg.getAttribute('viewBox')).toBe('0 0 920 680')
    expect(viewport.getAttribute('transform')).toMatch(/^matrix\(/)
    expect(setView).not.toHaveBeenCalled()
    fireEvent.pointerUp(svg, { pointerId: 8, clientX: 140, clientY: 120, bubbles: true })
    expect(setView).toHaveBeenCalledTimes(1)
    expect(onDragCommit).not.toHaveBeenCalled()
  })

  it('applies each small wheel zoom immediately and commits React view only after wheel idle', () => {
    vi.useFakeTimers()
    try {
      const setView = vi.fn()
      const { container } = render(<NetworkCanvas {...baseProps} project={demoProject} setView={setView} />)
      const svg = container.querySelector('svg')!
      Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 920 })
      vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
      const viewport = container.querySelector('[data-layer="camera-viewport"]')!
      fireEvent.wheel(svg, { clientX: 460, clientY: 340, deltaY: -100, bubbles: true })
      expect(svg.getAttribute('viewBox')).toBe('0 0 920 680')
      const firstTransform = viewport.getAttribute('transform')
      expect(firstTransform).toMatch(/^matrix\(/)
      expect(setView).not.toHaveBeenCalled()
      vi.advanceTimersByTime(50)
      expect(viewport.getAttribute('transform')).toBe(firstTransform)
      fireEvent.wheel(svg, { clientX: 460, clientY: 340, deltaY: -100, bubbles: true })
      const secondTransform = viewport.getAttribute('transform')
      expect(secondTransform).toMatch(/^matrix\(/)
      expect(secondTransform).not.toBe(firstTransform)
      vi.advanceTimersByTime(99)
      expect(setView).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(setView).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses wheel delta magnitude instead of fixed zoom steps', () => {
    vi.useFakeTimers()
    try {
      const renderCommittedWidth = (deltaY: number) => {
        const setView = vi.fn()
        const { container, unmount } = render(<NetworkCanvas {...baseProps} project={demoProject} setView={setView} />)
        const svg = container.querySelector('svg')!
        Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 920 })
        vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
        fireEvent.wheel(svg, { clientX: 460, clientY: 340, deltaY, bubbles: true })
        vi.advanceTimersByTime(100)
        const width = setView.mock.calls.at(-1)?.[0].width as number
        unmount()
        return width
      }
      const gentle = renderCommittedWidth(-10)
      const strong = renderCommittedWidth(-100)
      expect(920 - gentle).toBeGreaterThan(0)
      expect(920 - strong).toBeGreaterThan(920 - gentle)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels an object drag and switches safely to pinch when a second pointer arrives', () => {
    const onPreview = vi.fn(), onDragCommit = vi.fn(), setView = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={demoProject} onPreview={onPreview} onDragCommit={onDragCommit} setView={setView} />)
    const svg = container.querySelector('svg')!
    Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 920 })
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const original = demoProject.stations.find(station => station.id === 's2')!
    const stationHit = screen.getByTestId('transfer-s2').closest('.station-hit')!
    fireEvent.pointerDown(stationHit, { pointerId: 21, clientX: original.x, clientY: original.y, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 21, clientX: original.x + 30, clientY: original.y, bubbles: true })
    fireEvent.pointerDown(svg, { pointerId: 22, clientX: original.x + 70, clientY: original.y + 40, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 22, clientX: original.x + 150, clientY: original.y + 40, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 22, clientX: original.x + 150, clientY: original.y + 40, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 21, clientX: original.x + 30, clientY: original.y + 40, bubbles: true })
    expect(onDragCommit).not.toHaveBeenCalled()
    expect(setView).toHaveBeenCalled()
    expect(onPreview).not.toHaveBeenCalled()
  })

  it('snaps a rotated bilingual label to the nearest direction without moving its Station',()=>{
    const project=structuredClone(demoProject),station=project.stations.find(item=>item.id==='s4')!;station.nameS='Linjiang';station.labelRotation=45
    const onDragCommit=vi.fn(),{container}=render(<NetworkCanvas {...baseProps} project={project} onDragCommit={onDragCommit}/>)
    const svg=container.querySelector('svg')!;Object.defineProperty(svg,'clientWidth',{configurable:true,value:920});vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:920,bottom:680,width:920,height:680,toJSON:()=>({})})
    const label=container.querySelector('[data-label-rotation="45"]')!;fireEvent.pointerDown(label,{pointerId:12,clientX:station.x+station.labelOffsetX,clientY:station.y+station.labelOffsetY,bubbles:true});fireEvent.pointerMove(svg,{pointerId:12,clientX:station.x+station.labelOffsetX+30,clientY:station.y+station.labelOffsetY+20,bubbles:true});fireEvent.pointerUp(svg,{pointerId:12,clientX:0,clientY:0,bubbles:true});const moved=onDragCommit.mock.calls[0][1].stations.find((item:{id:string})=>item.id==='s4');expect(moved.x).toBe(station.x);expect(moved.y).toBe(station.y);expect(moved.labelOffsetX).toBeCloseTo(Math.hypot(station.labelOffsetX+30,station.labelOffsetY+20));expect(moved.labelOffsetY).toBe(0);expect(moved.labelRotation).toBe(45)
  })
  it('keeps dragged label preview local to the canvas instead of replacing App history',()=>{
    const project=structuredClone(demoProject),station=project.stations.find(item=>item.id==='s4')!,onPreview=vi.fn(),onDragCommit=vi.fn()
    const {container}=render(<NetworkCanvas {...baseProps} project={project} onPreview={onPreview} onDragCommit={onDragCommit}/>),svg=container.querySelector('svg')!
    vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:920,bottom:680,width:920,height:680,toJSON:()=>({})})
    const label=container.querySelector(`[data-label-anchor-x="${station.x+station.labelOffsetX}"]`)!;fireEvent.pointerDown(label,{pointerId:15,clientX:station.x+station.labelOffsetX,clientY:station.y+station.labelOffsetY,bubbles:true});fireEvent.pointerMove(svg,{pointerId:15,clientX:station.x+5,clientY:station.y-100,bubbles:true})
    const previewLabel=container.querySelector(`[data-label-anchor-x="${station.x}"]`)
    expect(onPreview).not.toHaveBeenCalled();expect(previewLabel).toHaveAttribute('data-label-horizontal-anchor','middle');expect(previewLabel).toHaveAttribute('data-label-vertical-anchor','above')
    fireEvent.pointerUp(svg,{pointerId:15,clientX:station.x+5,clientY:station.y-100,bubbles:true});expect(onDragCommit).toHaveBeenCalledTimes(1)
  })
  it('selects and freely drags one Line-owned badge without moving its siblings',()=>{
    const project=structuredClone(demoProject),line=project.lines.find(item=>item.id==='line-a')!,onSelect=vi.fn(),onDragCommit=vi.fn()
    line.lineBadges=[{id:'badge-a',x:200,y:150,size:42,rotation:0,visible:true},{id:'badge-b',x:350,y:250,size:42,rotation:0,visible:true}]
    const {container}=render(<NetworkCanvas {...baseProps} project={project} onSelect={onSelect} onDragCommit={onDragCommit}/>)
    const svg=container.querySelector('svg')!;vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:920,bottom:680,width:920,height:680,toJSON:()=>({})})
    const badge=container.querySelector('[data-line-badge-id="badge-a"]')!
    fireEvent.pointerDown(badge,{pointerId:14,clientX:200,clientY:150,bubbles:true});fireEvent.pointerMove(svg,{pointerId:14,clientX:275,clientY:185,bubbles:true});fireEvent.pointerUp(svg,{pointerId:14,clientX:275,clientY:185,bubbles:true})
    expect(onSelect).toHaveBeenCalledWith({type:'lineLabel',id:'badge-a',lineId:'line-a',source:'native'});expect(onDragCommit).toHaveBeenCalledTimes(1)
    const nextLine=onDragCommit.mock.calls[0][1].lines.find((item:{id:string})=>item.id==='line-a');expect(nextLine.lineBadges.find((item:{id:string})=>item.id==='badge-a')).toMatchObject({x:275,y:185});expect(nextLine.lineBadges.find((item:{id:string})=>item.id==='badge-b')).toMatchObject({x:350,y:250})
  })
  it('drags an independent Structure Node along its Segment with pointer capture', () => {
    const project=structuredClone(demoProject),segment=project.geometry.segments.find(item=>item.id==='a-1')!
    segment.structureNodes=[{id:'drag-node',progress:.25,structureAfter:'elevated'}]
    const onDragCommit=vi.fn(),onPreview=vi.fn()
    const {container}=render(<NetworkCanvas {...baseProps} project={project} selection={{type:'structureNode',id:'drag-node',segmentId:segment.id}} onDragCommit={onDragCommit} onPreview={onPreview} />)
    const svg=container.querySelector('svg')!
    vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:920,bottom:680,width:920,height:680,toJSON:()=>({})})
    const node=container.querySelector('[data-structure-node-id="drag-node"]')!
    fireEvent.pointerDown(node,{pointerId:9,clientX:270,clientY:440,bubbles:true})
    fireEvent.pointerMove(svg,{pointerId:9,clientX:360,clientY:370,bubbles:true})
    fireEvent.pointerUp(svg,{pointerId:9,clientX:360,clientY:370,bubbles:true})
    expect(SVGElement.prototype.setPointerCapture).toHaveBeenCalledWith(9)
    expect(onDragCommit).toHaveBeenCalledTimes(1)
    const moved=onDragCommit.mock.calls[0][1],movedNode=moved.geometry.segments.find((item:{id:string})=>item.id===segment.id).structureNodes[0]
    expect(movedNode.progress).toBeGreaterThan(.25)
    expect(moved.geometry.segments.find((item:{id:string})=>item.id===segment.id).waypoints).toEqual(segment.waypoints)
  })
  it('blocks station and waypoint geometry edits when their line is locked', () => {
    const project = structuredClone(demoProject)
    project.lines.find(line => line.id === 'line-a')!.locked = true
    const onDragCommit = vi.fn(), onPreview = vi.fn(), onSelect = vi.fn()
    const { container } = render(<NetworkCanvas {...baseProps} project={project} onDragCommit={onDragCommit} onPreview={onPreview} onSelect={onSelect} selection={{type:'segment',id:'a-1'}} />)
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 920, bottom: 680, width: 920, height: 680, toJSON: () => ({}) })
    const station = container.querySelector('[data-station-id="s1"]')!
    fireEvent.pointerDown(station, { pointerId: 41, clientX: 180, clientY: 450, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 41, clientX: 240, clientY: 480, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 41, clientX: 240, clientY: 480, bubbles: true })
    expect(onDragCommit).not.toHaveBeenCalled()
    const waypoint = container.querySelector('[data-waypoint-id="w1"]')!
    fireEvent.pointerDown(waypoint, { pointerId: 42, clientX: 300, clientY: 455, bubbles: true })
    fireEvent.pointerMove(svg, { pointerId: 42, clientX: 360, clientY: 490, bubbles: true })
    fireEvent.pointerUp(svg, { pointerId: 42, clientX: 360,clientY:490,bubbles:true })
    expect(onDragCommit).not.toHaveBeenCalled()
    expect(onPreview).not.toHaveBeenCalled()
  })})