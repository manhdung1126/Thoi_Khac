import {paintMonoStroke,MONO_MATERIAL,monoOpacity} from '../shared/monoline.js?v=20261006-pressure-cache';
import {metallicGold} from '../shared/metallic.js?v=20261006-pressure-cache';
import {paintGraphiteStroke,GRAPHITE_MATERIAL} from '../shared/graphite.js';

export function samplePoint(event, rect, previous) {
  const point={
    x: Math.max(0, Math.min(720, (event.clientX - rect.left) * 720 / rect.width)),
    y: Math.max(0, Math.min(720, (event.clientY - rect.top) * 720 / rect.height)),
    t: Number.isFinite(event.timeStamp) ? event.timeStamp : 0,
  };
  // Mouse/touch pressure is often a fabricated .5, so use source-unit velocity.
  // Pen lift reports zero: retain the last contact pressure, never pale the tail.
  const elapsed=previous?point.t-previous.t:0;
  const speed=elapsed>0?Math.hypot(point.x-previous.x,point.y-previous.y)/elapsed:0;
  const fallback=!previous||elapsed<=0?previous?.p??.55:.75-.5*Math.min(1,speed/2);
  point.p=event.pointerType==='pen'&&Number.isFinite(event.pressure)&&event.pressure>0
    ?Math.min(1,event.pressure):(event.type==='pointerup'?previous?.p??.55:fallback);
  return point;
}

export function paintStroke(ctx, stroke, size=720) {
  if(stroke.material===GRAPHITE_MATERIAL){paintGraphiteStroke(ctx,stroke);return;}
  paintMonoStroke(ctx, {
    points: stroke.points,
    width: stroke.width,
    color: stroke.erase ? '#000' : metallicGold(ctx,size),
    erase: stroke.erase,
    opacity:!stroke.erase&&stroke.material===MONO_MATERIAL?monoOpacity(stroke.points):1,
  });
}
