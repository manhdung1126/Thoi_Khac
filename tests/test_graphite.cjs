const test=require('node:test'),assert=require('node:assert/strict');
test('existing graphite assets keep deterministic grain and density',async()=>{
  const {graphiteGrain,graphiteOpacity,GRAPHITE_COLOR}=await import('../frontend/shared/graphite.js');
  assert.equal(GRAPHITE_COLOR,'#514739');
  assert.deepEqual(graphiteGrain(17),graphiteGrain(17));assert.notDeepEqual(graphiteGrain(17),graphiteGrain(18));
  assert.equal(graphiteGrain(17).length,64);
  for(const g of graphiteGrain(17)){assert.ok(g.r<1&&g.alpha<.41);assert.ok(g.x-g.r>0&&g.x+g.r<32);}
  assert.equal(graphiteOpacity([[0,0,0]]),.82);assert.equal(graphiteOpacity([[0,0,1]]),.96);
  assert.equal(graphiteOpacity([{x:0,y:0,p:.2},{x:10,y:10,p:.8}]),graphiteOpacity([[0,0,.2],[10,10,.8]]));
});
test('Mono pressure changes only whole-path density; mouse/touch use velocity and pen lift retains pressure',async()=>{
  const {samplePoint,paintStroke}=await import('../frontend/draw/pencil.js');
  const {monoOpacity}=await import('../frontend/shared/monoline.js');
  const rect={left:0,top:0,width:720,height:720};
  const sample=pressure=>samplePoint({pointerType:'pen',pressure,clientX:20,clientY:30,timeStamp:10},rect);
  assert.equal(sample(.1).p,.1);assert.equal(sample(.9).p,.9);
  const previous={x:0,y:0,t:0,p:.8};
  for(const pointerType of ['touch','mouse']){
    const slow=samplePoint({pointerType,pressure:.99,clientX:20,clientY:0,timeStamp:100},rect,previous);
    const fast=samplePoint({pointerType,pressure:.99,clientX:20,clientY:0,timeStamp:2},rect,previous);
    assert.ok(slow.p>fast.p);assert.equal(fast.p,.25);
    assert.equal(samplePoint({pointerType,clientX:20,clientY:0,timeStamp:0},rect,previous).p,.8);
  }
  assert.equal(samplePoint({type:'pointerup',pointerType:'pen',pressure:0,clientX:20,clientY:0,timeStamp:20},rect,previous).p,.8);
  assert.equal(monoOpacity([[0,0,0]]),.9);assert.equal(monoOpacity([[0,0,1]]),1);
  const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
  paintStroke(ctx,{material:'mono-v1',points:[sample(.1),{x:80,y:30,p:.9}],width:720*2/110});
  assert.equal(ctx.strokeStyle,'#E7BD00');assert.equal(ctx.fillStyle,'#E7BD00');
  assert.equal(ctx.globalAlpha,.95);assert.equal(ctx.lineWidth,720*2/110);
  assert.equal(ctx.lineCap,'round');assert.equal(ctx.lineJoin,'round');
});
test('Canvas and SVG share the gold palette and whole-stroke density',async()=>{
  const {metallicGold}=await import('../frontend/shared/metallic.js');
  const {monoOpacity}=await import('../frontend/shared/monoline.js');
  const stops=[];metallicGold({createLinearGradient:()=>({addColorStop:(offset,color)=>stops.push([offset,color])})},720);
  const {execFileSync}=require('node:child_process');
  const points=[[20,20,.1],[100,20,.9]],svg=execFileSync('.venv/bin/python',['-c',
    'from backend.app.led import svg_document; import json; print(svg_document(json.loads(\''+JSON.stringify({version:2,profile:'led-2px',strokes:[{erase:false,material:'mono-v1',width:2,points}]})+'\')).decode())'],{encoding:'utf8'});
  const actual=[...svg.matchAll(/<stop offset="([^"]+)" stop-color="([^"]+)"/g)].map(m=>[Number(m[1]),m[2]]);
  assert.deepEqual(actual,stops);assert.ok(svg.includes(`opacity="${monoOpacity(points)}"`));
  assert.match(svg,/data-material="mono-v1"/);assert.doesNotMatch(svg,/<pattern|grain/);
});
test('JS and server SVG share the exact grain definition',async()=>{
  const {graphiteGrain}=await import('../frontend/shared/graphite.js');
  const {execFileSync}=require('node:child_process');
  const seeds=[0,17,255],python=JSON.parse(execFileSync('.venv/bin/python',['-c',
    'import json; from backend.app.led import graphite_grain; print(json.dumps([graphite_grain(s) for s in [0,17,255]]))'],{encoding:'utf8'}));
  assert.deepEqual(seeds.map(graphiteGrain),python);
});
test('pointer coordinates and velocity density are independent of canvas display size and stay inside the paper',async()=>{
  const {samplePoint}=await import('../frontend/draw/pencil.js');
  for(const pointerType of ['mouse','touch','pen']){
    const sample=size=>samplePoint({pointerType,pressure:.7,clientX:20+size/2,clientY:30+size/4,timeStamp:20},
      {left:20,top:30,width:size,height:size},{x:340,y:180,t:0,p:.55});
    assert.deepEqual(sample(720),sample(360));
    assert.deepEqual([sample(360).x,sample(360).y],[360,180]);
  }
  const rect={left:20,top:30,width:360,height:360};
  const outside=(x,y)=>samplePoint({pointerType:'mouse',clientX:x,clientY:y,timeStamp:0},rect);
  assert.deepEqual([outside(-100,-100).x,outside(-100,-100).y],[0,0]);
  assert.deepEqual([outside(1000,1000).x,outside(1000,1000).y],[720,720]);
});
