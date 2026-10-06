import {ENDING_MOTION} from './config.js';
import {planMotion,evaluateMotion,breathAt,clamp,smooth} from './motion.js';
import {paintStrokeShine} from './shine.js';

export const PREVIEW_SECONDS=ENDING_MOTION.duration;

// Local, seekable rehearsal. Plans and assets are prepared once.
// Canvas evaluates absolute time; no physics integration or API writes.
export class EndingPreview{
  constructor(canvas,onTime){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.onTime=onTime;
    this.time=0;this.running=false;this.completed=false;
  }
  prepare(layout,artworks,cells=[]){
    this.pause();this.layout=layout;this.artworks=artworks;
    this.motion=planMotion(layout,cells);
    this.canvas.width=layout.viewport.width;this.canvas.height=layout.viewport.height;
    const queues=Array.from({length:27},(_,i)=>this.motion.plans.filter(p=>p.cell===i));
    const visible=new Set(queues.map((q,i)=>q.find(p=>p.drawingId===cells[i]?.active)?.drawingId||q[0]?.drawingId));
    this.entries=this.motion.plans.map(plan=>({
      plan,art:artworks.get(plan.drawingId),visible:visible.has(plan.drawingId),
    })).sort((a,b)=>a.plan.depth-b.plan.depth||a.plan.target.z-b.plan.target.z);
    this.hasGraphite=this.entries.some(entry=>entry.art?.material==='graphite-v1');
    this.completed=false;this.seek(0);
  }
  play(){
    if(!this.layout||this.running)return;
    if(this.time>=PREVIEW_SECONDS){this.time=0;this.completed=false;}
    this.running=true;this.origin=performance.now()-this.time*1000;this.tick();
  }
  tick=()=>{
    if(!this.running)return;
    const next=Math.min(PREVIEW_SECONDS,(performance.now()-this.origin)/1000);
    this.setTime(next);
    if(!this.completed&&next>=ENDING_MOTION.completeAt){
      this.completed=true;
      this.canvas.dispatchEvent(new CustomEvent('ending-complete',{detail:{finalDrawingId:this.motion.finalDrawingId}}));
    }
    if(next>=PREVIEW_SECONDS){this.pause();this.onTime(this.time,false);return;}
    this.frame=requestAnimationFrame(this.tick);
  };
  pause(){this.running=false;cancelAnimationFrame(this.frame);}
  seek(time){
    this.setTime(time);
    this.completed=this.time>=ENDING_MOTION.completeAt;
    if(this.running)this.origin=performance.now()-this.time*1000;
  }
  setTime(time){this.time=clamp(time,0,PREVIEW_SECONDS);this.draw();this.onTime(this.time,this.running);}
  draw(){
    const {ctx,canvas,layout}=this;if(!layout)return;
    const w=canvas.width,h=canvas.height,t=this.time;
    ctx.clearRect(0,0,w,h);
    ctx.save();
    const breath=breathAt(t);
    ctx.translate(w/2,h/2);ctx.scale(breath,breath);ctx.translate(-w/2,-h/2);
    for(const {plan,art,visible} of this.entries){
      if(!art)continue;
      const reveal=visible?1:smooth((t-1.2-plan.delay)/2.4);
      if(!reveal)continue;
      const state=evaluateMotion(plan,t),size=state.size*w;
      const b=art.bounds,full=art.canvas.width,p=state.crop;
      const crop={x:b.x*p,y:b.y*p,width:full+(b.width-full)*p,height:full+(b.height-full)*p};
      const fit=size*.96875/Math.max(crop.width,crop.height);
      ctx.save();ctx.translate(state.x*w,state.y*h);ctx.rotate(state.rotation*Math.PI/180);
      ctx.globalAlpha=state.opacity*reveal;
      ctx.drawImage(art.canvas,crop.x,crop.y,crop.width,crop.height,-crop.width*fit/2,-crop.height*fit/2,crop.width*fit,crop.height*fit);
      ctx.restore();
    }
    ctx.restore();
    // A collective source-atop shine would recolor graphite in mixed sessions.
    if(!this.hasGraphite)paintStrokeShine(ctx,w,h,t);
  }
  destroy(){
    this.pause();this.layout=null;this.artworks=null;this.entries=[];this.motion=null;
    this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
  }
}
