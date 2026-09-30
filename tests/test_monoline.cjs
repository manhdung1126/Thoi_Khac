const test=require('node:test');const assert=require('node:assert/strict');

test('Mono line keeps dots round, width constant and pressure-independent',async()=>{
  const {paintMonoStroke}=await import('../frontend/shared/monoline.js');
  const marks=[];const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},arc(...args){marks.push(['dot',args,this.lineWidth]);},fill(){},stroke(){marks.push(['stroke',this.lineWidth,this.lineCap,this.lineJoin]);}};
  paintMonoStroke(ctx,{points:[{x:8,y:9,pressure:.01}],width:11.8,color:'#FFD700'});
  paintMonoStroke(ctx,{points:[{x:0,y:0,pressure:.01},{x:20,y:20,pressure:1}],width:11.8,color:'#FFD700'});
  assert.equal(marks[0][2],11.8);assert.deepEqual(marks[0][1].slice(0,3),[8,9,5.9]);
  assert.deepEqual(marks[1],['stroke',11.8,'round','round']);
});

test('Mono smoothing stays between real samples and preserves an abrupt corner',async()=>{
  const {traceMonoPath}=await import('../frontend/shared/monoline.js');
  const commands=[];const ctx={moveTo(...v){commands.push(['M',...v]);},lineTo(...v){commands.push(['L',...v]);},quadraticCurveTo(...v){commands.push(['Q',...v]);}};
  traceMonoPath(ctx,[{x:0,y:0},{x:10,y:0},{x:20,y:1},{x:20,y:20}]);
  assert.ok(commands.some(command=>command[0]==='Q'));
  assert.ok(commands.some(command=>command[0]==='L'&&command[1]===20&&command[2]===1));
  for(const command of commands)for(let i=1;i<command.length;i+=2){assert.ok(command[i]>=0&&command[i]<=20);assert.ok(command[i+1]>=0&&command[i+1]<=20);}
  assert.deepEqual(commands.at(-1),['L',20,20]);
});

test('Mono stabilization removes small finger jitter but keeps exact endpoints and corners',async()=>{
  const {stabilizeMonoPoints}=await import('../frontend/shared/monoline.js');
  const raw=[{x:0,y:0},{x:5,y:.8},{x:10,y:-.7},{x:15,y:.6},{x:20,y:0}];
  const stable=stabilizeMonoPoints(raw);
  assert.deepEqual(stable[0],raw[0]);assert.deepEqual(stable.at(-1),raw.at(-1));
  assert.ok(Math.max(...stable.slice(1,-1).map(point=>Math.abs(point.y)))<.8);
  const corner=[{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  assert.deepEqual(stabilizeMonoPoints(corner),corner);
});
