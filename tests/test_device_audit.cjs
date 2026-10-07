const {test}=require('node:test');
const assert=require('node:assert/strict');

test('device audit summaries distinguish no samples and bounded samples without mutating data',async()=>{
  const {timingSummary}=await import('../benchmarks/device-audit.js');
  assert.deepEqual(timingSummary(),{count:0,total:0,median:null,p95:null,max:null,sampled:0,truncated:false});
  const entry={count:5,total:40,max:20,values:[9,1,6,4]};
  assert.deepEqual(timingSummary(entry),{count:5,total:40,median:4,p95:9,max:20,sampled:4,truncated:true});
  assert.deepEqual(entry.values,[9,1,6,4]);
});
