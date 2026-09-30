import {paintMonoStroke} from '../shared/monoline.js';
import {metallicGold} from '../shared/metallic.js';

export function samplePoint(event, rect) {
  return {
    x: Math.max(0, Math.min(720, (event.clientX - rect.left) * 720 / rect.width)),
    y: Math.max(0, Math.min(720, (event.clientY - rect.top) * 720 / rect.height)),
    t: Number.isFinite(event.timeStamp) ? event.timeStamp : 0,
  };
}

export function paintStroke(ctx, stroke) {
  paintMonoStroke(ctx, {
    points: stroke.points,
    width: stroke.width,
    color: stroke.erase ? '#000' : metallicGold(ctx, 720),
    erase: stroke.erase,
  });
}
