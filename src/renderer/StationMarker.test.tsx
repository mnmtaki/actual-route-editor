import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { StationMarker } from './StationMarker'

describe('station markers', () => {
  const station = demoProject.stations.find((item) => item.id === 's2')!
  const renderAt = (time: string) => render(<svg><StationMarker project={demoProject} station={station} time={time} selected={false} onPointerDown={() => {}} onLabelPointerDown={() => {}} /></svg>)
  it('renders a white ordinary marker in 2005', () => {
    const { getByTestId } = renderAt('2005-01-01')
    expect(getByTestId('station-s2')).toHaveAttribute('fill', 'white')
    expect(getByTestId('station-s2')).toHaveAttribute('r', String(demoProject.settings.stationSize / 2))
  })
  it('renders two and three colored lamps at later dates', () => {
    const twoRender = renderAt('2015-01-01')
    const two = twoRender.getByTestId('transfer-s2')
    expect(two.querySelectorAll('circle')).toHaveLength(2)
    twoRender.unmount()
    const three = renderAt('2025-01-01').getByTestId('transfer-s2')
    expect(three.querySelectorAll('circle')).toHaveLength(3)
  })
  it('treats a main line and its branch as one marker family while keeping unrelated transfer',()=>{
    const project=structuredClone(demoProject),branch={id:'line-a-branch',name:'',color:'#000000',parentLineId:'line-a',stationSequence:['s1','s2'],lineOrder:3,openedAt:'2000-01-01',visible:true,locked:false}
    project.lines.push(branch)
    project.stationLineRelations.push({id:'r-branch-s2',stationId:'s2',lineId:branch.id,openedAt:'2000-01-01'})
    const view=render(<svg><StationMarker project={project} station={project.stations.find(item=>item.id==='s2')!} time="2015-01-01" selected={false} onPointerDown={()=>{}} onLabelPointerDown={()=>{}}/></svg>)
    expect(view.getByTestId('transfer-s2').querySelectorAll('circle')).toHaveLength(2)
  })
  it('uses global station and transfer settings even when legacy object fields exist',()=>{
    const project=structuredClone(demoProject),legacy=project.stations.find(item=>item.id==='s2')!
    Object.assign(legacy,{stationSize:4,transferMinorAxis:8,transferEndPadding:1,transferDotGap:1})
    Object.assign(project.settings,{stationSize:25,transferMinorAxis:31,transferEndPadding:7,transferDotGap:4})
    const ordinary=render(<svg><StationMarker project={project} station={legacy} time="2005-01-01" selected={false} onPointerDown={()=>{}} onLabelPointerDown={()=>{}}/></svg>)
    expect(ordinary.getByTestId('station-s2')).toHaveAttribute('r','12.5');ordinary.unmount()
    const transfer=render(<svg><StationMarker project={project} station={legacy} time="2025-01-01" selected={false} onPointerDown={()=>{}} onLabelPointerDown={()=>{}}/></svg>).getByTestId('transfer-s2')
    expect(transfer.querySelector('rect')).toHaveAttribute('height','31')
    expect(transfer.querySelectorAll('circle')[0]).toHaveAttribute('r','10')
  })
})

