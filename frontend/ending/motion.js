import {LED,cellGeometry} from '../shared/led.js';
import {hash,random} from './composition.js';
import {ENDING_MOTION as defaults,ENDING_VISUAL} from './config.js';
import {simulateCloud,sampleFlow,clamp,smooth} from './flow.js';

export {clamp,smooth} from './flow.js';
const lerp=(a,b,p)=>a+(b-a)*p;

// Phase names remain available for diagnostics only, not force switches.
export function motionPhase(time,c=defaults){
  if(time<c.disturbanceEnd)return 'DISTURBANCE';
  if(time<c.releaseEnd)return 'RELEASE';
  if(time<c.flowEnd)return 'FLOW';
  if(time<c.orderEnd)return 'ORDER';
  if(time<c.settleEnd)return 'CONVERGENCE';
  if(time<c.completeAt)return 'FINAL';
  if(time<c.breathEnd)return 'BREATH';
  if(time<c.engravingEnd)return 'ENGRAVE';
  return 'LOCKED';
}

export function planMotion(layout,cells=[],config=defaults){
  const ordered=[...layout.targets].sort((a,b)=>a.drawingId<b.drawingId?-1:1);
  const tail=[...ordered].sort((a,b)=>hash(layout.seed+':final:'+b.drawingId)-hash(layout.seed+':final:'+a.drawingId));
  const final=tail[0],lateCount=Math.min(ordered.length,7,Math.max(3,Math.ceil(ordered.length*.05)));
  const late=new Map(tail.slice(0,lateCount).map((t,i)=>[t.drawingId,i]));
  const byId=new Map();cells.forEach((cell,i)=>(cell.drawing_ids||[]).forEach(id=>{if(!byId.has(id))byId.set(id,i%LED.count);}));
  const {width:w,height:h}=layout.viewport,scale=Math.min(w/LED.width,h/LED.height);
  const globalRandom=random(layout.seed+':field');
  const field=Array.from({length:4},()=>globalRandom()*Math.PI*2);
  const plans=ordered.map((target,i)=>{
    const rng=random(layout.seed+':motion:'+target.drawingId),cell=byId.get(target.drawingId)??i%LED.count;
    const box=cellGeometry(cell);
    const start={x:((w-LED.width*scale)/2+(box.x+box.width/2)*scale)/w,
      y:((h-LED.height*scale)/2+(box.y+box.height/2)*scale)/h,size:LED.size*scale/w};
    const depth=Math.floor(rng()*3),delay=rng()*1.4,phase=rng()*Math.PI*2;
    const finalDrawing=target.drawingId===final?.drawingId;
    // A small group finishes together; the last drawing is not a staged hero.
    const lockAt=finalDrawing?config.completeAt:late.has(target.drawingId)?
      config.completeAt-.15-late.get(target.drawingId)*.13:13.8+rng()*1.7;
    const plan={drawingId:target.drawingId,target,cell,start,depth,delay,phase,lockAt,finalDrawing,aspect:h/w,
      speedFactor:.85+rng()*.3,
      flowScale:Math.max(.46,Math.min(.82,Math.sqrt(27/ordered.length)*1.15))};
    return plan;
  });
  const trajectories=simulateCloud(plans,field,h/w,layout.flowBounds?{...config,flowBounds:layout.flowBounds}:config);
  plans.forEach((plan,i)=>{plan.trajectory=trajectories[i];});
  return {version:3,seed:layout.seed,config:{...config},field,finalDrawingId:final?.drawingId??null,plans};
}

export function evaluateMotion(plan,time,config=defaults){
  const {target,start}=plan;
  if(time>=plan.lockAt)return {x:target.x,y:target.y,size:target.width,rotation:target.rotation,opacity:1,crop:1,locked:true};
  const position=time<=0?{x:start.x,y:start.y,vx:0,vy:0}:sampleFlow(plan,time);
  const energy=smooth((time-plan.delay)/2.8)*(1-smooth((time-7)/(plan.lockAt-1-7)));
  const attraction=smooth((time-3-plan.delay)/(plan.lockAt-3-plan.delay));
  const tilt=Math.asin(Math.sin(Math.atan2(position.vy*plan.aspect,position.vx)))*180/Math.PI*.12;
  const depthSize=[.84,1,1.12][plan.depth];
  return {x:position.x,y:position.y,size:lerp(start.size,target.width,attraction)*(1+(depthSize*plan.flowScale-1)*energy),
    rotation:clamp(target.rotation*attraction+tilt*energy,-config.maxRotation,config.maxRotation),
    opacity:1-[ENDING_VISUAL.depthFade,ENDING_VISUAL.depthFade*.4,0][plan.depth]*energy,crop:attraction,locked:false};
}

export function breathAt(time,c=defaults){
  if(time<=c.completeAt||time>=c.breathEnd)return 1;
  return 1+c.breathScale*Math.sin((time-c.completeAt)/(c.breathEnd-c.completeAt)*Math.PI)**2;
}
