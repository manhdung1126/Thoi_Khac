// Opt-in companion to performance.py. Never connects to the exhibition server.
import {readFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=JSON.parse(await readFile(process.argv[2],'utf8'));
const samples=Number(process.argv[3]||8);
const controlOnly=process.argv.includes('--control-only');
const endingOnly=process.argv.includes('--ending-only');
const profileLibrary=process.argv.includes('--profile-library');
const repeatSearch=process.argv.includes('--repeat-search');
const searchShapes=process.argv.includes('--search-shapes');
const auditLibraryGeometry=process.argv.includes('--audit-library-geometry');
const captureDirectory=process.argv.includes('--capture-control')?process.argv[process.argv.indexOf('--capture-control')+1]:null;
const stats=values=>{
  if(!values.length)return {n:0};
  const a=[...values].sort((x,y)=>x-y),mid=Math.floor(a.length/2);
  return {n:a.length,median_ms:a.length%2?a[mid]:(a[mid-1]+a[mid])/2,p95_ms:a[Math.ceil(a.length*.95)-1],max_ms:a.at(-1)};
};
function instrumentation(passive=false){
  const events=[],longTasks=[],frames=[];
  let mutations=0,last=null;
  const changed=new Set();
  const nativeRaf=window.requestAnimationFrame.bind(window);
  const bench=window.__bench={events,longTasks,frames,
    record(name,ms){events.push({name,ms});},
    wrap(fn,name){return function(...args){const start=performance.now();try{
      if(name==='EndingPreview.prepare')bench.preview=this;
      return fn.apply(this,args);
    }finally{bench.record(name,performance.now()-start);}};},
    wrapAsync(fn,name){return async function(...args){const start=performance.now();try{return await fn.apply(this,args);}finally{events.push({name,ms:performance.now()-start,start,end:performance.now(),id:name==='ending.loadArtwork'?args[0].id:undefined});}};},
    reset(keepFrame=false){events.length=longTasks.length=frames.length=0;if(!keepFrame)last=null;mutations=0;changed.clear();performance.clearResourceTimings();},
    read(){return {events:[...events],longTasks:[...longTasks],frames:[...frames],mutations,changedNodes:changed.size,
      resources:performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/')).map(e=>({url:e.name,transfer:e.transferSize,encoded:e.encodedBodySize,decoded:e.decodedBodySize,duration:e.duration,start:e.startTime,end:e.responseEnd}))};}
  };
  // Ending may load 2,700 assets. Do not silently truncate at Chrome's
  // default 250 ResourceTiming entries.
  performance.setResourceTimingBufferSize(20000);
  const loop=t=>{if(last!==null)frames.push(t-last);last=t;nativeRaf(loop);};nativeRaf(loop);
  try{new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push(entry.duration);}).observe({type:'longtask',buffered:false});}catch{}
  if(passive)return; // Independent check: no source, function, or DOM hooks.
  window.requestAnimationFrame=fn=>nativeRaf(t=>{const start=performance.now();try{return fn(t);}finally{bench.record('raf.callback',performance.now()-start);}});
  const observe=()=>new MutationObserver(list=>{mutations+=list.length;for(const record of list){if(record.target.closest?.('#library')){changed.add(record.target);for(const n of [...record.addedNodes,...record.removedNodes])changed.add(n);}}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
  if(document.documentElement)observe();else document.addEventListener('DOMContentLoaded',observe,{once:true});
  const originalFetch=window.fetch;
  window.fetch=async function(...args){const start=performance.now();try{return await originalFetch.apply(this,args);}finally{bench.record('fetch.headers',performance.now()-start);}};
  const json=Response.prototype.json;
  Response.prototype.json=bench.wrapAsync(json,'response.json.body_read_parse');
  const decode=HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode=bench.wrapAsync(decode,'image.decode.await');
  const readback=CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData=bench.wrap(readback,'canvas.readback');
  const NativeSocket=window.WebSocket;
  bench.sockets=[];
  window.WebSocket=class extends NativeSocket{constructor(...args){super(...args);bench.sockets.push(this);}};
}

// These decorators exist only in intercepted benchmark responses. Repository
// source stays untouched. Route instrumentation disables Chromium HTTP cache;
// cache probes below deliberately use a separate context with no routes.
const hooks={
  '/control/app.js': ['renderControl','renderCells','renderLibrary','renderSnapshots'].map(n=>`${n}=window.__bench.wrap(${n},'control.${n}');`).join('\n'),
  '/draw/app.js': ['renderActive','appendEvents','changed','persist'].map(n=>`${n}=window.__bench.wrap(${n},'draw.${n}');`).join('\n'),
  '/ending/composition.js': "compose=window.__bench.wrap(compose,'ending.compose');",
  '/ending/flow.js': "simulateCloud=window.__bench.wrap(simulateCloud,'ending.simulateCloud');",
  '/ending/motion.js': "planMotion=window.__bench.wrap(planMotion,'ending.planMotion');",
  '/ending/assets.js': "loadArtwork=window.__bench.wrapAsync(loadArtwork,'ending.loadArtwork');",
  '/ending/preview.js': "EndingPreview.prototype.prepare=window.__bench.wrap(EndingPreview.prototype.prepare,'EndingPreview.prepare');EndingPreview.prototype.draw=window.__bench.wrap(EndingPreview.prototype.draw,'EndingPreview.draw');",
  '/ending/session.js': "EndingPresentation.prototype.prepare=window.__bench.wrapAsync(EndingPresentation.prototype.prepare,'EndingPresentation.prepare');",
  '/display/led-scene.js': "LEDScene.prototype.render=window.__bench.wrap(LEDScene.prototype.render,'LEDScene.render');LEDScene.prototype.animateShine=window.__bench.wrap(LEDScene.prototype.animateShine,'LEDScene.animateShine');",
};
function libraryProfileSource(source){
  // Optional stage profiling: exact markers fail loudly if the pipeline
  // changes. These additions are served only in benchmark responses.
  const markers=[
    ['  const query = $("#library-search").value.trim().toLowerCase();',"  let profileStart=performance.now();\n  const query = $(\"#library-search\").value.trim().toLowerCase();\n  __bench.record('library.normalize',performance.now()-profileStart);profileStart=performance.now();"],
    ['  const drawings = state.drawings.filter(drawing => {',"  __bench.record('library.membership',performance.now()-profileStart);profileStart=performance.now();\n  const filtered = state.drawings.filter(drawing => {"],
    ['  }).slice().sort((a, b) => b.created_at - a.created_at);',"  });\n  __bench.record('library.filter',performance.now()-profileStart);profileStart=performance.now();\n  const drawings=filtered.slice().sort((a,b)=>b.created_at-a.created_at);\n  __bench.record('library.sort',performance.now()-profileStart);"],
  ];
  for(const [from,to] of markers){if(!source.includes(from))throw Error('Library profile anchor changed: '+from);source=source.replace(from,to);}
  const anchor='const subscription = subscribeState';
  const wrapper=`
  {
    const original=renderLibrary;
    renderLibrary=function(...args){
      __bench.libraryProfile={};
      try{return original.apply(this,args);}finally{
        for(const [name,entry] of Object.entries(__bench.libraryProfile)){
          __bench.record('library.dom.'+name,entry.ms);
          __bench.record('library.calls.'+name,entry.count);
        }
        __bench.libraryProfile=null;
      }
    };
    const timed=(name,fn)=>function(...args){
      const profile=__bench.libraryProfile;if(!profile)return fn.apply(this,args);
      const start=performance.now();try{return fn.apply(this,args);}finally{
        const entry=profile[name]||(profile[name]={ms:0,count:0});
        entry.ms+=performance.now()-start;entry.count++;
      }
    };
    for(const [proto,key,name] of [[Document.prototype,'createElement','create'],[Element.prototype,'append','insert'],[Element.prototype,'before','insert'],[DocumentFragment.prototype,'append','insert'],[Node.prototype,'insertBefore','insert'],[Element.prototype,'remove','remove'],[Element.prototype,'replaceWith','replace'],[Element.prototype,'replaceChildren','clear'],[EventTarget.prototype,'addEventListener','addEventListener'],[Element.prototype,'setAttribute','attributes'],[DOMTokenList.prototype,'add','classes'],[DOMTokenList.prototype,'toggle','classes']])proto[key]=timed(name,proto[key]);
    for(const [proto,key,name] of [[HTMLImageElement.prototype,'src','image_src'],[Node.prototype,'textContent','text']]){
      const descriptor=Object.getOwnPropertyDescriptor(proto,key);
      Object.defineProperty(proto,key,{...descriptor,set:timed(name,descriptor.set)});
    }
  }
  `;
  return source.replace(anchor,wrapper+'\n'+anchor);
}
function endingProfileSource(source){
  // Response-only timers: preserve operations/order; never write frontend files.
  const markers=[
    ["const pixels=ctx.getImageData", "let profileStart=performance.now();const pixels=ctx.getImageData"],
    ["  for(let y=0;y<280;y++)", "  __bench.record('asset.readback_stage',performance.now()-profileStart);profileStart=performance.now();\n  for(let y=0;y<280;y++)"],
    ["  if(right<left)", "  __bench.record('asset.alpha_bounds',performance.now()-profileStart);profileStart=performance.now();\n  if(right<left)"],
    ["  // Retain a compact texture", "  __bench.record('asset.material',performance.now()-profileStart);profileStart=performance.now();\n  // Retain a compact texture"],
    ["  const ratio=160/280;", "  __bench.record('asset.texture',performance.now()-profileStart);\n  const ratio=160/280;"],
  ];
  for(const [from,to] of markers){assert.ok(source.includes(from),'Ending profile anchor changed: '+from);source=source.replace(from,to);}
  return source;
}
async function context(browser,{instrument=true,dpr=1,passive=false}={}){
  const ctx=await browser.newContext({viewport:{width:1536,height:768},deviceScaleFactor:dpr});
  await ctx.addInitScript(instrumentation,passive);
  if(instrument)await ctx.route('**/*.js*',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(!hooks[pathname])return route.continue();
    let source=await readFile(path.join(root,'frontend',pathname),'utf8');
    if(endingOnly&&pathname==='/ending/assets.js')source=endingProfileSource(source);
    if(pathname==='/control/app.js'){
      // Decorate before listeners capture function references, including search.
      const anchor='const subscription = subscribeState';
      if(!source.includes(anchor))throw Error('Control profiling anchor changed');
      source=source.replace(anchor,hooks[pathname]+'\n'+anchor);
      if(profileLibrary)source=libraryProfileSource(source);
    }else source+='\n'+hooks[pathname];
    return route.fulfill({status:200,contentType:'text/javascript',body:source});
  });
  return ctx;
}
const reset=page=>page.evaluate(()=>window.__bench.reset());
const take=page=>page.evaluate(()=>window.__bench.read());
const paint=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const elapsedEvents=(data,name)=>stats(data.events.filter(e=>e.name===name).map(e=>e.ms));
function endingBreakdown(data){
  const groups={};
  for(const resource of data.resources){
    const path=new URL(resource.url).pathname;
    const category=path.startsWith('/api/strokes/')?'vector':path.startsWith('/api/drawings/')?'svg':'state_and_ack';
    const group=groups[category]||= {requests:0,transfer_bytes:0,encoded_bytes:0,zero_transfer_entries:0,urls:new Set(),durations:[]};
    group.requests++;group.transfer_bytes+=resource.transfer;group.encoded_bytes+=resource.encoded;
    group.zero_transfer_entries+=resource.transfer===0?1:0;group.urls.add(path);group.durations.push(resource.duration);
  }
  const assets=data.events.filter(e=>e.name==='ending.loadArtwork');
  const edges=assets.flatMap(e=>[[e.start,1],[e.end,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let active=0,max=0;for(const [,delta] of edges){active+=delta;max=Math.max(max,active);}
  const span=edges.length?edges.at(-1)[0]-edges[0][0]:0;
  return {resources:Object.fromEntries(Object.entries(groups).map(([key,g])=>[key,{...g,urls:undefined,durations:undefined,unique_urls:g.urls.size,repeated_url_entries:g.requests-g.urls.size,duration:stats(g.durations)}])),
    artwork_workers:{calls:assets.length,max_inflight:max,span_ms:span,slot_utilization:span?assets.reduce((s,e)=>s+e.ms,0)/(6*span):null},
    note:'Resource entries are not all network transfers. Slot utilization counts async waits, not CPU. Zero transfer suggests cache; CDP asset probes independently verify it.'};
}
function summarize(data){
  const names=[...new Set(data.events.map(e=>e.name))],a=[...data.frames].sort((x,y)=>x-y);
  const cadence=a.length?a[Math.floor(a.length/2)]:0;
  return {functions:Object.fromEntries(names.map(name=>[name,elapsedEvents(data,name)])),
    frame:stats(data.frames),long_tasks:stats(data.longTasks),mutation_records:data.mutations,
    // An rAF-gap proxy, not compositor/GPU dropped-frame telemetry.
    raf_gaps_over_1_5x_median:cadence?data.frames.filter(t=>t>cadence*1.5).length:0,
    resource_requests:data.resources.length,transfer_bytes:data.resources.reduce((n,r)=>n+r.transfer,0),
    encoded_body_bytes:data.resources.reduce((n,r)=>n+r.encoded,0)};
}
async function startServer(storage){
  const server=spawn(path.join(root,'.venv/bin/python'),['-m','uvicorn','backend.app.main:app','--host','127.0.0.1','--port','0'],
    {cwd:root,env:{...process.env,CLOUD_STORAGE_DIR:storage,CLOUD_ADMIN_PIN:'2468',NO_COLOR:'1'},stdio:['ignore','ignore','pipe']});
  try{
  const origin=await new Promise((resolve,reject)=>{
    let log='';const timeout=setTimeout(()=>reject(Error('Temporary server startup timed out: '+log)),15000);
    server.on('error',e=>{clearTimeout(timeout);reject(e);});
    server.on('exit',code=>{clearTimeout(timeout);reject(Error('Temporary server exited: '+code+' '+log));});
    server.stderr.on('data',chunk=>{log=(log+chunk).slice(-3000);const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});
  });
  const health=await fetch(origin+'/api/health');if(health.status!==200)throw Error('Temporary server health failed');
  return {server,origin};
  }catch(error){await stopServer(server);throw error;}
}
async function stopServer(server){
  if(server.exitCode===null&&server.signalCode===null){const stopped=once(server,'exit'),timer=setTimeout(()=>server.kill('SIGKILL'),5000);server.kill('SIGTERM');try{await stopped;}finally{clearTimeout(timer);}}
}
async function control(browser,origin){
  const ctx=await context(browser),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const start=performance.now();await page.goto(origin+'/control/');
  await page.locator('#page-select option').first().waitFor({state:'attached'});
  await page.getByLabel('Mã quản lý',{exact:true}).fill('2468');
  await page.getByRole('dialog').getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await page.locator('#login-dialog').waitFor({state:'hidden'});
  await page.waitForLoadState('networkidle');await paint(page);
  const initial={navigation_to_settled_ms:performance.now()-start,...summarize(await take(page)),
    dom_nodes:await page.locator('*').count(),mounted_cards:await page.locator('#library article').count()};
  const result={cache:'HTTP cache disabled by isolated source instrumentation; LED in-process cache retained',initial,operations:{}};
  let cdp;
  if(profileLibrary){
    cdp=await ctx.newCDPSession(page);await cdp.send('Performance.enable');
    result.chromeBefore=(await cdp.send('Performance.getMetrics')).metrics;
    await cdp.send('Tracing.start',{categories:'devtools.timeline,v8',transferMode:'ReturnAsStream'});
  }
  for(const kind of ['http_refresh','websocket_burst','page_selection','cell_selection','library_search','folder_switch','active_filter','artwork_pager']){
    if(kind==='artwork_pager'&&!await page.locator('#library-next').count())continue;
    await reset(page);const walls=[],mounted=[],nodes=[];
    for(let i=0;i<samples;i++){
      const before=await page.evaluate(()=>__bench.events.filter(e=>e.name==='control.renderControl').length);
      const started=performance.now();
      if(kind==='http_refresh'){
        await page.locator('#refresh-button').click();
        await page.waitForFunction(n=>__bench.events.filter(e=>e.name==='control.renderControl').length>n,before);
      }else if(kind==='websocket_burst'){
        await page.evaluate(()=>{const socket=__bench.sockets.find(s=>s.readyState===WebSocket.OPEN);if(!socket)throw Error('No live benchmark WebSocket');for(let j=0;j<5;j++)socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'state_changed'})}));});
        await page.waitForFunction(n=>__bench.events.filter(e=>e.name==='control.renderControl').length>n,before);
        await page.waitForTimeout(80); // Include the coalesced follow-up HTTP refresh.
      }else if(kind==='page_selection'){
        const options=await page.locator('#page-select option').evaluateAll(nodes=>nodes.map(n=>n.value));
        await page.locator('#page-select').selectOption(options[i%options.length]);
      }else if(kind==='cell_selection')await page.locator('#led-cell-select').selectOption(String(i%27));
      else if(kind==='library_search')await page.locator('#library-search').fill(i%2?'':'ffff');
      else if(kind==='folder_switch')await page.locator(i%2?'#show-active':'#show-favorites').click();
      else if(kind==='active_filter')await page.locator('#only-visible').setChecked(i%2===0);
      else {
        const next=page.locator('#library-next'),previous=page.locator('#library-prev');
        if(await next.isEnabled())await next.click();else if(await previous.isEnabled())await previous.click();
      }
      await paint(page);walls.push(performance.now()-started);
      mounted.push(await page.locator('#library article').count());nodes.push(await page.locator('*').count());
    }
    result.operations[kind]={wall:stats(walls),...summarize(await take(page)),mounted_cards_max:Math.max(...mounted),dom_nodes_max:Math.max(...nodes)};
  }
  if(cdp){
    result.chromeAfter=(await cdp.send('Performance.getMetrics')).metrics;
    const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
    await cdp.send('Tracing.end');const {stream}=await complete;let raw='';
    for(;;){const item=await cdp.send('IO.read',{handle:stream});raw+=item.data;if(item.eof)break;}
    await cdp.send('IO.close',{handle:stream});
    const events=JSON.parse(raw).traceEvents.filter(e=>e.ph==='X'&&e.dur!==undefined);
    result.chromeTrace={};
    for(const name of ['Layout','UpdateLayoutTree','MinorGC','MajorGC']){
      const selected=events.filter(e=>e.name===name);
      result.chromeTrace[name]={count:selected.length,total_ms:selected.reduce((n,e)=>n+e.dur/1000,0),...stats(selected.map(e=>e.dur/1000))};
    }
  }
  if(repeatSearch){
    await page.waitForLoadState('networkidle');await paint(page);await reset(page);
    const walls=[];
    for(let i=0;i<samples;i++){
      const start=performance.now();await page.locator('#library-search').fill(i%2?'':'ffff');
      await paint(page);walls.push(performance.now()-start);
    }
    result.warmSearch={wall:stats(walls),...summarize(await take(page))};
  }
  result.errors=errors;await ctx.close();return result;
}

async function controlUnmodified(browser,origin){
  const ctx=await context(browser,{instrument:false,passive:true}),page=await ctx.newPage();
  try{
    await page.goto(origin+'/control/');
    await page.locator('#page-select option').first().waitFor({state:'attached'});
    await page.getByLabel('Mã quản lý',{exact:true}).fill('2468');
    await page.getByRole('dialog').getByRole('button',{name:'Đăng nhập',exact:true}).click();
    await page.locator('#login-dialog').waitFor({state:'hidden'});
    await page.waitForLoadState('networkidle');await paint(page);await reset(page);
    const walls=[];
    for(let i=0;i<samples;i++){
      const start=performance.now();
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state');
      await page.locator('#refresh-button').click();await response;await paint(page);
      walls.push(performance.now()-start);
    }
    return {cache:'Native browser cache; passive rAF/long-task/resource observation only',wall:stats(walls),...summarize(await take(page))};
  }finally{await ctx.close();}
}

async function searchCases(browser,origin){
  const ctx=await context(browser),page=await ctx.newPage(),result={};
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(origin+'/control/');
    await page.locator('#page-select option').first().waitFor({state:'attached'});
    await page.getByLabel('Mã quản lý',{exact:true}).fill('2468');
    await page.getByRole('dialog').getByRole('button',{name:'Đăng nhập',exact:true}).click();
    await page.locator('#login-dialog').waitFor({state:'hidden'});
    await page.waitForLoadState('networkidle');await paint(page);
    const state=await (await page.request.get(origin+'/api/state')).json();
    const cdp=await ctx.newCDPSession(page);
    for(const [name,from,query] of [['A_all','',''],['B_almost_all','','aaaa'],['C_half','','bbbb'],['D_few','','dddd'],['E_zero','','zzzz'],['F_clear','dddd','']]){
      const observations=[];
      for(let i=0;i<samples;i++){
        await page.locator('#library-search').fill(from);await paint(page);
        await page.evaluate(()=>__bench.reset(true));
        if(profileLibrary)await cdp.send('Tracing.start',{categories:'devtools.timeline,v8',transferMode:'ReturnAsStream'});
        const before=await page.locator('*').count();
        // Dispatch even an unchanged empty value, to measure A's invalidation.
        await page.locator('#library-search').evaluate((input,q)=>{input.value=q;input.dispatchEvent(new Event('input',{bubbles:true}));},query);
        await paint(page);await page.waitForTimeout(60);
        const data=await take(page);
        const observation={...summarize(data),changed_nodes:data.changedNodes,dom_before:before,dom_after:await page.locator('*').count(),matches:await page.locator('#library article').count()};
        observation.cards_inspected=state.drawings.length;
        const expected=state.drawings.filter(d=>!d.deleted&&d.id.toLowerCase().includes(query)).sort((a,b)=>b.created_at-a.created_at);
        const paginated=await page.locator('#library-next').count();
        if(paginated)assert.ok(observation.matches<=100&&(expected.length===0||observation.matches>0));
        observation.filtered_count=expected.length;
        assert.deepEqual(await page.locator('#library article img').evaluateAll(images=>images.map(img=>new URL(img.src).pathname)),(paginated?expected.slice(0,observation.matches):expected).map(d=>d.image_path));
        assert.equal(await page.locator('#library-count').textContent(),String(expected.length));
        if(profileLibrary){
          const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
          await cdp.send('Tracing.end');const {stream}=await complete;let raw='';
          for(;;){const item=await cdp.send('IO.read',{handle:stream});raw+=item.data;if(item.eof)break;}
          await cdp.send('IO.close',{handle:stream});
          const events=JSON.parse(raw).traceEvents.filter(e=>e.ph==='X'&&e.dur!==undefined);
          observation.trace=Object.fromEntries(['Layout','UpdateLayoutTree','MinorGC','MajorGC'].map(name=>[name,events.filter(e=>e.name===name).reduce((sum,e)=>sum+e.dur/1000,0)]));
        }
        observations.push(observation);
      }
      result[name]={query,observations};
    }
    assert.deepEqual(errors,[]);return result;
  }finally{await ctx.close();}
}

async function captureControl(browser,origin){
  await mkdir(captureDirectory,{recursive:true});
  const ctx=await context(browser,{instrument:false,passive:true}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(origin+'/control/');
    await page.getByLabel('Mã quản lý',{exact:true}).fill('2468');
    const logged=page.waitForResponse(r=>r.url()===origin+'/api/admin/login'&&r.ok());
    await page.getByRole('dialog').getByRole('button',{name:'Đăng nhập',exact:true}).click();
    const headers={Authorization:'Bearer '+(await (await logged).json()).token};
    await page.locator('#login-dialog').waitFor({state:'hidden'});
    const value=await (await page.request.get(origin+'/api/state')).json();
    await page.request.patch(origin+'/api/drawings/'+value.drawings.at(-1).id+'/favorite',{headers,data:{favorite:true}});
    const refreshed=page.waitForResponse(r=>r.url()===origin+'/api/state'&&r.ok());await page.locator('#refresh-button').click();await refreshed;
    await page.locator('#page-select').selectOption(value.pages[1].id);
    await page.locator('#led-cell-select').selectOption('4');
    await page.locator('#notice').waitFor({state:'hidden'});
    const paths=[];
    for(const [name,width,height] of [['desktop',1536,900],['phone',375,812]]){
      await page.setViewportSize({width,height});await paint(page);await page.waitForLoadState('networkidle');
      await page.evaluate(()=>scrollTo(0,0));
      const frame=path.join(captureDirectory,name+'.png');await page.screenshot({path:frame});paths.push(frame);
      if(name==='phone'){
        const library=path.join(captureDirectory,'phone-library.png');await page.locator('.library-panel').screenshot({path:library});paths.push(library);
      }
      const ending=path.join(captureDirectory,name+'-ending.png');await page.locator('#ending-panel').screenshot({path:ending});paths.push(ending);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow in review capture');
    }
    assert.deepEqual(errors,[]);
    return {paths,errors};
  }finally{await ctx.close();}
}

async function libraryGeometry(browser,origin){
  const ctx=await context(browser,{instrument:false,passive:true}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
    const login=await page.request.post(origin+'/api/admin/login',{data:{pin:'2468'}});
    assert.equal(login.status(),200);const {token}=await login.json();
    const headers={Authorization:'Bearer '+token};
    const initial=await (await page.request.get(origin+'/api/state')).json();
    // Mixed heights must be represented: the performance fixtures normally
    // contain no favorites. Only this temporary server's data is changed.
    for(const index of [...new Set([0,1,4,7,Math.floor(initial.drawings.length/2),initial.drawings.length-1])]){
      assert.equal((await page.request.patch(origin+'/api/drawings/'+initial.drawings[index].id+'/favorite',{headers,data:{favorite:true}})).status(),200);
    }
    for(const drawing of initial.drawings.slice(0,3))assert.equal((await page.request.delete(origin+'/api/drawings/'+drawing.id,{headers})).status(),200);
    await page.goto(origin+'/control/');
    await page.locator('#page-select option').first().waitFor({state:'attached'});
    await page.getByLabel('Mã quản lý',{exact:true}).fill('2468');
    await page.getByRole('dialog').getByRole('button',{name:'Đăng nhập',exact:true}).click();
    await page.locator('#login-dialog').waitFor({state:'hidden'});
    await page.waitForLoadState('networkidle');await paint(page);
    const measure=()=>page.evaluate(()=>{
      const host=document.querySelector('#library'),style=getComputedStyle(host),box=host.getBoundingClientRect();
      const cards=[...host.querySelectorAll('article')].map(card=>{
        const r=card.getBoundingClientRect(),image=card.querySelector('img').getBoundingClientRect(),actions=card.querySelector('.library-actions').getBoundingClientRect();
        return {id:new URL(card.querySelector('img').src).pathname.split('/').at(-1),top:Math.round((r.top-box.top+host.scrollTop)*100)/100,width:r.width,height:r.height,image_height:image.height,actions_height:actions.height,favorite:!!card.querySelector('a[download]'),button_heights:[...card.querySelectorAll('.library-actions button')].map(b=>b.getBoundingClientRect().height)};
      });
      const rows=new Map();for(const c of cards){const row=rows.get(c.top)||[];row.push(c);rows.set(c.top,row);}
      const unique=values=>[...new Set(values.map(n=>Math.round(n*100)/100))];
      return {viewport:innerWidth,columns:style.gridTemplateColumns.split(' ').length,gap:style.rowGap,host_width:box.width,host_height:box.height,scrollTop:host.scrollTop,scrollHeight:host.scrollHeight,clientHeight:host.clientHeight,count:document.querySelector('#library-count').textContent,mounted:cards.length,document_nodes:document.querySelectorAll('*').length,row_heights:unique([...rows.values()].map(row=>Math.max(...row.map(c=>c.height)))),card_widths:unique(cards.map(c=>c.width)),action_heights:unique(cards.map(c=>c.actions_height)),button_heights:unique(cards.flatMap(c=>c.button_heights)),empty:host.querySelector('.empty')?.textContent||null};
    });
    const geometry=[];
    for(const width of [1920,1536,1200,1100,821,820,600,480,390,320]){
      await page.setViewportSize({width,height:768});await paint(page);
      geometry.push(await measure());
    }
    await page.setViewportSize({width:1536,height:768});await paint(page);
    const folders={};
    for(const [name,id] of [['favorites','#show-favorites'],['trash','#show-trash'],['active','#show-active']]){
      await page.locator(id).click();await paint(page);folders[name]=await measure();
    }
    const setScroll=async()=>{await page.locator('#library').evaluate(host=>{host.scrollTop=Math.min(1200,host.scrollHeight-host.clientHeight);});await paint(page);};
    const scroll={};
    await setScroll();scroll.search_before=await measure();
    await page.locator('#library-search').fill(initial.drawings[4].id);await paint(page);scroll.search_narrow=await measure();
    await page.locator('#library-search').fill('');await paint(page);scroll.search_clear=await measure();
    await setScroll();scroll.zero_before=await measure();
    await page.locator('#library-search').fill('zzzz');await paint(page);scroll.zero=await measure();
    await page.locator('#library-search').fill('');await paint(page);scroll.zero_clear=await measure();
    await setScroll();scroll.cell_before=await measure();await page.locator('#led-cell-select').selectOption('4');await paint(page);scroll.cell_after=await measure();
    await setScroll();scroll.page_before=await measure();
    const options=await page.locator('#page-select option').evaluateAll(nodes=>nodes.map(n=>n.value));
    await page.locator('#page-select').selectOption(options.at(-1));await paint(page);scroll.page_after=await measure();
    await setScroll();scroll.refresh_before=await measure();
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state');
    await page.locator('#refresh-button').click();await response;await paint(page);scroll.refresh_after=await measure();
    await setScroll();scroll.folder_before=await measure();await page.locator('#show-favorites').click();await paint(page);scroll.folder_after=await measure();
    await page.locator('#show-active').click();await paint(page);scroll.folder_return=await measure();
    const first=page.locator('#library article').first().locator('.favorite-button');
    await first.focus();
    await page.evaluate(()=>{window.geometryFocused=document.activeElement;});
    await page.locator('#library').evaluate(host=>{host.scrollTop=host.scrollHeight;});await paint(page);
    const focusAfterScroll=await page.evaluate(()=>({same:document.activeElement===window.geometryFocused,connected:window.geometryFocused.isConnected,tag:document.activeElement.tagName}));
    // Native Tab can reach actions anywhere in the current full collection.
    const last=page.locator('#library article').last().locator('.favorite-button');await last.focus();
    await page.keyboard.press('Tab');const tab=await page.evaluate(()=>({text:document.activeElement.textContent,card:document.activeElement.closest('.library-card')?.querySelector('img').alt,scrollTop:document.querySelector('#library').scrollTop}));
    const semantics=await page.locator('#library').evaluate(host=>({tag:host.tagName,role:host.getAttribute('role'),card_tag:host.querySelector('article')?.tagName,card_role:host.querySelector('article')?.getAttribute('role'),tabindex:host.getAttribute('tabindex')}));
    assert.equal(focusAfterScroll.same,true);assert.equal(focusAfterScroll.connected,true);assert.deepEqual(errors,[]);
    return {geometry,folders,scroll,focusAfterScroll,tab,semantics,errors};
  }finally{await ctx.close();}
}

async function assets(browser,origin){
  const data=await (await fetch(origin+'/api/state')).json();
  const picked=[data.drawings[0],data.drawings[1]],result=[];
  for(const drawing of picked){
    const groups={'cold-browser':[], 'warm-same-context':[]};
    for(let i=0;i<samples;i++){
      const ctx=await context(browser,{instrument:false}),page=await ctx.newPage();
      try{
        await page.goto(origin+'/');await page.waitForLoadState('networkidle');
        const cdp=await ctx.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:false});
        const network=[];cdp.on('Network.responseReceived',({response})=>{if(response.url.includes('/api/'))network.push({url:response.url,status:response.status,disk:response.fromDiskCache||false});});
        // Each cold sample has a fresh context. The OS/filesystem cache is warm.
        for(const cache of Object.keys(groups)){
          await reset(page);const netStart=network.length;
          const ready_ms=await page.evaluate(async drawing=>{
            const {loadArtwork}=await import('/ending/assets.js');
            const started=performance.now();await loadArtwork(drawing,new AbortController().signal);
            return performance.now()-started;
          },drawing);
          await paint(page);
          groups[cache].push({ready_ms,metrics:await take(page),responses:network.slice(netStart)});
        }
      }finally{await ctx.close();}
    }
    for(const [cache,items] of Object.entries(groups)){
      const metrics={events:items.flatMap(i=>i.metrics.events),longTasks:items.flatMap(i=>i.metrics.longTasks),frames:items.flatMap(i=>i.metrics.frames),mutations:0,resources:items.flatMap(i=>i.metrics.resources)};
      result.push({version:drawing.id===picked[0].id?1:2,cache,ready:stats(items.map(i=>i.ready_ms)),...summarize(metrics),responses:items.flatMap(i=>i.responses)});
    }
  }
  const ctx=await context(browser,{instrument:false}),page=await ctx.newPage();await page.goto(origin+'/');
  const led=await page.evaluate(async drawing=>{
    const {LEDScene}=await import('/display/led-scene.js?v=20261006-exhibition');
    const host=document.createElement('div');document.body.append(host);
    const scene=new LEDScene(host,{animateMetal:false});const cold=[],warm=[];
    try{for(let i=0;i<8;i++){
      scene.cache.clear();let start=performance.now();await scene.asset(drawing);cold.push(performance.now()-start);
      start=performance.now();await scene.asset(drawing);warm.push(performance.now()-start);
    }}finally{scene.destroy();host.remove();}
    return {cold,warm};
  },picked[1]);
  await ctx.close();return {loadArtwork:result,led_asset_fresh_texture:stats(led.cold),led_asset_cached_texture:stats(led.warm)};
}

async function draw(browser,origin){
  const result=[];
  for(const dpr of [1,3])for(const points of [16,256,2000]){
    const ctx=await context(browser,{dpr}),page=await ctx.newPage();
    const gestures=[],moves=[],finishes=[],metrics=[];
    for(let sample=0;sample<Math.min(samples,5);sample++){
      await page.goto(origin+'/draw/');await page.evaluate(()=>localStorage.clear());await page.reload();
      await page.waitForFunction(()=>document.querySelector('#connection-status').textContent==='Đã kết nối');
      await reset(page);
      const measured=await page.evaluate(async count=>{
        const canvas=document.querySelector('#drawing-canvas'),rect=canvas.getBoundingClientRect();
        const items=Array.from({length:count},(_,i)=>({clientX:rect.left+(40+i/(count-1)*620)/720*rect.width,
          clientY:rect.top+(360+110*Math.sin(i*.035))/720*rect.height}));
        const event=(type,p)=>new PointerEvent(type,{...p,pointerId:1,pointerType:'mouse',buttons:type==='pointerup'?0:1,isPrimary:true,bubbles:true,cancelable:true});
        const start=performance.now();canvas.dispatchEvent(event('pointerdown',items[0]));let moveCPU=0;
        // Explicit synthetic coalesced batches; not a claim about hardware sampling.
        for(let i=1;i<count;i+=32){const group=items.slice(i,i+32),e=event('pointermove',group.at(-1));
          Object.defineProperty(e,'getCoalescedEvents',{value:()=>group.map(p=>event('pointermove',p))});
          const t=performance.now();canvas.dispatchEvent(e);moveCPU+=performance.now()-t;
          await new Promise(requestAnimationFrame);
        }
        const ended=performance.now();canvas.dispatchEvent(event('pointerup',items.at(-1)));
        return {gesture_ms:performance.now()-start,move_cpu_ms:moveCPU,finish_ms:performance.now()-ended,
          backing_width:canvas.width};
      },points);
      gestures.push(measured.gesture_ms);moves.push(measured.move_cpu_ms);finishes.push(measured.finish_ms);
      await paint(page);metrics.push(await take(page));
    }
    const micro=await page.evaluate(async ({points,dpr})=>{
      const {samplePoint,paintStroke}=await import('/draw/pencil.js?v=20261006-pressure-cache');
      const {submissionPayload}=await import('/draw/submission.js');
      const stroke={width:2*720/110,ledWidth:2,material:'mono-v1',led:true,erase:false,points:Array.from({length:points},(_,i)=>({x:40+i/(points-1)*620,y:360+110*Math.sin(i*.035),p:.55,t:i*4}))};
      const canvas=document.createElement('canvas');canvas.width=canvas.height=720*dpr;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.scale(dpr,dpr);
      const timing={sample_points:[],paint:[],readback:[],payload:[],json:[]};
      for(let k=0;k<25;k++){
        let t=performance.now(),previous;
        for(const p of stroke.points)previous=samplePoint({clientX:p.x,clientY:p.y,timeStamp:p.t,pointerType:'mouse',type:'pointermove'},{left:0,top:0,width:720,height:720},previous);
        timing.sample_points.push(performance.now()-t);ctx.clearRect(0,0,720,720);
        t=performance.now();paintStroke(ctx,stroke);timing.paint.push(performance.now()-t);
        t=performance.now();ctx.getImageData(0,0,canvas.width,canvas.height);timing.readback.push(performance.now()-t);
        t=performance.now();const payload=submissionPayload([stroke]);timing.payload.push(performance.now()-t);
        t=performance.now();JSON.stringify(payload);timing.json.push(performance.now()-t);
      }
      return timing;
    },{points,dpr});
    const combined={events:metrics.flatMap(m=>m.events),longTasks:metrics.flatMap(m=>m.longTasks),frames:metrics.flatMap(m=>m.frames),mutations:metrics.reduce((n,m)=>n+m.mutations,0),resources:[]};
    result.push({dpr,points,backing:`${720*dpr}x${720*dpr}`,gesture:stats(gestures),pointermove_batch_cpu:stats(moves),completion:stats(finishes),micro:Object.fromEntries(Object.entries(micro).map(([k,v])=>[k,stats(v.slice(3))])),...summarize(combined)});
    await ctx.close();
  }
  return result;
}

async function displayEnding(browser,origin,fixture,nativeCache=false){
  const ctx=await context(browser,{instrument:!nativeCache}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/display/');
  await page.waitForFunction(()=>document.querySelectorAll('.led-cell canvas').length===27);
  await page.waitForTimeout(1400);await reset(page);await page.waitForTimeout(4000);
  const normal=summarize(await take(page));
  if(nativeCache)await page.evaluate(async()=>{
    // Prototype decorators do not intercept requests or disable HTTP cache.
    const {EndingPresentation}=await import('/ending/session.js');
    const {EndingPreview}=await import('/ending/preview.js');
    EndingPresentation.prototype.prepare=__bench.wrapAsync(EndingPresentation.prototype.prepare,'EndingPresentation.prepare');
    EndingPreview.prototype.prepare=__bench.wrap(EndingPreview.prototype.prepare,'EndingPreview.prepare');
    EndingPreview.prototype.draw=__bench.wrap(EndingPreview.prototype.draw,'EndingPreview.draw');
  });
  const login=await page.request.post(origin+'/api/admin/login',{data:{pin:'2468'}}),token=(await login.json()).token;
  const headers={Authorization:'Bearer '+token};
  const preparations=[];
  for(let i=0;i<3;i++){
    await reset(page);const start=performance.now();
    const prepared=await page.request.post(origin+'/api/ending/prepare',{headers,data:{request_id:crypto.randomUUID(),mask:fixture.mask,seed:'perf-baseline'}});
    if(prepared.status()!==200)throw Error('Ending prepare failed: '+await prepared.text());
    const session=(await prepared.json()).ending;
    await page.waitForFunction(count=>__bench.preview?.entries?.length===count&&__bench.events.some(e=>e.name==='EndingPresentation.prepare'),fixture.count,{timeout:55000});
    // Readiness acknowledgement may finish just after texture/trajectory creation.
    await page.waitForFunction(async()=>{const state=await (await fetch('/api/state')).json();return !!state.ending?.ready_displays?.length;},null,{timeout:10000});
    await paint(page);
    const data=await take(page);
    if(endingOnly){
      const vectors=data.resources.filter(e=>new URL(e.url).pathname.startsWith('/api/strokes/'));
      const svgs=data.resources.filter(e=>new URL(e.url).pathname.startsWith('/api/drawings/'));
      assert.equal(vectors.length,fixture.count);assert.equal(svgs.length,Math.floor(fixture.count*4/5));
    }
    preparations.push({ready_ms:performance.now()-start,...summarize(data),...(endingOnly?{breakdown:endingBreakdown(data)}:{})});
    if(i<2){await page.request.post(origin+'/api/ending/'+session.id+'/reset',{headers});await page.waitForFunction(()=>!__bench.preview?.layout);}
  }
  const preparedState=await (await page.request.get(origin+'/api/state')).json();
  await reset(page);
  const startResponse=await page.request.post(origin+'/api/ending/'+preparedState.ending.id+'/start',{headers});
  if(startResponse.status()!==200)throw Error('Ending start failed');
  await page.waitForFunction(()=>__bench.preview?.time>=20,{timeout:35000});
  await paint(page);const playback=summarize(await take(page));
  const stages=await page.evaluate(async ({mask,drawings,cells})=>{
    const {compose}=await import('/ending/composition.js');
    const {planMotion}=await import('/ending/motion.js');
    const {maskFromPixels}=await import('/ending/mask.js');
    const {ENDING_CONFIG}=await import('/ending/config.js');
    const times={mask_sampling:[],compose:[],trajectory_plan:[]};
    const data=new Uint8ClampedArray(256*256*4);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){const p=(y*256+x)*4;data[p]=data[p+1]=data[p+2]=255;data[p+3]=(x-128)**2+(y-128)**2<110**2?255:0;}
    for(let i=0;i<10;i++){
      let t=performance.now();maskFromPixels({data,width:256,height:256});times.mask_sampling.push(performance.now()-t);
      t=performance.now();const targets=compose({...ENDING_CONFIG,drawings,mask,seed:'perf-baseline'});times.compose.push(performance.now()-t);
      t=performance.now();planMotion({...ENDING_CONFIG,targets,seed:'perf-baseline'},cells);times.trajectory_plan.push(performance.now()-t);
    }
    return times;
  },{mask:fixture.mask,drawings:preparedState.ending.drawings,cells:preparedState.ending.cells});
  await page.request.post(origin+'/api/ending/'+preparedState.ending.id+'/reset',{headers});
  await ctx.close();
  return {normal,prepare:preparations,ready:stats(preparations.map(p=>p.ready_ms)),playback,
    stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,stats(v.slice(2))])),errors,
    cache:nativeCache?'Native HTTP cache enabled: first prepare after normal LED loads 27; next two same-context reset/reprepare; no Ending texture cache':'HTTP cache disabled by isolated source instrumentation; filesystem cache warm'};
}

const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
const output={browser:browser.version(),node:process.version,viewport:'1536x768',headless:true,workloads:[]};
try{
  for(const fixture of fixtures){
    const {server,origin}=await startServer(fixture.storage);
    try{
      console.error('Measuring browser '+fixture.name+' ('+fixture.count+' artworks)');
      const measured={name:fixture.name,count:fixture.count,health:200};
      if(endingOnly){
        measured.assets=await assets(browser,origin);
        measured.displayEnding=await displayEnding(browser,origin,fixture);
        measured.displayEndingNativeCache=await displayEnding(browser,origin,fixture,true);
        assert.deepEqual(measured.displayEnding.errors,[]);assert.deepEqual(measured.displayEndingNativeCache.errors,[]);
        output.workloads.push(measured);continue;
      }
      if(auditLibraryGeometry){measured.libraryGeometry=await libraryGeometry(browser,origin);output.workloads.push(measured);continue;}
      measured.control=await control(browser,origin);
      measured.controlUnmodified=await controlUnmodified(browser,origin);
      if(searchShapes)measured.searchCases=await searchCases(browser,origin);
      if(captureDirectory&&fixture.name==='normal')measured.controlReview=await captureControl(browser,origin);
      if(controlOnly){output.workloads.push(measured);continue;}
      console.error(fixture.name+': Control complete; measuring cold/warm assets');
      measured.assets=await assets(browser,origin);
      if(fixture.name==='small'){console.error('Measuring Draw at DPR 1 and 3');measured.draw=await draw(browser,origin);}
      console.error(fixture.name+': measuring Display and full Ending preparation/playback');
      measured.displayEnding=await displayEnding(browser,origin,fixture);
      output.workloads.push(measured);
    }finally{await stopServer(server);}
  }
  process.stdout.write(JSON.stringify(output));
}finally{await browser.close();}
