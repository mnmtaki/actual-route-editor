import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { exportSvg } from '../import-export/svgExport'
import { LineBadgesLayer } from './LineBadges'

function projectWith(name:string,size=50.7){const project=structuredClone(demoProject),line=project.lines[0];line.name=name;line.lineBadges=[{id:`badge-${name}`,x:120,y:80,size,rotation:17,visible:true}];return project}
function frame(project=projectWith('1'),presentation=false){const {container}=render(<svg viewBox="0 0 300 200"><LineBadgesLayer project={project} presentation={presentation}/></svg>),group=container.querySelector('[data-line-badge-id]')!,rect=group.querySelector('rect:not([data-editor])')!;return{container,group,rect}}

describe('square LineBadge renderer',()=>{
  it('uses badge.size as both width and height including decimal sizes',()=>{const {rect}=frame(projectWith('4',50.7));expect(rect).toHaveAttribute('width','50.7');expect(rect).toHaveAttribute('height','50.7');expect(rect).toHaveAttribute('x','-25.35');expect(rect).toHaveAttribute('y','-25.35')})
  it.each(['1','4','10','12','4A'])('keeps %s inside the same square outer frame',name=>{const {rect}=frame(projectWith(name,50.7));expect(rect.getAttribute('width')).toBe('50.7');expect(rect.getAttribute('height')).toBe('50.7')})
  it('shrinks long text instead of expanding the frame',()=>{const short=frame(projectWith('1')).group.querySelector('text')!,long=frame(projectWith('机场快线')).group.querySelector('text')!;expect(Number(long.getAttribute('font-size'))).toBeLessThan(Number(short.getAttribute('font-size')));expect(frame(projectWith('机场快线')).rect).toHaveAttribute('width','50.7')})
  it('serializes equal badge width and height in SVG export',()=>{const {container}=frame(projectWith('12',50.7)),text=exportSvg(container.querySelector('svg')!,false),doc=new DOMParser().parseFromString(text,'image/svg+xml'),rect=doc.querySelector('[data-line-badge-id] rect')!;expect(rect.getAttribute('width')).toBe('50.7');expect(rect.getAttribute('height')).toBe(rect.getAttribute('width'))})
  it('uses the identical square artwork in Editor and Presentation',()=>{const project=projectWith('4A',50.7),editor=frame(project,false),presentation=frame(project,true);for(const attribute of ['x','y','width','height','rx','fill','stroke','stroke-width'])expect(presentation.rect.getAttribute(attribute)).toBe(editor.rect.getAttribute(attribute));expect(presentation.group.getAttribute('transform')).toBe(editor.group.getAttribute('transform'))})
})
