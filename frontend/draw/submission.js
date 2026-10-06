import {MONO_MATERIAL} from '../shared/monoline.js?v=20261006-pressure-cache';
import {GRAPHITE_MATERIAL} from '../shared/graphite.js';

export function submissionPayload(strokes){
  const vectors=strokes.map(stroke=>{
    const material=stroke.erase?null:stroke.material===GRAPHITE_MATERIAL?GRAPHITE_MATERIAL:MONO_MATERIAL;
    return {erase:Boolean(stroke.erase),...(material?{width:stroke.ledWidth,material,...(material===GRAPHITE_MATERIAL?{seed:stroke.seed}:{})}:{}),
      // Unsaved solid drafts adopt the shared palette without losing their alpha 1.
      points:stroke.points.map(p=>material?[p.x,p.y,stroke.material===material?p.p??.55:1]:[p.x,p.y])};
  });
  return {version:2,profile:'led-2px',strokes:vectors};
}
