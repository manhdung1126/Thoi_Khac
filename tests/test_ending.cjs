const test=require('node:test');
const assert=require('node:assert/strict');
// Self-contained fixture: no dependency on optional exhibition artwork.
const points=[];
for(let y=8;y<248;y+=4)for(let x=8;x<248;x+=4)if(Math.hypot(x-128,y-128)<110)points.push([x,y]);
const mask={id:'test-circle',width:256,height:256,aspect:1,points};
test('Control rehearsal supplements real drawings locally and fills all cells before cycling',async()=>{
  const {buildRehearsal}=await import('../frontend/ending/rehearsal.js');
  const drawings=[{id:'real-1'},{id:'real-2'},{id:'deleted',deleted:true},{id:'other-page'}];
  const state={current_page_id:'live',drawings,pages:[{id:'live',cells:[{drawing_ids:['real-1','real-2','deleted'],active:'real-2'}]}]};
  const before=JSON.stringify(state);
  const args={state,mask,name:'custom.svg',seed:'trial',count:'50'};
  const result=buildRehearsal(args);
  assert.equal(result.realCount,2);assert.equal(result.sampleCount,48);
  assert.equal(result.session.drawings.length,50);
  assert.equal(new Set(result.session.drawings.map(d=>d.id)).size,50);
  assert.ok(result.session.drawings.slice(2).every(d=>d.synthetic&&d.id.startsWith('rehearsal:')));
  assert.equal(result.session.cells[0].active,'real-2');
  assert.ok(result.session.cells.every(c=>c.drawing_ids.length>=1));
  assert.equal(JSON.stringify(state),before);
  assert.deepEqual(result.session.drawings,buildRehearsal(args).session.drawings);
  const fewer=buildRehearsal({...args,count:'1'});
  assert.deepEqual(fewer.session.drawings,[drawings[0]]);
  assert.equal(fewer.session.cells[0].active,'real-1');
  const live=buildRehearsal({...args,count:'live'});
  assert.equal(live.sampleCount,0);assert.equal(live.session.drawings.length,2);
  const empty={drawings:[],pages:[],current_page_id:null};
  assert.equal(buildRehearsal({...args,state:empty,count:'27'}).sampleCount,27);
  assert.throws(()=>buildRehearsal({...args,state:empty,count:'live'}),/trang trống/);
  for(const count of ['0','abc','1.5','1501'])assert.throws(()=>buildRehearsal({...args,count}),/1.500/);
  assert.throws(()=>buildRehearsal({...args,mask:null}),/ảnh đích/);
  assert.throws(()=>buildRehearsal({...args,mask:{points:[]}}),/quá mảnh/);
  const frozen={...state,ending:{drawings:[{id:'snapshot'}],cells:[{drawing_ids:['snapshot'],active:'snapshot'}]}};
  assert.equal(buildRehearsal({...args,state:frozen,count:'live'}).session.drawings[0].id,'snapshot');
});
test('Ending controls require an uploaded image and keep simulation out of the production prepare body',()=>{
  const fs=require('node:fs');
  const html=fs.readFileSync('frontend/control/index.html','utf8');
  const app=fs.readFileSync('frontend/control/ending.js','utf8');
  assert.doesNotMatch(html,/ending-default|Biểu tượng Hà Nội|prototype/);
  assert.match(html,/id="ending-preview-count"/);
  assert.match(html,/value="1500"/);
  assert.match(app,/mask:this.custom.mask,name:this.custom.name/);
  assert.doesNotMatch(app,/hanoi-mask|session.update\(state\)/);
});
test('flow motion preserves endpoints, continuity, seed determinism and a soft settling group',async()=>{
  const {planMotion,evaluateMotion,breathAt,motionPhase}=await import('../frontend/ending/motion.js');
  const {compose}=await import('../frontend/ending/composition.js');
  const drawings=Array.from({length:100},(_,i)=>({id:String(i)}));
  const layout={seed:'a',viewport:{width:1536,height:768},targets:compose({drawings,mask,seed:'a'})};
  const cells=[{drawing_ids:['10','20']}];
  const motion=planMotion(layout,cells);
  assert.deepEqual(motion,planMotion({...layout,targets:[...layout.targets].reverse()},cells));
  assert.notDeepEqual(motion,planMotion({...layout,seed:'b'},cells));
  assert.equal(motion.plans.find(t=>t.drawingId==='10').cell,0);
  assert.equal(motion.plans.find(t=>t.drawingId==='20').cell,0);
  assert.equal(motion.plans.filter(t=>t.finalDrawing).length,1);
  assert.equal(motion.plans.filter(t=>t.lockAt>16).length,5);
  assert.equal(motion.plans.find(t=>t.finalDrawing).lockAt,17);
  assert.equal(motion.version,3);
  for(const plan of motion.plans){
    const initial=evaluateMotion(plan,0),end=evaluateMotion(plan,20);
    assert.equal(initial.x,plan.start.x);assert.equal(initial.y,plan.start.y);
    assert.equal(end.x,plan.target.x);assert.equal(end.y,plan.target.y);
    assert.equal(end.size,plan.target.width);assert.equal(end.rotation,plan.target.rotation);
    assert.deepEqual(end,evaluateMotion(plan,100));
    for(let t=0;t<20;t+=.1){const v=evaluateMotion(plan,t);assert.ok([v.x,v.y,v.size,v.rotation,v.opacity].every(Number.isFinite));assert.ok(v.x>0&&v.x<1&&v.y>0&&v.y<1);assert.ok(Math.abs(v.rotation)<=16);}
    for(const time of [2.5,5,9,13,plan.trajectory.settleAt,plan.lockAt]){
      const a=evaluateMotion(plan,time-.001),b=evaluateMotion(plan,time),c=evaluateMotion(plan,time+.001);
      assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<.001);
      assert.ok(Math.hypot((b.x-a.x)-(c.x-b.x),(b.y-a.y)-(c.y-b.y))<.00001);
    }
  }
  assert.equal(breathAt(17),1);assert.equal(breathAt(19),1);assert.ok(breathAt(17.4)>1);
  assert.deepEqual([0,3,6,10,14,16.5,17.4,18.3,20].map(t=>motionPhase(t)),['DISTURBANCE','RELEASE','FLOW','ORDER','CONVERGENCE','FINAL','BREATH','ENGRAVE','LOCKED']);
});
test('curl field is smooth, spatially correlated and divergence-free',async()=>{
  const {curlField}=await import('../frontend/ending/flow.js');
  const phases=[.2,1.5,2.3,.7],eps=.00001;
  for(let t=0;t<15;t+=.7){
    const x=.31,y=.24,v=curlField(x,y,t,phases),neighbor=curlField(x+.001,y+.001,t,phases);
    assert.ok(Math.hypot(v[0]-neighbor[0],v[1]-neighbor[1])<.025);
    const next=curlField(x,y,t+.001,phases);
    assert.ok(Math.hypot(v[0]-next[0],v[1]-next[1])<.001);
    const dx=(curlField(x+eps,y,t,phases)[0]-curlField(x-eps,y,t,phases)[0])/(2*eps);
    const dy=(curlField(x,y+eps,t,phases)[1]-curlField(x,y-eps,t,phases)[1])/(2*eps);
    assert.ok(Math.abs(dx+dy)<.00001);
  }
});
test('stronger foil lighting is seekable, clipped to strokes and inactive at the endpoints',async()=>{
  const {shineAt,paintStrokeShine}=await import('../frontend/ending/shine.js');
  const {ENDING_VISUAL}=await import('../frontend/ending/config.js');
  assert.equal(shineAt(0),null);assert.equal(shineAt(17.6),null);assert.equal(shineAt(19),null);
  const middle=shineAt(6);
  assert.equal(middle.strength,ENDING_VISUAL.shineStrength);
  assert.ok(middle.strength>.25);
  shineAt(2);shineAt(18);assert.deepEqual(shineAt(6),middle);
  assert.equal(shineAt(18.3).strength,ENDING_VISUAL.engravingStrength);
  const operations=[],stops=[],stack=[];
  const ctx={globalCompositeOperation:'source-over',globalAlpha:1,
    createLinearGradient(){return {addColorStop:(offset,color)=>stops.push([offset,color])};},
    save(){stack.push([this.globalCompositeOperation,this.globalAlpha]);},
    restore(){[this.globalCompositeOperation,this.globalAlpha]=stack.pop();},
    fillRect(){operations.push([this.globalCompositeOperation,this.globalAlpha]);},
  };
  paintStrokeShine(ctx,1536,768,0);assert.equal(operations.length,0);
  paintStrokeShine(ctx,1536,768,6);
  assert.deepEqual(operations,[['source-atop',ENDING_VISUAL.shineStrength],['source-atop',ENDING_VISUAL.shineStrength]]);
  assert.equal(ctx.globalCompositeOperation,'source-over');assert.equal(ctx.globalAlpha,1);
  assert.ok(stops.some(([,color])=>color.includes('164,127,0')));
  assert.ok(stops.some(([,color])=>color==='rgba(255,250,210,.85)'));
});
test('Ending does not recolor graphite in a mixed session; legacy-only still shines',async()=>{
  const {EndingPreview}=await import('../frontend/ending/preview.js');
  const previous=global.cancelAnimationFrame;global.cancelAnimationFrame=()=>{};
  try{
    let shines=0;
    const ctx={clearRect(){},save(){},restore(){},translate(){},scale(){},rotate(){},drawImage(){},
      createLinearGradient(){return {addColorStop(){}};},fillRect(){shines++;}};
    const preview=new EndingPreview({getContext:()=>ctx},()=>{});
    const target={drawingId:'a',x:.5,y:.5,width:.04,height:.04,rotation:0,z:0};
    const layout={seed:'fixture',viewport:{width:1536,height:768},targets:[target]};
    const art={material:'metallic',canvas:{width:160},bounds:{x:0,y:0,width:160,height:160}};
    preview.prepare(layout,new Map([['a',art]]));preview.seek(6);assert.ok(shines>0);
    shines=0;preview.prepare({...layout,targets:[target,{...target,drawingId:'b',x:.55}]},
      new Map([['a',art],['b',{...art,material:'graphite-v1'}]]));
    preview.seek(6);assert.equal(shines,0);assert.equal(preview.hasGraphite,true);
    preview.destroy();
  }finally{if(previous)global.cancelAnimationFrame=previous;else delete global.cancelAnimationFrame;}
});
test('scroll flight preserves visual balance and spread across different seeds',async()=>{
  const {planMotion,evaluateMotion}=await import('../frontend/ending/motion.js');
  const {compose}=await import('../frontend/ending/composition.js');
  const {ENDING_CONFIG}=await import('../frontend/ending/config.js');
  for(const count of [27,250,1500])for(const seed of ['thoi-khac-01','a','b','scroll','load']){
    const drawings=Array.from({length:count},(_,i)=>({id:String(i)}));
    const targets=compose({...ENDING_CONFIG,drawings,mask,seed});
    const motion=planMotion({...ENDING_CONFIG,seed,targets});
    const stats=time=>{
      const positions=motion.plans.map(plan=>evaluateMotion(plan,time));
      const x=positions.reduce((sum,p)=>sum+p.x,0)/count;
      const y=positions.reduce((sum,p)=>sum+p.y,0)/count;
      return {x,y,spread:Math.sqrt(positions.reduce((sum,p)=>sum+(p.x-x)**2,0)/count)};
    };
    const start=stats(0);
    for(const time of [3,4,5,6]){
      const s=stats(time);
      assert.ok(Math.abs(s.x-start.x)<.015,`horizontal drift ${count}/${seed}/${time}`);
      assert.ok(Math.abs(s.y-start.y)<.015,`vertical drift ${count}/${seed}/${time}`);
      assert.ok(s.spread>start.spread*.80&&s.spread<start.spread*1.25,`uneven spread ${count}/${seed}/${time}`);
    }
  }
});
test('flow supports large rehearsals, arbitrary seeks, bounded motion and alternate screen ratios',async()=>{
  const {planMotion,evaluateMotion}=await import('../frontend/ending/motion.js');
  const {compose}=await import('../frontend/ending/composition.js');
  for(const viewport of [{width:1536,height:768},{width:768,height:1024}]){
    const targets=compose({drawings:Array.from({length:1500},(_,i)=>({id:String(i)})),mask,seed:'load',viewport});
    const motion=planMotion({seed:'load',viewport,targets});
    for(const plan of motion.plans){
      for(const time of [0,2.8,5,8.5,12,15,17,20]){
        const v=evaluateMotion(plan,time);
        assert.ok([v.x,v.y,v.size,v.rotation,v.opacity].every(Number.isFinite));
        assert.ok(v.x>0&&v.x<1&&v.y>0&&v.y<1);
      }
      const atNine=evaluateMotion(plan,9);
      evaluateMotion(plan,2);evaluateMotion(plan,20);
      assert.deepEqual(evaluateMotion(plan,9),atNine);
      const a=evaluateMotion(plan,plan.lockAt-.001),b=evaluateMotion(plan,plan.lockAt);
      assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<.00001);
    }
  }
});
test('synthetic drawing families are unique, reproducible and use valid source coordinates',async()=>{
  const {sampleDrawings}=await import('../frontend/ending/samples.js');
  const samples=sampleDrawings(1500,'fixture-a');
  assert.equal(new Set(samples.map(d=>d.id)).size,1500);
  assert.equal(new Set(samples.map(d=>JSON.stringify(d.vectors))).size,1500);
  assert.deepEqual(samples,sampleDrawings(1500,'fixture-a'));
  assert.notDeepEqual(samples[0].vectors,sampleDrawings(1,'fixture-b')[0].vectors);
  for(const drawing of samples)for(const stroke of drawing.vectors.strokes)for(const point of stroke.points)assert.ok(point.every(v=>Number.isFinite(v)&&v>=0&&v<=720));
  assert.throws(()=>sampleDrawings(1501),/1.500/);
});
test('uploaded masks distinguish alpha, dark and light backgrounds and reject blank images',async()=>{
  const {maskFromPixels}=await import('../frontend/ending/mask.js');
  const width=64,height=64,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=(y*width+x)*4,inside=x>12&&x<50&&y>12&&y<50;
    data[p]=data[p+1]=data[p+2]=inside?0:255;data[p+3]=255;
  }
  const result=maskFromPixels({data,width,height});
  assert.equal(result.mode,'dark');
  assert.ok(result.mask.points.every(([x,y])=>x>12&&x<50&&y>12&&y<50));
  assert.deepEqual(result.mask,maskFromPixels({data,width,height},'dark').mask);
  assert.notDeepEqual(result.mask.points,maskFromPixels({data,width,height},'light').mask.points);
  for(let i=0;i<data.length;i+=4)if(data[i]===255)data[i+3]=0;
  assert.equal(maskFromPixels({data,width,height}).mode,'alpha');
  assert.throws(()=>maskFromPixels({data:new Uint8ClampedArray(data.length),width,height}),/Không tìm/);
  assert.throws(()=>maskFromPixels({data:new Uint8ClampedArray(data.length).fill(255),width,height},'alpha'),/khối đặc/);
});
test('ending preserves identities, deterministic order-independent placement and separated bounds',async()=>{
  const {compose}=await import('../frontend/ending/composition.js');
  for(const count of [0,1,10,25,30,50,100,250,300,500,1000,1500]){
    const drawings=Array.from({length:count},(_,i)=>({id:`drawing-${i}`}));
    const before=JSON.stringify(drawings);
    const args={drawings,mask,seed:'rehearsal'};
    const result=compose(args);
    assert.equal(result.length,count);
    assert.equal(new Set(result.map(t=>t.drawingId)).size,count);
    assert.equal(JSON.stringify(drawings),before);
    assert.deepEqual(result,compose({...args,drawings:[...drawings].reverse()}));
    const boxes=result.map(t=>{
      const factor=Math.abs(Math.cos(t.rotation*Math.PI/180))+Math.abs(Math.sin(t.rotation*Math.PI/180));
      const x=t.x*1536,y=t.y*768,half=t.width*1536*factor/2;
      assert.ok(x-half>=0&&x+half<=1536&&y-half>=0&&y+half<=768);
      return {x,y,half};
    });
    for(let i=0;i<boxes.length;i++)for(let j=0;j<i;j++){
      const a=boxes[i],b=boxes[j];
      assert.ok(Math.abs(a.x-b.x)>=a.half+b.half||Math.abs(a.y-b.y)>=a.half+b.half,`overlap ${count}/${i}/${j}`);
    }
  }
});
test('ending supports alternate ratios and rejects duplicate identities',async()=>{
  const {compose}=await import('../frontend/ending/composition.js');
  const drawings=Array.from({length:100},(_,i)=>({id:String(i)}));
  for(const viewport of [{width:1920,height:1080},{width:768,height:1024}]){
    const args={drawings,mask,viewport,seed:'a'};
    assert.notDeepEqual(compose(args),compose({...args,seed:'b'}));
    for(const t of compose(args))assert.ok(t.x>0&&t.x<1&&t.y>0&&t.y<1);
  }
  assert.throws(()=>compose({drawings:[{id:'x'},{id:'x'}],mask,seed:'a'}),/ID/);
});
test('the scroll ending stays within the paper target region',async()=>{
  const {compose}=await import('../frontend/ending/composition.js');
  const {ENDING_CONFIG}=await import('../frontend/ending/config.js');
  const {LED}=await import('../frontend/shared/led.js');
  const drawings=Array.from({length:500},(_,i)=>({id:String(i)}));
  const region=ENDING_CONFIG.area;
  for(const t of compose({...ENDING_CONFIG,drawings,mask,seed:'scroll'})){
    const half=t.width*1536*(Math.abs(Math.cos(t.rotation*Math.PI/180))+Math.abs(Math.sin(t.rotation*Math.PI/180)))/2;
    assert.ok(t.x*1536-half>=region.x&&t.x*1536+half<=region.x+region.width);
    assert.ok(t.y*768-half>=region.y&&t.y*768+half<=region.y+region.height);
    assert.ok(Math.abs(t.scale-t.width*1536/LED.size)<1e-12);
  }
});
