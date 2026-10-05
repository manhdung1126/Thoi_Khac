const test=require('node:test');const assert=require('node:assert/strict');
test('27 LED cells fit the new scroll paper and avoid the title, rolls and lower-left cloud',async()=>{
  const {LED,cellGeometry,SCROLL_ROWS,SCROLL_AREA}=await import('../frontend/shared/led.js');
  assert.equal(LED.width/LED.height,2);assert.equal(LED.gap,47*1536/4600);assert.equal(LED.size,110);assert.equal(LED.padding,0);
  assert.deepEqual(SCROLL_ROWS,[9,10,8]);assert.equal(LED.background,'/display/assets/led-scroll.png');
  const boxes=Array.from({length:27},(_,i)=>cellGeometry(i));
  assert.equal(new Set(boxes.map(b=>`${b.x},${b.y}`)).size,27);
  for(const b of boxes){assert.ok(b.x>=SCROLL_AREA.x&&b.y>=SCROLL_AREA.y&&b.x+b.width<=SCROLL_AREA.x+SCROLL_AREA.width&&b.y+b.height<SCROLL_AREA.y+SCROLL_AREA.height);}
  for(const start of [0,9,19])for(let i=start+1;i<start+SCROLL_ROWS[[0,9,19].indexOf(start)];i++)assert.ok(Math.abs(boxes[i].x-boxes[i-1].x-LED.size-LED.gap)<1e-9);
  assert.ok(boxes.slice(19).every(b=>b.x>395));
  for(let i=0;i<boxes.length;i++)for(let j=0;j<i;j++){const a=boxes[i],b=boxes[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);}
  assert.throws(()=>cellGeometry(27),RangeError);
});
test('LED vector renderer draws 2px gold regardless of source size/pressure with 6px eraser',async()=>{
  const {LED,paintLedVectors}=await import('../frontend/shared/led.js');
  const marks=[];const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},arc(){},fill(){marks.push([this.lineWidth,this.fillStyle,this.globalCompositeOperation]);},stroke(){marks.push([this.lineWidth,this.strokeStyle,this.globalCompositeOperation]);}};
  paintLedVectors(ctx,{strokes:[{erase:false,points:[[0,0],[720,720]]},{erase:true,points:[[300,300]]}]});
  assert.deepEqual(marks,[[2,'#E7BD00','source-over'],[6,'#E7BD00','destination-out']]);
  assert.equal(LED.drawLineWidth,2*720/LED.size);assert.equal(LED.drawLineWidth*LED.size/720,2);assert.equal(LED.monoReference,'iOS 27.0 · Markup Mono line · weight 2/5');
});
test('LED vector renderer honors all five per-stroke width options',async()=>{
  const {MONO_LED_WIDTHS,paintLedVectors}=await import('../frontend/shared/led.js');const widths=[];
  const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},arc(){},fill(){},stroke(){widths.push(this.lineWidth);}};
  paintLedVectors(ctx,{strokes:MONO_LED_WIDTHS.map(width=>({erase:false,width,points:[[0,0],[10,10]]}))});
  assert.deepEqual(widths,[1,1.5,2,2.5,3]);
});
test('metallic gold stays inside the original stroke and provides foil highlights',async()=>{
  const {metallicGold,METALLIC_GOLD}=await import('../frontend/shared/metallic.js');const stops=[];
  const gradient={addColorStop:(position,color)=>stops.push([position,color])};
  const result=metallicGold({createLinearGradient:()=>gradient},140);
  assert.equal(result,gradient);assert.ok(stops.length>=5);
  assert.ok(stops.some(([,color])=>color===METALLIC_GOLD));
  // Keep the installation yellow close to the agreed #FFD700, not bronze/brown.
  const rgb=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16));
  rgb(METALLIC_GOLD).forEach((v,i)=>assert.ok(Math.abs(v-[255,215,0][i])<=28));
  assert.ok(stops.some(([,color])=>rgb(color)[0]<rgb(METALLIC_GOLD)[0]));
  assert.ok(stops.some(([,color])=>rgb(color)[0]>rgb(METALLIC_GOLD)[0]));
});
