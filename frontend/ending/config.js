import {LED} from '../shared/led.js';

// Presentation-only: never changes saved vectors or the agreed LED line width.
export const ENDING_VISUAL = Object.freeze({
  depthFade: .08,
  shinePeriod: 4.2,
  shineWidth: .085,
  shineStrength: .90,
  shadowStrength: .48,
  engravingStrength: 1,
});

export const ENDING_MOTION = Object.freeze({
  duration: 20,
  disturbanceEnd: 2.5,
  releaseEnd: 5,
  flowEnd: 9,
  orderEnd: 13,
  settleEnd: 16,
  completeAt: 17,
  breathEnd: 17.8,
  engravingEnd: 19,
  textAt: 19.2,
  breathScale: .01,
  maxRotation: 12,
  simulationHz: 30,
  flowSpeed: .065,
  spreadStrength: .65,
  driftBalance: 1,
  arrivalSpeed: .18,
  steering: 3.4,
  damping: .22,
  personalShare: .22,
  targetRadius: .035,
  arrivalRate: 2.6,
  settleWindow: 1.8,
});
export const ENDING_CONFIG = Object.freeze({
  seed: 'thoi-khac-01',
  viewport: {width: 1536, height: 768},
  area: Object.freeze({x:408,y:238,width:720,height:344}),
  referenceSize: LED.size,
  flowBounds: Object.freeze({left:.10,right:.90,top:.32,bottom:.77,lowerLeft:.27}),
  margin: .04,
  packing: .78,
  maxDrawingSize: .22,
  duration: ENDING_MOTION.duration,
  finalText: '',
});
