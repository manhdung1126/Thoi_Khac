// Synthetic gestures prove instrumentation equivalence ONLY, not Safari acceptance.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
let server,browser,origin,storage;
before(async()=>{
  server=spawn(path.join(root,'.venv/bin/python'),['benchmarks/draw_device.py','--host','127.0.0.1'],{cwd:root,stdio:['ignore','pipe','pipe']});
  origin=await new Promise((resolve,reject)=>{
    let out='',errors='';const timer=setTimeout(()=>reject(Error(out+errors)),15000);
    server.on('error',reject);server.on('exit',code=>{clearTimeout(timer);reject(Error(`Audit server ${code}: ${errors}`));});
    server.stderr.on('data',chunk=>{errors+=chunk;});
    server.stdout.on('data',chunk=>{
      out+=chunk;const url=out.match(/http:\/\/127\.0\.0\.1:\d+/),dir=out.match(/Storage: (.+)/);
      if(url&&dir){storage=dir[1];clearTimeout(timer);resolve(url[0]);}
    });
  });
  for(let i=0;i<40;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
},{timeout:30000});
after(async()=>{
  await browser?.close();
  if(server&&server.exitCode===null){const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;}
  if(storage)assert.equal(fs.existsSync(storage),false,'Normal server stop removes its own temporary storage');
});

async function gesture(page,offset){
  await page.evaluate(offset=>{
    const canvas=document.querySelector('#drawing-canvas'),rect=canvas.getBoundingClientRect();
    // Same events/timestamps in both pages; only the test simulates capture.
    let captured=false;canvas.setPointerCapture=()=>{captured=true;};canvas.hasPointerCapture=()=>captured;canvas.releasePointerCapture=()=>{captured=false;};
    const events=[['pointerdown',.25,.3],['pointermove',.32,.34],['pointermove',.4,.44],['pointermove',.55,.4],['pointerup',.62,.42]];
    events.forEach(([type,x,y],index)=>{
      const event=new PointerEvent(type,{pointerId:7,pointerType:'pen',isPrimary:true,pressure:type==='pointerup'?0:.6,
        clientX:rect.left+x*rect.width,clientY:rect.top+(y+offset)*rect.height,bubbles:true,cancelable:true});
      Object.defineProperty(event,'timeStamp',{value:100+index*17});canvas.dispatchEvent(event);
    });
  },offset);
  await page.waitForTimeout(40); // Let the post-pointerup frame run.
}
async function output(page){return page.evaluate(()=>{
  const canvas=document.querySelector('#drawing-canvas'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let hash=2166136261;for(const pixel of pixels)hash=Math.imul(hash^pixel,16777619)>>>0;
  return {hash,strokes:JSON.parse(localStorage.getItem('cloud-strokes-draft-v2')).strokes};
});}
async function downloadReport(page){
  await page.locator('#draw-device-audit summary').click();
  const downloaded=page.waitForEvent('download');await page.locator('[data-download]').click();
  const download=await downloaded;return JSON.parse(fs.readFileSync(await download.path(),'utf8'));
}

test('device harness preserves raster, draft, pressure, eraser, undo and submission retry; exports operation metrics', {timeout:30000},async t=>{
  const contexts=await Promise.all([false,true].map(()=>browser.newContext({viewport:{width:800,height:1050},deviceScaleFactor:2})));
  t.after(()=>Promise.all(contexts.map(context=>context.close())));
  const pages=await Promise.all(contexts.map(context=>context.newPage())),errors=[];
  for(const [index,page] of pages.entries()){
    page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/draw/'+(index?'?perf=1':''));
    await page.locator('#pencil-button').click();await page.locator('[data-stroke-color="#1264A3"]').click();await page.locator('#close-tool-panel').click();
    await gesture(page,0);await gesture(page,.15);
    await page.locator('#eraser-button').click();await gesture(page,0);
    await page.locator('#undo-button').click();await page.locator('#redo-button').click();await page.locator('#undo-button').click();
  }
  assert.equal(await pages[0].locator('#draw-device-audit').count(),0);
  assert.deepEqual(await output(pages[1]),await output(pages[0]));
  const page=pages[1],draft=await page.evaluate(()=>JSON.parse(localStorage.getItem('cloud-strokes-draft-v2')));
  let attempts=0;const submissions=[];
  await page.route(origin+'/api/drawings',route=>{attempts++;submissions.push(route.request().postData());return attempts===1?route.abort('failed'):route.continue();});
  await page.locator('#send-button').click();await page.waitForFunction(()=>document.querySelector('#upload-status').classList.contains('error'));
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('cloud-strokes-draft-v2')).submissionId),draft.submissionId);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('cloud-strokes-draft-v2')).strokes),draft.strokes);
  await page.locator('#send-button').click();await page.waitForFunction(()=>document.querySelector('#upload-status').classList.contains('success'));
  assert.equal(attempts,2);for(const submission of submissions)assert.ok(submission.includes(draft.submissionId));
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('cloud-strokes-draft-v2')).strokes),[]);
  assert.equal(await page.locator('#send-button').isDisabled(),true);
  const state=await (await page.request.get(origin+'/api/state')).json();assert.equal(state.drawings.length,1);
  const saved=await (await page.request.get(origin+state.drawings[0].vector_path)).json();
  const {submissionPayload}=await import('../../frontend/draw/submission.js');assert.deepEqual(saved,submissionPayload(draft.strokes));
  const data=await downloadReport(page),metrics=data.runs.at(-1).metrics;
  for(const name of ['pointermove','pointer_up_completion','canvas_readback','alpha_check','changed','draft','ui','undo','redo','eraser_finish',
    'submit_payload_transform','submit_payload_json','submit_local_preparation','submit_request','submit_to_success_ui','clear_after_submit','raf_interval'])assert.ok(metrics[name]?.count>0,name);
  assert.equal(data.runs[0].strokes.length,3);assert.equal(data.runs[0].strokes[2].erase,true);
  assert.equal(data.runs[0].strokes[0].trusted,false);assert.equal(data.humanSafariConfirmation,false);
  assert.deepEqual(data.device.canvas,{width:1440,height:1440,cssWidth:await page.locator('#drawing-canvas').evaluate(c=>c.getBoundingClientRect().width),cssHeight:await page.locator('#drawing-canvas').evaluate(c=>c.getBoundingClientRect().height)});
  assert.equal(data.network.filter(item=>item.path==='/api/drawings'&&item.result==='error').length,1);
  assert.equal(data.network.filter(item=>item.path==='/api/drawings'&&item.result==='ok').length,1);
  assert.ok(data.network.filter(item=>item.path==='/api/drawings').every(item=>item.submissionId===draft.submissionId));
  assert.deepEqual(errors,[]);
});

test('device harness labels unsupported Long Tasks and offers LAN copy fallback, manual context and separate cases', {timeout:15000},async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  await context.addInitScript(()=>{window.PerformanceObserver=undefined;Object.defineProperty(navigator,'clipboard',{value:undefined});});
  const page=await context.newPage();await page.goto(origin+'/draw/?perf=1');
  await page.locator('#draw-device-audit summary').click();await page.locator('[data-model]').fill('Test harness, NOT physical iPad');
  await page.locator('[data-os]').fill('Not Safari evidence');await page.locator('[data-case]').selectOption('D');
  await page.locator('[data-start]').click();await page.locator('[data-copy]').click();
  const report=JSON.parse(await page.locator('[data-result]').inputValue());
  assert.equal(report.device.model,'Test harness, NOT physical iPad');assert.equal(report.runs.length,2);assert.equal(report.runs[1].case,'D');
  assert.equal(report.runs[1].longTasks.available,false);assert.equal(report.runs[1].longTasks.timing,null);
  assert.match(report.manualClear,/NOT_AVAILABLE/);assert.equal(report.classification,'NEEDS_MORE_DEVICE_EVIDENCE');
});
