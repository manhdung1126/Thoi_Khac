// One path builder is shared by Draw and the LED renderer; the server mirrors it for SVG output.
// Quadratic segments stay inside the sampled points' convex hull, so the ink
// never predicts or overshoots the pointer. Deliberate sharp turns remain sharp.
const monoPoint = value => Array.isArray(value) ? {x:value[0],y:value[1]} : value;

export const MONO_MATERIAL='mono-v1';
// One density for the whole path; pressure never changes its width or geometry.
export function monoOpacity(points){
  const mean=points.reduce((sum,p)=>sum+Math.max(0,Math.min(1,(Array.isArray(p)?p[2]:p.p)??.55)),0)/Math.max(1,points.length);
  return Math.round((.9+.1*mean)*1000)/1000;
}

function turn(before,current,after){
  const ax=current.x-before.x,ay=current.y-before.y,bx=after.x-current.x,by=after.y-current.y;
  const a=Math.hypot(ax,ay),b=Math.hypot(bx,by);
  if(!a||!b)return 0;
  return Math.acos(Math.max(-1,Math.min(1,(ax*bx+ay*by)/(a*b))));
}

// Mono line should suppress finger jitter without feeling like a stabilizer that
// trails behind. Only interior samples are softened; the real first and latest
// pointer positions always remain exact. Sharp turns bypass the filter.
export function stabilizeMonoPoints(points,map=value=>monoPoint(value)){
  const source=points.map(map);
  if(source.length<3)return source;
  const result=[source[0]];
  for(let index=1;index<source.length-1;index++){
    const before=source[index-1],current=source[index],after=source[index+1];
    const corner=turn(before,current,after)>Math.PI*.31;
    const candidate=corner?current:{
      x:before.x*.18+current.x*.64+after.x*.18,
      y:before.y*.18+current.y*.64+after.y*.18
    };
    const previous=result.at(-1);
    if(corner||Math.hypot(candidate.x-previous.x,candidate.y-previous.y)>=.45)result.push(candidate);
  }
  const last=source.at(-1),previous=result.at(-1);
  if(Math.hypot(last.x-previous.x,last.y-previous.y)<.01)result[result.length-1]=last;
  else result.push(last);
  return result;
}

export function traceMonoPath(ctx,points,map=value=>monoPoint(value)){
  if(!points.length)return false;
  const stable=stabilizeMonoPoints(points,map),first=stable[0];
  ctx.moveTo(first.x,first.y);
  if(stable.length===1)return false;
  if(stable.length===2){const last=stable[1];ctx.lineTo(last.x,last.y);return true;}
  for(let index=1;index<stable.length-1;index++){
    const before=stable[index-1],current=stable[index],after=stable[index+1];
    const deliberateCorner=turn(before,current,after)>Math.PI*.38;
    const a=Math.hypot(current.x-before.x,current.y-before.y),b=Math.hypot(after.x-current.x,after.y-current.y);
    if(deliberateCorner||Math.min(a,b)<.8)ctx.lineTo(current.x,current.y);
    else ctx.quadraticCurveTo(current.x,current.y,(current.x+after.x)/2,(current.y+after.y)/2);
  }
  const last=stable.at(-1);ctx.lineTo(last.x,last.y);return true;
}

export function paintMonoStroke(ctx,{points,width,color,erase=false,map,opacity=1}){
  if(!points?.length)return;
  ctx.save();ctx.globalAlpha=opacity;ctx.globalCompositeOperation=erase?'destination-out':'source-over';
  ctx.strokeStyle=ctx.fillStyle=color;ctx.lineWidth=width;ctx.lineCap=ctx.lineJoin='round';ctx.beginPath();
  const convert=map||(value=>monoPoint(value));
  if(points.length===1){const p=convert(points[0]);ctx.arc(p.x,p.y,width/2,0,Math.PI*2);ctx.fill();}
  else{traceMonoPath(ctx,points,convert);ctx.stroke();}
  ctx.restore();
}
