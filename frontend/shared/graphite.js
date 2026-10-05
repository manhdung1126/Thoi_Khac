import {paintMonoStroke} from './monoline.js';

// Artwork-local material: never sample the scene behind a drawing, otherwise
// moving it to another cell would change the saved artwork. SVG mirrors this tile.
export const GRAPHITE_COLOR='#514739';
export const GRAPHITE_MATERIAL='graphite-v1';
export const GRAPHITE_TILE=32;
const graphiteTiles=new Map();

export function graphiteGrain(seed){
  let state=seed+1;
  const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const round=value=>Math.round(value*1000)/1000;
  return Array.from({length:64},()=>({x:round(2+next()*28),y:round(2+next()*28),r:round(.3+next()*.65),alpha:round(.12+next()*.28)}));
}

export function graphiteOpacity(points){
  const pressure=points.reduce((sum,p)=>sum+(Array.isArray(p)?p[2]??.55:p.p??.55),0)/points.length;
  // ponytail: restrained whole-stroke density, not a variable-width brush.
  // Local pressure envelopes are only warranted if real stylus testing needs them.
  return Math.round((.82+.14*pressure)*1000)/1000;
}

export function graphitePattern(ctx,seed){
  if(!graphiteTiles.has(seed)){
    const tile=document.createElement('canvas');tile.width=tile.height=GRAPHITE_TILE*2;
    const ink=tile.getContext('2d',{willReadFrequently:true});ink.scale(2,2);
    ink.fillStyle=GRAPHITE_COLOR;ink.fillRect(0,0,GRAPHITE_TILE,GRAPHITE_TILE);
    ink.globalCompositeOperation='destination-out';
    for(const grain of graphiteGrain(seed)){
      ink.globalAlpha=grain.alpha;ink.beginPath();ink.arc(grain.x,grain.y,grain.r,0,Math.PI*2);ink.fill();
    }
    graphiteTiles.set(seed,tile);
    if(graphiteTiles.size>64)graphiteTiles.delete(graphiteTiles.keys().next().value);
  }
  const pattern=ctx.createPattern(graphiteTiles.get(seed),'repeat');
  pattern.setTransform({a:.5,b:0,c:0,d:.5,e:0,f:0});
  return pattern;
}

export function paintGraphiteStroke(ctx,stroke){
  paintMonoStroke(ctx,{points:stroke.points,width:stroke.width,erase:stroke.erase,
    color:stroke.erase?'#000':graphitePattern(ctx,stroke.seed),
    opacity:stroke.erase?1:graphiteOpacity(stroke.points)});
}
