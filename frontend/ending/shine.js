import {ENDING_MOTION,ENDING_VISUAL} from './config.js';
import {smooth} from './motion.js';

// Absolute-time lighting: pause, seek and all screens show the same reflection.
// Both the deeper-gold shoulder and bright core are clipped to existing stroke alpha.
export function shineAt(time,c=ENDING_MOTION,v=ENDING_VISUAL){
  if(time<=0||time>=c.engravingEnd)return null;
  if(time>c.breathEnd){
    return {phase:(time-c.breathEnd)/(c.engravingEnd-c.breathEnd),strength:v.engravingStrength};
  }
  const strength=v.shineStrength*smooth(time/1.6)*(1-smooth((time-16.5)/.9));
  if(strength<=0)return null;
  return {phase:(time/v.shinePeriod)%1,strength};
}

export function paintStrokeShine(ctx,width,height,time,v=ENDING_VISUAL,neutral=false){
  const light=shineAt(time,ENDING_MOTION,v);
  if(!light)return;
  const x=(-.25+light.phase*1.5)*width,band=width*v.shineWidth;
  const shade=ctx.createLinearGradient(x-band*2,0,x+band*2,0);
  const shadow=neutral?'0,0,0':'164,127,0';
  shade.addColorStop(0,`rgba(${shadow},0)`);
  shade.addColorStop(.23,`rgba(${shadow},${v.shadowStrength})`);
  shade.addColorStop(.5,`rgba(${shadow},0)`);
  shade.addColorStop(.77,`rgba(${shadow},${v.shadowStrength*.72})`);
  shade.addColorStop(1,`rgba(${shadow},0)`);
  const shine=ctx.createLinearGradient(x-band,0,x+band,0);
  shine.addColorStop(0,'rgba(255,255,255,0)');
  shine.addColorStop(.30,neutral?'rgba(255,255,255,.25)':'rgba(255,232,110,.25)');
  shine.addColorStop(.48,neutral?'rgba(255,255,255,.85)':'rgba(255,250,210,.85)');
  shine.addColorStop(.56,neutral?'rgba(255,255,255,.42)':'rgba(255,232,110,.42)');
  shine.addColorStop(1,'rgba(255,255,255,0)');
  ctx.save();ctx.globalCompositeOperation='source-atop';ctx.globalAlpha=light.strength;
  ctx.fillStyle=shade;ctx.fillRect(0,0,width,height);
  ctx.fillStyle=shine;ctx.fillRect(0,0,width,height);ctx.restore();
}
