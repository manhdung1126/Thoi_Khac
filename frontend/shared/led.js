import {paintMonoStroke} from './monoline.js';
import {metallicGold} from './metallic.js';

// Installation design units: 4600 × 2300. Output pixels: 1536 × 768.
export const MONO_LED_WIDTHS=Object.freeze([1,1.5,2,2.5,3]);
export function monoDrawWidth(level){return MONO_LED_WIDTHS[level-1]*720/140;}
export const LED = Object.freeze({width:1536,height:768,count:27,size:140,padding:0,
  gap:47*1536/4600,color:'#FFD700',lineWidth:2,sourceSize:720,drawLineWidth:monoDrawWidth(3),
  monoReference:'iOS 27.0 · Markup Mono line · weight 2/5',
  background:'/display/assets/led-dark-gold-demo.svg'});
export function cellGeometry(id){
  const col=Math.floor(id/3),row=id%3;
  const left=(LED.width-9*LED.size-8*LED.gap)/2;
  return {x:left+col*(LED.size+LED.gap),y:[190,162,190,228,190,228,190,162,190][col]+row*(LED.size+LED.gap),width:LED.size,height:LED.size};
}
export function paintLedVectors(ctx,data,color=metallicGold(ctx,LED.size)){
  const scale=(LED.size-LED.padding*2)/LED.sourceSize;
  for(const stroke of data.strokes){
    paintMonoStroke(ctx,{points:stroke.points,width:stroke.erase?6:(stroke.width??LED.lineWidth),color,erase:stroke.erase,
      map:([x,y])=>({x:LED.padding+x*scale,y:LED.padding+y*scale})});
  }
}
