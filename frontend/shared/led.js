import {paintMonoStroke,MONO_MATERIAL,monoOpacity} from './monoline.js?v=20261006-pressure-cache';
import {metallicGold,METALLIC_GOLD} from './metallic.js?v=20261006-pressure-cache';
import {paintGraphiteStroke,GRAPHITE_MATERIAL} from './graphite.js';

// Installation design units: 4600 × 2300. Output pixels: 1536 × 768.
export const MONO_LED_WIDTHS=Object.freeze([1,1.5,2,2.5,3]);
const CELL_SIZE=110;
export function monoDrawWidth(level){return MONO_LED_WIDTHS[level-1]*720/CELL_SIZE;}
// Measured inside led-scroll.png: top/side rolls and lower-left cloud stay clear.
export const SCROLL_ROWS=Object.freeze([9,10,8]);
export const SCROLL_AREA=Object.freeze({x:144,y:236,width:1248,height:374});
export const LED = Object.freeze({width:1536,height:768,count:27,size:CELL_SIZE,padding:0,
  gap:47*1536/4600,color:METALLIC_GOLD,lineWidth:2,sourceSize:720,drawLineWidth:monoDrawWidth(3),
  monoReference:'iOS 27.0 · Markup Mono line · weight 2/5',
  background:'/display/assets/led-scroll.png'});
export function cellGeometry(id){
  if(!Number.isInteger(id)||id<0||id>=LED.count)throw RangeError('Ô LED phải trong khoảng 0–26.');
  const row=id<9?0:id<19?1:2,col=id-[0,9,19][row];
  const rowWidth=SCROLL_ROWS[row]*LED.size+(SCROLL_ROWS[row]-1)*LED.gap;
  // First two rows are centered; the last is right-aligned to avoid the cloud.
  const left=row===2?SCROLL_AREA.x+SCROLL_AREA.width-rowWidth:(LED.width-rowWidth)/2;
  return {x:left+col*(LED.size+LED.gap),y:240+row*(LED.size+LED.gap),width:LED.size,height:LED.size};
}
export function paintLedVectors(ctx,data,color=metallicGold(ctx,LED.size)){
  const scale=(LED.size-LED.padding*2)/LED.sourceSize;
  if(data.version===2){
    // JSON-only rehearsal assets: smooth in source units, then scale.
    // Real v2 submissions use their saved SVG as the presentation master.
    ctx.save();ctx.translate(LED.padding,LED.padding);ctx.scale(scale,scale);
    for(const stroke of data.strokes){
      const width=(stroke.erase?6:(stroke.width??LED.lineWidth))/scale;
      if(stroke.material===GRAPHITE_MATERIAL)paintGraphiteStroke(ctx,{...stroke,width});
      else paintMonoStroke(ctx,{points:stroke.points,width,color:metallicGold(ctx,720,stroke.color),erase:stroke.erase,
        opacity:!stroke.erase&&stroke.material===MONO_MATERIAL?monoOpacity(stroke.points):1});
    }
    ctx.restore();
    return;
  }
  for(const stroke of data.strokes){
    paintMonoStroke(ctx,{points:stroke.points,width:stroke.erase?6:(stroke.width??LED.lineWidth),color,erase:stroke.erase,
      map:([x,y])=>({x:LED.padding+x*scale,y:LED.padding+y*scale})});
  }
}
