import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { compilePresentation, resolutionSize } from './compiler'
import { getPresentationState } from './engine'
import { PresentationScene } from './PresentationScene'

describe('presentation scene integration', () => {
  it('uses only global visual settings for legacy Build 16 objects',()=>{
    const project=structuredClone(demoProject);project.settings.lineWidth=30;project.settings.stationSize=25;project.lines.forEach(line=>{line.lineWidth=7});project.stations.forEach(station=>{station.stationSize=4})
    const sequence=compilePresentation(project),time=sequence.events[0].revealStart+sequence.events[0].revealDuration
    const {container}=render(<PresentationScene project={project} sequence={sequence} time={time} width={1920} height={1080}/>)
    expect(container.querySelector('.segment-main')).toHaveAttribute('stroke-width','30')
    expect(container.querySelector('[data-testid^="station-"]')).toHaveAttribute('r','12.5')
  })
  it('renders only formal map layers and an evaluated intermediate frame', () => {
    const project=structuredClone(demoProject); project.presentation={...project.presentation,growthSpeedKmPerSecond:1.4,pauseDuration:.65,cameraMode:'fixed'}
    const sequence=compilePresentation(project); const event=sequence.events[0]; const time=event.revealStart+event.revealDuration*.45; const size=resolutionSize(project.presentation.resolution)
    const {container}=render(<PresentationScene project={project} sequence={sequence} time={time} width={size.width} height={size.height}/>)
    const svg=container.querySelector('svg')!; expect(svg).toHaveAttribute('data-presentation-time',time.toFixed(3)); expect(svg.querySelector('[data-presentation-layer="segments"]')).toBeTruthy(); expect(svg.querySelector('[data-presentation-layer="stations"]')).toBeTruthy(); expect(svg.querySelector('[data-editor]')).toBeNull(); expect(svg.querySelector('.segment-hit')).toBeNull(); expect(svg.textContent).not.toContain('新建线路'); expect(svg.querySelector('.presentation-statistics')).toBeTruthy(); expect(svg.querySelector('.presentation-statistics')).toHaveAttribute('data-operating-length-km'); expect(svg.textContent).toContain('运营里程'); expect(svg.textContent).toContain('车站'); expect(svg.textContent).toContain('2000.01.01')
  })
  it('applies one identical reveal value to all three elevated artwork strokes', () => {
    const project=structuredClone(demoProject); project.geometry.segments.find(item=>item.id==='b-1')!.structureType='elevated'; const sequence=compilePresentation(project); const event=sequence.events.find(item=>item.segmentIds.includes('b-1'))!; const state=getPresentationState(project,sequence,event.revealStart+event.revealDuration*.05); expect(state.segmentStates['b-1'].revealProgress).toBeGreaterThan(0); expect(state.segmentStates['b-1'].revealProgress).toBeLessThan(1)
    const {container}=render(<PresentationScene project={project} sequence={sequence} time={event.revealStart+event.revealDuration*.05} width={1920} height={1080}/>); const paths=[...container.querySelectorAll('[data-structure-type="elevated"] [data-run-centerline]')]; expect(paths).toHaveLength(3); expect(new Set(paths.map(path=>path.getAttribute('d'))).size).toBe(1)
  })
  it('updates the formal SVG dashoffset through many monotonic intermediate DOM frames', () => {
    const project=structuredClone(demoProject); const sequence=compilePresentation(project); const beat=sequence.beats[0]
    const view=render(<PresentationScene project={project} sequence={sequence} time={beat.presentationStart} width={1920} height={1080}/>)
    const offsets:number[]=[]
    for(let frame=1;frame<=30;frame++){
      const time=beat.revealStart+beat.revealDuration*frame/30
      view.rerender(<PresentationScene project={project} sequence={sequence} time={time} width={1920} height={1080}/>)
      const group=view.container.querySelector('[data-segment-id="a-1"]')!
      offsets.push(Number(group.getAttribute('data-stroke-dashoffset')))
      expect(group.querySelector('path')).toHaveAttribute('pathLength','1000')
      expect(group.querySelector('path')).toHaveAttribute('stroke-dasharray','1000 1000')
    }
    expect(new Set(offsets).size).toBeGreaterThanOrEqual(10)
    expect(offsets.some(value=>value>0 && value<1000)).toBe(true)
    expect(offsets.every((value,index)=>index===0 || value<=offsets[index-1])).toBe(true)
    expect(view.container.querySelectorAll('[data-segment-id="a-1"] path')).toHaveLength(1)
  })
  it('evaluates transfer expansion after each joining line reaches the station', () => {
    const project=structuredClone(demoProject); const sequence=compilePresentation(project); const second=sequence.events.find(item=>item.historyDate==='2010-01-01')!,third=sequence.events.find(item=>item.historyDate==='2020-01-01')!; const two=getPresentationState(project,sequence,second.revealStart+second.revealDuration+.3).stationStates.s2; const three=getPresentationState(project,sequence,third.revealStart+third.revealDuration+.3).stationStates.s2; expect(two.lineIds).toHaveLength(2); expect(two.transferProgress).toBeGreaterThan(.5); expect(three.previousLineIds).toHaveLength(2); expect(three.lineIds).toHaveLength(3); expect(three.transferProgress).toBeGreaterThan(.5)
  })
})
