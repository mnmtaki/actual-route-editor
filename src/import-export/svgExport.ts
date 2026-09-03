export interface ExportBounds { x:number; y:number; width:number; height:number }

const FORMAL_LAYERS='[data-layer="vector-basemap"],[data-layer="basemap-paths"],[data-layer="roads"],[data-layer="segments"],[data-layer="structure-runs"],[data-layer="stations"],[data-layer="line-badges"],[data-layer="map-elements"],[data-layer="line-legend"]'
const DEFAULT_PADDING=32

export function exportSvg(svg: SVGSVGElement, includeBackground: boolean): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.querySelectorAll('[data-editor="true"], .segment-hit, .station-hit > circle:last-child, .station-selection-ring, [data-layer="opening-phase-preview"]').forEach(node => node.remove())
  clone.querySelectorAll('.segment-selected,.selected').forEach(node => node.classList.remove('segment-selected','selected'))
  clone.querySelector('[data-layer="canvas-background"]')?.remove()
  if (!includeBackground) clone.querySelectorAll('image').forEach(node => node.remove())
  const bounds=measureCompleteContent(clone) ?? parseViewBox(svg.getAttribute('viewBox')) ?? {x:0,y:0,width:1000,height:700}
  clone.setAttribute('viewBox',`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`)
  clone.setAttribute('width',String(bounds.width))
  clone.setAttribute('height',String(bounds.height))
  clone.setAttribute('data-export-view-box',`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`)
  if(includeBackground){const background=clone.ownerDocument.createElementNS('http://www.w3.org/2000/svg','rect');background.setAttribute('class','export-background');background.setAttribute('x',String(bounds.x));background.setAttribute('y',String(bounds.y));background.setAttribute('width',String(bounds.width));background.setAttribute('height',String(bounds.height));background.setAttribute('fill','#f3f0e9');const defs=clone.querySelector('defs');defs?.after(background)??clone.prepend(background)}
  clone.removeAttribute('id')
  return new XMLSerializer().serializeToString(clone)
}

export function measureCompleteContent(svg:SVGSVGElement,padding=DEFAULT_PADDING):ExportBounds|null{
  const nodes=[...svg.querySelectorAll<SVGGraphicsElement>(FORMAL_LAYERS)].filter(node=>node.childElementCount>0)
  const candidates=nodes.length?nodes:[...svg.children].filter((node):node is SVGGraphicsElement=>node instanceof SVGElement&&!['defs','style','image'].includes(node.tagName.toLowerCase())&&!node.hasAttribute('data-editor'))
  if(!candidates.length)return null
  const mount=svg.ownerDocument.createElement('div');mount.style.cssText='position:fixed;left:-100000px;top:-100000px;visibility:hidden;pointer-events:none;overflow:visible';mount.append(svg);svg.ownerDocument.body?.append(mount)
  try{
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,measured=false,maxStroke=0
    for(const node of candidates){try{const box=node.getBBox();if(box.width<0||box.height<0||![box.x,box.y,box.width,box.height].every(Number.isFinite))continue;minX=Math.min(minX,box.x);minY=Math.min(minY,box.y);maxX=Math.max(maxX,box.x+box.width);maxY=Math.max(maxY,box.y+box.height);measured=true}catch{}}
    for(const node of svg.querySelectorAll<SVGElement>('[stroke-width]')){const value=Number(node.getAttribute('stroke-width'));if(Number.isFinite(value))maxStroke=Math.max(maxStroke,value)}
    if(!measured)return null
    const allowance=padding+maxStroke/2
    return roundBounds({x:minX-allowance,y:minY-allowance,width:maxX-minX+allowance*2,height:maxY-minY+allowance*2})
  }finally{mount.remove()}
}
function roundBounds(bounds:ExportBounds):ExportBounds{const x=Math.floor(bounds.x*1000)/1000,y=Math.floor(bounds.y*1000)/1000,maxX=Math.ceil((bounds.x+bounds.width)*1000)/1000,maxY=Math.ceil((bounds.y+bounds.height)*1000)/1000;return{x,y,width:maxX-x,height:maxY-y}}
function parseViewBox(value:string|null):ExportBounds|null{if(!value)return null;const [x,y,width,height]=value.trim().split(/[ ,]+/).map(Number);return[x,y,width,height].every(Number.isFinite)&&width>0&&height>0?{x,y,width,height}:null}
