import { describe,expect,it } from 'vitest'
import { convertAarcToActualRouteProject } from '../import-export/aarc'
import { resolveAarcPointLinksArtwork } from '../import-export/aarcPointLinks'
import { sourcePointLinks, pointLinkIndex, removePointLinks, changePointLinkType,removeFakeTerrain } from './aarcRetainedObjects'
import { hitMapObjects } from './mapMarquee'
import { deleteSelectedMapObjects,moveSelectedMapObjects } from './mapBatchOperations'

const fixture=()=>convertAarcToActualRouteProject({
  lines:[{id:10,name:'运营线',color:'#dd3333',pts:[1,2]},{id:11,isFake:true,type:1,color:'#778877',pts:[3,4]}],
  points:[{id:1,pos:[0,0],sta:1,name:'甲'},{id:2,pos:[100,0],sta:1,name:'乙'},{id:3,pos:[300,0],sta:0},{id:4,pos:[370,0],sta:0}],
  pointLinks:[{pts:[1,2],type:1},{pts:[1,2],type:3},{pts:[1,2],type:4}],
  cvsSize:[500,200],config:{}
},'editable.aarc.json').project

describe('AARC retained object editing',()=>{
  it('identifies point link by renderer ID and deletes only that source link, including retained JSON',()=>{
    const original=fixture()
    expect(pointLinkIndex('aarc-point-link-1')).toBe(1)
    expect(pointLinkIndex('aarc-point-link-foo')).toBeNull()
    const result=deleteSelectedMapObjects(original,[{type:'aarcPointLink',id:'aarc-point-link-0'}])
    expect(result.changed).toBe(true)
    expect(sourcePointLinks(result.project)).toHaveLength(2)
    expect(result.project.aarc?.raw?.pointLinks).toHaveLength(2)
    expect(resolveAarcPointLinksArtwork(result.project).links.map(x=>x.type)).toEqual([3])
    expect(sourcePointLinks(original)).toHaveLength(3)
  })
  it('changes point-link appearance without affecting topological type 4 or endpoint points',()=>{
    const original=fixture(),next=structuredClone(original)
    expect(changePointLinkType(next,'aarc-point-link-0',2)).toBe(true)
    expect(resolveAarcPointLinksArtwork(next).links[0].type).toBe(2)
    expect(Number((next.aarc?.raw?.pointLinks as Array<{type:number}>)[0].type)).toBe(2)
    expect(changePointLinkType(next,'aarc-point-link-2',0)).toBe(false)
    expect(next.stations).toEqual(original.stations)
  })
  it('marquee-selects native visual link and retained fake terrain and removes only selected fake terrain',()=>{
    const original=fixture()
    expect(hitMapObjects(original,{left:35,right:65,top:-7,bottom:7}).some(x=>x.type==='aarcPointLink')).toBe(true)
    expect(hitMapObjects(original,{left:320,right:350,top:-7,bottom:7})).toContainEqual({type:'aarcFakeTerrain',id:'11'})
    const removed=deleteSelectedMapObjects(original,[{type:'aarcFakeTerrain',id:'11'}])
    expect(removed.changed).toBe(true)
    expect((removed.project.aarc?.raw?.lines as Array<{id:number}>).some(x=>x.id===11)).toBe(false)
    expect(original.aarc?.raw?.lines).toHaveLength(2)
  })
  it('refuses to translate retained objects without any mutation',()=>{
    const original=fixture()
    const result=moveSelectedMapObjects(original,[{type:'aarcPointLink',id:'aarc-point-link-0'}],5,10)
    expect(result.changed).toBe(false)
    expect(result.project).toBe(original)
  })
})
