import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Station } from '../data/model'
import { DEFAULT_SETTINGS } from '../data/model'
import { StationLabel } from './StationLabel'
const station:Station={id:'s',name:'木阳西站',nameS:'Muyang West\nRailway Station',x:100,y:200,labelOffsetX:16,labelOffsetY:-12}
describe('StationLabel bilingual label group',()=>{
  it('renders Chinese and every preserved nameS line in one transformed group',()=>{const {container}=render(<svg><StationLabel station={station} settings={DEFAULT_SETTINGS} showForeign/></svg>),group=container.querySelector('.station-label-group')!,lines=[...group.querySelectorAll('tspan')];expect(lines.map(line=>line.textContent)).toEqual(['木阳西站','Muyang West','Railway Station']);expect(group).toHaveAttribute('transform','translate(116 188) rotate(0)');expect(lines.every(line=>line.getAttribute('x')==='0')).toBe(true)})
  it('resolves AARC-style right, left, up, down and diagonal anchors without changing offsets',()=>{
    const cases=[{offset:[16.2,0],h:'start',v:'middle'},{offset:[-16.2,0],h:'end',v:'middle'},{offset:[0,16.2],h:'middle',v:'below'},{offset:[0,-16.2],h:'middle',v:'above'},{offset:[11.45512,-11.45513],h:'start',v:'above'},{offset:[-11.45513,11.45512],h:'end',v:'below'},{offset:[11.45512,11.45512],h:'start',v:'below'},{offset:[-11.45513,-11.45513],h:'end',v:'above'}] as const
    for(const item of cases){const current={...station,labelOffsetX:item.offset[0],labelOffsetY:item.offset[1]},group=render(<svg><StationLabel station={current} settings={DEFAULT_SETTINGS} showForeign/></svg>).container.querySelector('.station-label-group')!;expect(group).toHaveAttribute('data-label-horizontal-anchor',item.h);expect(group).toHaveAttribute('data-label-vertical-anchor',item.v);expect(group).toHaveAttribute('data-label-anchor-x',String(station.x+item.offset[0]));expect(group).toHaveAttribute('data-label-anchor-y',String(station.y+item.offset[1]));expect(group).toHaveAttribute('data-label-rotation','0')}
  })
  it('uses independent primary/foreign sizes and configurable gap',()=>{const settings={...DEFAULT_SETTINGS,stationLabelSize:18,stationForeignLabelSize:10,foreignLabelGap:4};const {container}=render(<svg><StationLabel station={station} settings={settings} showForeign/></svg>),spans=container.querySelectorAll('tspan');expect(container.querySelector('text')).toHaveStyle({fontSize:'18px'});expect(spans[1]).toHaveStyle({fontSize:'10px'});expect(spans[1]).toHaveAttribute('y','22')})
  it('ignores legacy object-level label sizes and uses global settings',()=>{const legacy={...station,labelSize:14,foreignLabelSize:9,foreignLabelGap:1},settings={...DEFAULT_SETTINGS,stationLabelSize:30,stationForeignLabelSize:20,foreignLabelGap:5};const {container}=render(<svg><StationLabel station={legacy} settings={settings} showForeign/></svg>),spans=container.querySelectorAll('tspan');expect(container.querySelector('text')).toHaveStyle({fontSize:'30px'});expect(spans[1]).toHaveStyle({fontSize:'20px'});expect(spans[1]).toHaveAttribute('y','35')})
  it('rotates the whole label group around its unchanged anchor',()=>{const settings={...DEFAULT_SETTINGS,defaultStationLabelRotation:-45};const inherited=render(<svg><StationLabel station={station} settings={settings} showForeign/></svg>).container.querySelector('.station-label-group')!;expect(inherited).toHaveAttribute('transform','translate(116 188) rotate(-45)');const overridden=render(<svg><StationLabel station={{...station,labelRotation:45}} settings={settings} showForeign/></svg>).container.querySelector('.station-label-group')!;expect(overridden).toHaveAttribute('transform','translate(116 188) rotate(45)')})
  it('occupies no secondary line when nameS is hidden or empty',()=>{expect(render(<svg><StationLabel station={station} settings={DEFAULT_SETTINGS} showForeign={false}/></svg>).container.querySelectorAll('.station-label-foreign')).toHaveLength(0);expect(render(<svg><StationLabel station={{...station,nameS:undefined}} settings={DEFAULT_SETTINGS} showForeign/></svg>).container.querySelectorAll('.station-label-foreign')).toHaveLength(0)})
  it('lays out imported AARC labels as one anchored block, including multiline nameS',()=>{
    const aarc={...station,source:{format:'aarc' as const,pointId:57,nameP:[0,16.2] as [number,number],labelAnchorMode:'aarc-block' as const,stationNameFontWeight:'bold' as const},labelOffsetX:0,labelOffsetY:16.2}
    const {container}=render(<svg><StationLabel station={aarc} settings={{...DEFAULT_SETTINGS,stationLabelSize:30.68,stationLabelFontFamily:'sans-serif',stationLabelFontWeight:700,stationForeignLabelSize:23.38,stationForeignLabelFontFamily:'sans-serif',stationForeignLabelFontWeight:700,stationForeignLabelColor:'#999999',foreignLabelGap:3.08}} showForeign/></svg>)
    const group=container.querySelector('.station-label-group')!,block=container.querySelector('.station-label-block')!,texts=[...container.querySelectorAll('text')]
    expect(group).toHaveAttribute('data-label-horizontal-anchor','middle')
    expect(group).toHaveAttribute('data-label-vertical-anchor','top')
    expect(block.getAttribute('transform')).toBe('translate(0 0.412)')
    expect(texts.map(text=>text.textContent)).toEqual(['木阳西站','Muyang West','Railway Station'])
    expect(texts.every(text=>text.getAttribute('text-anchor')==='middle')).toBe(true)
    expect(texts.every(text=>text.style.fontFamily==='sans-serif')).toBe(true)
    expect(texts.every(text=>text.style.fontWeight==='700')).toBe(true)
    expect(texts[1]).toHaveAttribute('fill','#999999')
    expect(texts[1]).not.toHaveAttribute('transform')
    expect(Number(texts[2].getAttribute('y'))).toBeGreaterThan(Number(texts[1].getAttribute('y')))
  })
})
