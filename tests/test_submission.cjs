const test=require('node:test');
const assert=require('node:assert/strict');
const payload=async strokes=>(await import('../frontend/draw/submission.js')).submissionPayload(strokes);

test('submission retains each Mono ink color but leaves gold and legacy serialization compatible',async()=>{
  const result=await payload([
    {material:'mono-v1',color:'#2f6972',ledWidth:2,points:[{x:1,y:2,p:.6}]},
    {material:'mono-v1',color:'#E7BD00',ledWidth:2,points:[{x:3,y:4}]},
    {color:'#1264A3',ledWidth:2,points:[{x:5,y:6}]},
    {erase:true,color:'#2F6972',points:[{x:7,y:8}]},
  ]);
  assert.equal(result.strokes[0].color,'#2F6972');
  for(const stroke of result.strokes.slice(1))assert.equal('color' in stroke,false);
});

test('submission keeps Mono coordinates, width and pressure, including zero and default pressure',async()=>{
  const result=await payload([{material:'mono-v1',ledWidth:2.5,points:[{x:0,y:720,p:0},{x:23.75,y:100.125,p:.8},{x:40,y:50}]}]);
  assert.deepEqual(result,{version:2,profile:'led-2px',strokes:[{erase:false,width:2.5,material:'mono-v1',points:[[0,720,0],[23.75,100.125,.8],[40,50,.55]]}]});
});

test('submission eraser carries only erase and coordinates, not ink metadata',async()=>{
  const result=await payload([{erase:true,material:'graphite-v1',seed:7,ledWidth:3,points:[{x:10,y:20,p:.9}]}]);
  assert.deepEqual(result.strokes,[{erase:true,points:[[10,20]]}]);
});

test('submission preserves solid legacy density and its serialized representation',async()=>{
  const result=await payload([{color:'#FFD700',ledWidth:2,points:[{x:50,y:60,p:.1}]}]);
  assert.equal(JSON.stringify(result),'{"version":2,"profile":"led-2px","strokes":[{"erase":false,"width":2,"material":"mono-v1","points":[[50,60,1]]}]}');
});

test('submission preserves graphite seed and mixed stroke ordering',async()=>{
  const result=await payload([
    {material:'graphite-v1',seed:0,ledWidth:1,points:[{x:1,y:2,p:.4}]},
    {material:'mono-v1',ledWidth:3,points:[{x:3,y:4,p:1}]},
    {erase:true,points:[{x:5,y:6}]},
  ]);
  assert.deepEqual(result.strokes,[
    {erase:false,width:1,material:'graphite-v1',seed:0,points:[[1,2,.4]]},
    {erase:false,width:3,material:'mono-v1',points:[[3,4,1]]},
    {erase:true,points:[[5,6]]},
  ]);
});

test('submission is deterministic and never mutates or aliases its input points',async()=>{
  const strokes=Object.freeze([Object.freeze({material:'mono-v1',ledWidth:2,points:Object.freeze([Object.freeze({x:7,y:8,p:.6})])})]);
  const first=await payload(strokes),second=await payload(strokes);
  assert.deepEqual(first,second);
  first.strokes[0].points[0][0]=999;
  assert.equal(strokes[0].points[0].x,7);
  assert.equal(second.strokes[0].points[0][0],7);
  assert.deepEqual(await payload([]),{version:2,profile:'led-2px',strokes:[]});
});
