// Loaded only by the temporary LAN audit server, with ?perf=1.
const SAMPLE_LIMIT=4096;
export function timingSummary(entry){
  if(!entry)return {count:0,total:0,median:null,p95:null,max:null,sampled:0,truncated:false};
  const sorted=[...entry.values].sort((a,b)=>a-b),rank=p=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??null;
  return {count:entry.count,total:entry.total,median:rank(.5),p95:rank(.95),max:entry.max,sampled:sorted.length,truncated:entry.count>sorted.length};
}

export function startAudit(){
  const session=new Date().toISOString(),runs=[],cleanup=[],network=[];
  let canvas,getState,frame=0,lastFrame=null,afterUp=null,observer;
  const metadata=()=>({userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},dpr:devicePixelRatio,
    canvas:canvas?{width:canvas.width,height:canvas.height,cssWidth:canvas.getBoundingClientRect().width,cssHeight:canvas.getBoundingClientRect().height}:null,
    orientation:innerWidth>innerHeight?'landscape':'portrait',online:navigator.onLine});
  const newRun=caseId=>({case:caseId,started:new Date().toISOString(),device:metadata(),metrics:{},strokes:[],events:[],notes:''});
  let run=newRun('A');
  function record(name,duration){
    const entry=run.metrics[name]??={count:0,total:0,max:0,values:[]};
    entry.count++;entry.total+=duration;entry.max=Math.max(entry.max,duration);
    // ponytail: first 4096 samples bound memory; export labels truncated quantiles.
    if(entry.values.length<SAMPLE_LIMIT)entry.values.push(duration);
  }
  function measure(name,fn){const start=performance.now();try{return fn();}finally{record(name,performance.now()-start);}}
  const wrap=(fn,name)=>function(...args){return measure(name,()=>fn.apply(this,args));};
  function tick(now){
    frame=0;
    if(document.hidden){lastFrame=null;return;}
    if(lastFrame!==null)record('raf_interval',now-lastFrame);
    lastFrame=now;
    if(afterUp!==null){record('pointer_up_to_next_raf',performance.now()-afterUp);afterUp=null;}
    if(document.body.classList.contains('is-drawing'))frame=requestAnimationFrame(tick);else lastFrame=null;
  }
  function startFrames(){if(!frame&&!document.hidden){lastFrame=performance.now();frame=requestAnimationFrame(tick);}}
  function finish(fn,active){return function(event){
    const current=active();if(!current||current.id!==event.pointerId)return fn.call(this,event);
    const start=performance.now();
    try{return fn.call(this,event);}finally{
      const duration=performance.now()-start;
      record(event.type==='pointerup'?'pointer_up_completion':'cancel_completion',duration);
      if(current.stroke.erase)record('eraser_finish',duration);
      if(run.strokes.length<500)run.strokes.push({points:current.stroke.points.length,erase:current.stroke.erase,
        event:event.type,pointerType:event.pointerType,trusted:event.isTrusted,duration,at:new Date().toISOString()});
      if(event.type==='pointerup'){afterUp=performance.now();startFrames();}
    }
  };}
  function request(fn){return function(path,...args){
    const start=performance.now(),online=navigator.onLine,name=path==='/api/drawings'?'submit_request':'health_request';
    const submissionId=path==='/api/drawings'?args[0]?.body?.get('submission_id'):undefined;
    return fn.call(this,path,...args).then(value=>{complete('ok',value);return value;},error=>{complete('error');throw error;});
    function complete(result,value){const ms=performance.now()-start;record(name,ms);if(network.length<200)network.push({path,result,online,ms,
      case:run.case,submissionId,drawingId:value?.id,replayed:value?.replayed,at:new Date().toISOString()});}
  };}
  function intercept(target,decorate){
    const original=target.addEventListener,own=Object.hasOwn(target,'addEventListener');
    target.addEventListener=function(type,handler,options){return original.call(this,type,decorate(type,handler),options);};
    cleanup.push(()=>{if(own)target.addEventListener=original;else delete target.addEventListener;});
  }
  function bindCanvas(node,state){
    canvas=node;getState=state;run.device=metadata();
    intercept(canvas,(type,fn)=>{
      if(type==='pointermove')return function(event){
        return canvas.hasPointerCapture(event.pointerId)?measure('pointermove',()=>fn.call(this,event)):fn.call(this,event);
      };
      if(type==='pointerdown')return function(event){const result=fn.call(this,event);if(document.body.classList.contains('is-drawing'))startFrames();return result;};
      return fn;
    });
    for(const [id,name] of [['undo-button','undo'],['redo-button','redo'],['send-button','submit']]){
      const button=document.getElementById(id);
      intercept(button,(type,fn)=>type!=='click'?fn:function(...args){
        if(button.disabled)return fn.apply(this,args);
        if(name!=='submit')return measure(name,()=>fn.apply(this,args));
        const start=performance.now(),result=measure('submit_local_preparation',()=>fn.apply(this,args));
        result.then(()=>{
          const elapsed=performance.now()-start;record('submit_to_result_ui',elapsed);
          if(document.querySelector('#upload-status').classList.contains('success'))record('submit_to_success_ui',elapsed);
        },()=>record('submit_to_result_ui',performance.now()-start));
        return result;
      });
    }
  }
  const longTasks={available:false,reason:'Long Tasks API unavailable',scope:'All main-thread long tasks, not only Draw'};
  if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){
    try{observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())record('long_task',entry.duration);});
      observer.observe({type:'longtask'});longTasks.available=true;longTasks.reason=null;
    }catch(error){longTasks.reason=error.message;}
  }
  function listen(target,type,fn){target.addEventListener(type,fn);cleanup.push(()=>target.removeEventListener(type,fn));}
  for(const type of ['online','offline','resize','orientationchange'])listen(window,type,()=>{
    if(run.events.length<200)run.events.push({type,at:new Date().toISOString(),device:metadata()});
  });
  listen(document,'visibilitychange',()=>{
    if(document.hidden){cancelAnimationFrame(frame);frame=0;lastFrame=null;afterUp=null;}else if(document.body.classList.contains('is-drawing'))startFrames();
    if(run.events.length<200)run.events.push({type:document.hidden?'hidden':'visible',at:new Date().toISOString()});
  });

  const overlay=document.createElement('div');overlay.id='draw-device-audit';
  overlay.innerHTML=`<style>
    #draw-device-audit{position:fixed;top:max(8px,env(safe-area-inset-top));right:8px;z-index:10000;font:13px system-ui;color:#172a31}
    #draw-device-audit details{background:#fff;border:1px solid #607d87;border-radius:8px;padding:8px;max-width:300px}
    #draw-device-audit details[open]{width:min(300px,80vw);max-height:75vh;overflow:auto}
    #draw-device-audit summary{cursor:pointer}#draw-device-audit label{display:block;margin:8px 0}
    #draw-device-audit input:not([type=checkbox]),#draw-device-audit textarea,#draw-device-audit select{width:100%;box-sizing:border-box}
    #draw-device-audit button{min-height:38px;margin:3px}#draw-device-audit pre{white-space:pre-wrap}
  </style><details><summary>TEST · Đo Draw</summary>
  <label>Model thiết bị <input data-model placeholder="iPad / iPhone cụ thể"></label>
  <label>iPadOS / iOS <input data-os placeholder="Phiên bản"></label>
  <label><input type="checkbox" data-human> Tôi đang vẽ thật trên Safari</label>
  <label>Ca thử <select data-case>${['A · 1–3 nét','B · 10–20 nét','C · 50+ nét','D · Nét liên tục','E · Tẩy','F · Hoàn tác','G · Làm sạch sau gửi','H · Gửi','I · Lặp nhiều lượt'].map((name,i)=>`<option value="${String.fromCharCode(65+i)}">${name}</option>`).join('')}</select></label>
  <button data-start>Bắt đầu ca mới</button><button data-close>Thu gọn</button>
  <label>Quan sát thực tế <textarea data-notes rows="3" placeholder="Độ trễ, cuộn/zoom, xoay máy, nút, phản hồi…"></textarea></label>
  <button data-view>Xem số đo</button><button data-copy>Copy JSON</button><button data-download>Tải JSON</button>
  <pre data-summary>Xuất trước khi đóng tab. Không đo trên kho triển lãm.</pre>
  <textarea data-result hidden readonly rows="8" aria-label="JSON báo cáo — nhấn giữ để sao chép"></textarea>
  </details>`;
  document.body.append(overlay);
  const $=selector=>overlay.querySelector(selector);
  function serialize(item){
    const metrics=Object.fromEntries(Object.entries(item.metrics).map(([name,entry])=>[name,timingSummary(entry)]));
    const frames=item.metrics.raf_interval,median=metrics.raf_interval?.median;
    return {...item,metrics,frameGaps:{sampled:frames?.values.length??0,
      above50ms:frames?.values.filter(ms=>ms>50).length??0,
      above1_5Median:median?frames.values.filter(ms=>ms>1.5*median).length:0},
      longTasks:{...longTasks,timing:longTasks.available?timingSummary(item.metrics.long_task):null}};
  }
  function report(){
    for(const entry of observer?.takeRecords()??[])record('long_task',entry.duration);
    run.notes=$('[data-notes]').value;
    return {schema:1,session,exported:new Date().toISOString(),device:{model:$('[data-model]').value,os:$('[data-os]').value,...metadata()},
      humanSafariConfirmation:$('[data-human]').checked,classification:'NEEDS_MORE_DEVICE_EVIDENCE',
      currentDrawing:getState?.()??null,runs:[...runs,{...run,endDrawing:getState?.()??null}].map(serialize),network,
      manualClear:'NOT_AVAILABLE — current Draw only clears after successful submission',
      limitations:['Instrumented timings have overhead; compare with ?perf absent.',
        'rAF is a scheduling proxy, not GPU frame loss or finger-to-pixel latency.',
        'Request includes response parsing; not pure network-wire time.',
        'Quantiles and gap counts use the first 4096 samples per metric; inspect truncated.',
        'Completed-stroke list capped at 500 per case; timeline capped at 200 events.',
        'Local preparation is synchronous work until the async handler first yields; nested timings overlap.']};
  }
  $('[data-start]').onclick=()=>{
    if(document.body.classList.contains('is-drawing')||getState?.().busy){$('[data-summary]').textContent='Chờ nét/gửi hiện tại hoàn tất.';return;}
    run.notes=$('[data-notes]').value;
    if(runs.length>=50){$('[data-summary]').textContent='Đã đủ 50 ca. Xuất báo cáo, rồi mở phiên mới.';return;}
    for(const entry of observer?.takeRecords()??[])record('long_task',entry.duration);
    run.endDrawing=getState?.()??null;runs.push(run);run=newRun($('[data-case]').value);$('[data-notes]').value='';$('[data-summary]').textContent=`Đang đo ca ${run.case}. Thu gọn trước khi vẽ.`;
  };
  $('[data-close]').onclick=()=>{overlay.querySelector('details').open=false;};
  $('[data-view]').onclick=()=>{const data=report();$('[data-summary]').textContent=JSON.stringify({case:run.case,strokes:run.strokes.length,metrics:data.runs.at(-1).metrics},null,2);};
  $('[data-copy]').onclick=async()=>{
    const value=JSON.stringify(report(),null,2);
    try{if(!navigator.clipboard?.writeText)throw Error('clipboard unavailable');await navigator.clipboard.writeText(value);$('[data-summary]').textContent='Đã copy JSON.';}
    catch{const output=$('[data-result]');output.hidden=false;output.value=value;output.focus();output.select();$('[data-summary]').textContent='LAN HTTP: nhấn giữ vùng JSON để Sao chép.';}
  };
  const urls=new Set();
  $('[data-download]').onclick=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(report(),null,2)],{type:'application/json'}));urls.add(url);
    const link=document.createElement('a');link.href=url;link.download=`draw-device-${Date.now()}.json`;link.click();
    setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},10000);
  };
  listen(window,'pagehide',()=>{cancelAnimationFrame(frame);observer?.disconnect();for(const restore of cleanup)restore();for(const url of urls)URL.revokeObjectURL(url);});
  return {measure,wrap,finish,request,bindCanvas,alphaCheck:(pixels,predicate)=>measure('alpha_check',()=>pixels.some(predicate))};
}
