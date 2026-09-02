export type RasterFormat='png'|'jpeg'|'webp'
export type RasterScale=1|2|4
export interface RasterPlan { format:RasterFormat; mimeType:string; extension:string; scale:RasterScale; width:number; height:number; viewBox:{x:number;y:number;width:number;height:number}; safe:boolean; error?:string }
export const MAX_RASTER_SIDE=16384
export const MAX_RASTER_PIXELS=100_000_000
const FORMAT:{[K in RasterFormat]:{mimeType:string;extension:string}}={png:{mimeType:'image/png',extension:'png'},jpeg:{mimeType:'image/jpeg',extension:'jpg'},webp:{mimeType:'image/webp',extension:'webp'}}

export function getRasterPlan(svgText:string,format:RasterFormat,scale:RasterScale):RasterPlan{
  const viewBox=parseSvgViewBox(svgText),info=FORMAT[format],width=Math.ceil(viewBox.width*scale),height=Math.ceil(viewBox.height*scale),tooLarge=width>MAX_RASTER_SIDE||height>MAX_RASTER_SIDE||width*height>MAX_RASTER_PIXELS
  return{format,...info,scale,width,height,viewBox,safe:!tooLarge,...(tooLarge?{error:'当前尺寸过大，请选择较低倍率。'}:{})}
}
export function rasterFilename(projectName:string,format:RasterFormat){return`${projectName}.${FORMAT[format].extension}`}
export async function waitForDocumentFonts(timeoutMs=1500):Promise<void>{
  const fonts=typeof document==='undefined'?undefined:document.fonts
  if(!fonts?.ready)return
  await new Promise<void>(resolve=>{let finished=false;const done=()=>{if(finished)return;finished=true;clearTimeout(timer);resolve()},timer=setTimeout(done,Math.max(0,timeoutMs));Promise.resolve(fonts.ready).then(done,done)})
}
export async function rasterizeSvg(svgText:string,format:RasterFormat,scale:RasterScale,backgroundColor='#ffffff'):Promise<{blob:Blob;plan:RasterPlan}>{
  const plan=getRasterPlan(svgText,format,scale);if(!plan.safe)throw new Error(plan.error)
  await waitForDocumentFonts()
  const source=new Blob([svgText],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(source)
  try{
    const image=new Image(),loaded=new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('无法读取 SVG 导出场景'))});image.src=url;await loaded
    const canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;const context=canvas.getContext('2d');if(!context)throw new Error('当前环境不支持图片导出')
    if(format==='jpeg'){context.fillStyle=backgroundColor;context.fillRect(0,0,plan.width,plan.height)}
    context.drawImage(image,0,0,plan.width,plan.height)
    const quality=format==='png'?undefined:.92,blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error(format==='webp'?'当前浏览器不支持 WebP 导出':'图片编码失败')),plan.mimeType,quality))
    return{blob,plan}
  }finally{URL.revokeObjectURL(url)}
}
function parseSvgViewBox(svgText:string){const match=/<svg\b[^>]*\bviewBox=["']([^"']+)["']/i.exec(svgText),values=match?.[1].trim().split(/[ ,]+/).map(Number);if(!values||values.length!==4||!values.every(Number.isFinite)||values[2]<=0||values[3]<=0)throw new Error('SVG 缺少有效的完整地图 viewBox');return{x:values[0],y:values[1],width:values[2],height:values[3]}}
