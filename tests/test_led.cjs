const test=require('node:test');const assert=require('node:assert/strict');
test('LED cells fit native 2:1 raster with design-unit gap and 27 independent positions',async()=>{
  const {LED,cellGeometry}=await import('../frontend/shared/led.js');
  assert.equal(LED.width/LED.height,2);assert.equal(LED.gap,47*1536/4600);assert.equal(LED.size,140);assert.equal(LED.padding,0);
  const boxes=Array.from({length:27},(_,i)=>cellGeometry(i));
  assert.equal(new Set(boxes.map(b=>`${b.x},${b.y}`)).size,27);
  for(const b of boxes){assert.ok(b.x>=0&&b.y>=140&&b.x+b.width<=1536&&b.y+b.height<698);}
  for(let i=0;i<24;i+=3)assert.ok(Math.abs(boxes[i+3].x-boxes[i].x-LED.size-LED.gap)<1e-9);
});
test('LED vector renderer draws 2px gold regardless of source size/pressure with 6px eraser',async()=>{
  const {LED,paintLedVectors}=await import('../frontend/shared/led.js');
  const marks=[];const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},arc(){},fill(){marks.push([this.lineWidth,this.fillStyle,this.globalCompositeOperation]);},stroke(){marks.push([this.lineWidth,this.strokeStyle,this.globalCompositeOperation]);}};
  paintLedVectors(ctx,{strokes:[{erase:false,points:[[0,0],[720,720]]},{erase:true,points:[[300,300]]}]});
  assert.deepEqual(marks,[[2,'#FFD700','source-over'],[6,'#FFD700','destination-out']]);
  assert.equal(LED.drawLineWidth,2*720/140);assert.equal(LED.drawLineWidth*140/720,2);assert.equal(LED.monoReference,'iOS 27.0 · Markup Mono line · weight 2/5');
});
test('LED vector renderer honors all five per-stroke width options',async()=>{
  const {MONO_LED_WIDTHS,paintLedVectors}=await import('../frontend/shared/led.js');const widths=[];
  const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},arc(){},fill(){},stroke(){widths.push(this.lineWidth);}};
  paintLedVectors(ctx,{strokes:MONO_LED_WIDTHS.map(width=>({erase:false,width,points:[[0,0],[10,10]]}))});
  assert.deepEqual(widths,[1,1.5,2,2.5,3]);
});
test('metallic gold stays inside the original stroke and provides foil highlights',async()=>{
  const {metallicGold}=await import('../frontend/shared/metallic.js');const stops=[];
  const gradient={addColorStop:(position,color)=>stops.push([position,color])};
  const result=metallicGold({createLinearGradient:()=>gradient},140);
  assert.equal(result,gradient);assert.ok(stops.length>=5);
  assert.ok(stops.some(([,color])=>color==='#FFF2A6'));
});
