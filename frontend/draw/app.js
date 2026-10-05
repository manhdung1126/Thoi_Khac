import {paintStroke, samplePoint} from './pencil.js?v=20261006-pressure-cache';
import {MONO_MATERIAL} from '../shared/monoline.js?v=20261006-pressure-cache';
import {LED, MONO_LED_WIDTHS, monoDrawWidth} from '../shared/led.js?v=20261006-pressure-cache';
import {GRAPHITE_MATERIAL} from '../shared/graphite.js';

const $=selector=>document.querySelector(selector);
const canvas=$('#drawing-canvas'),logicalSize=LED.sourceSize;
const pixelRatio=Math.max(1,Number(window.devicePixelRatio)||1);
function retinaContext(target,width,height){
  target.width=Math.round(width*pixelRatio);target.height=Math.round(height*pixelRatio);
  // Draft/eraser checks read pixels after each edit. Keep one rasterizer rather
  // than letting the browser switch GPU -> CPU after several readbacks.
  const ctx=target.getContext('2d',{willReadFrequently:true});ctx.setTransform?.(pixelRatio,0,0,pixelRatio,0,0);return ctx;
}
const context=retinaContext(canvas,logicalSize,logicalSize);
const activeBase=document.createElement('canvas');activeBase.width=canvas.width;activeBase.height=canvas.height;
const activeBaseContext=activeBase.getContext('2d',{willReadFrequently:true});
const apiBase=location.port==='4173'?`${location.protocol}//${location.hostname}:8000`:location.origin;
const draftKey='cloud-strokes-draft-v2',preferencesKey='cloud-strokes-brush-v1';
let strokes=[],undo=[],redo=[],active=null,busy=false,erasing=false,monoLevel=3;
let width=monoDrawWidth(monoLevel),submissionId=uuid(),hasDrawing=false;
let healthTimer,checking=false,statusTimer,networkDown=false;

function uuid(){const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
function savePreferences(){try{localStorage.setItem(preferencesKey,JSON.stringify({monoLevel}));}catch{}}
function previewBrush(){
  const sample=$('#brush-preview'),ctx=retinaContext(sample,280,48);ctx.clearRect(0,0,280,48);
  const stroke={width,erase:false,material:MONO_MATERIAL,points:[]};
  for(let i=0;i<=100;i++)stroke.points.push({x:22+i*2.35,y:23+Math.sin(i*.075)*6,p:.55});
  paintStroke(ctx,stroke,280);
}
function status(text,type='',timeout=type==='error'?0:2600){
  const node=$('#upload-status');clearTimeout(statusTimer);node.textContent=text;node.title='';node.className=`toast ${type}`;node.hidden=!text;
  if(text&&timeout)statusTimer=setTimeout(()=>{node.hidden=true;},timeout);
}
function toolPanel(open){const panel=$('#tool-panel'),button=$('#pencil-button');panel.hidden=!open;button.setAttribute('aria-expanded',String(open));}
function updateButtons(){
  $('#send-button').disabled=busy||Boolean(active)||!hasDrawing;
  $('#undo-button').disabled=busy||Boolean(active)||!undo.length;
  $('#redo-button').disabled=busy||Boolean(active)||!redo.length;
  for(const node of document.querySelectorAll('#eraser-button,#pencil-button,[data-mono-width]'))node.disabled=busy||Boolean(active);
  $('#send-button').textContent=busy?'Đang khắc…':'Khắc';document.body.classList?.toggle('is-submitting',busy);
  canvas.setAttribute('aria-busy',String(busy));$('#paper-hint').hidden=hasDrawing||Boolean(active);
}
function point(event,previous){return samplePoint(event,canvas.getBoundingClientRect(),previous);}
function render(){context.clearRect(0,0,logicalSize,logicalSize);for(const stroke of strokes)paintStroke(context,stroke);}
function rememberBase(){activeBaseContext.setTransform?.(1,0,0,1,0,0);activeBaseContext.clearRect(0,0,activeBase.width,activeBase.height);activeBaseContext.drawImage(canvas,0,0);}
function renderActive(){
  if(!active)return;
  const b=active.bounds,r=active.stroke.width/2+2;
  const x=Math.max(0,Math.floor((b.left-r)*pixelRatio)),y=Math.max(0,Math.floor((b.top-r)*pixelRatio));
  const w=Math.min(canvas.width,Math.ceil((b.right+r)*pixelRatio))-x,h=Math.min(canvas.height,Math.ceil((b.bottom+r)*pixelRatio))-y;
  // Integer backing-pixel crop avoids resampling old ink on each pointer frame.
  context.save();context.setTransform?.(1,0,0,1,0,0);context.clearRect(x,y,w,h);context.drawImage(activeBase,x,y,w,h,x,y,w,h);context.restore();
  paintStroke(context,active.stroke);active.frame=0;
}
function scheduleActive(){if(active&&!active.frame)active.frame=requestAnimationFrame(renderActive);}
function remember(){undo.push(structuredClone(strokes));if(undo.length>20)undo.shift();redo=[];}
function persist(){try{localStorage.setItem(draftKey,JSON.stringify({strokes,submissionId}));$('#draft-status').textContent='Đã giữ bản nháp trên thiết bị';}catch{$('#draft-status').textContent='Không đủ chỗ lưu bản nháp';}}
function changed(){submissionId=uuid();hasDrawing=context.getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>0);persist();updateButtons();}

canvas.addEventListener('pointerdown',event=>{
  if(active||busy||event.isPrimary===false||(event.pointerType==='mouse'&&event.button!==0))return;
  event.preventDefault();remember();rememberBase();
  const stroke={color:LED.color,width:erasing?6*720/LED.size:width,ledWidth:MONO_LED_WIDTHS[monoLevel-1],erase:erasing,led:true,...(erasing?{}:{material:MONO_MATERIAL}),points:[point(event)]};
  const first=stroke.points[0];strokes.push(stroke);active={id:event.pointerId,stroke,frame:0,bounds:{left:first.x,right:first.x,top:first.y,bottom:first.y}};renderActive();canvas.setPointerCapture(event.pointerId);toolPanel(false);document.body.classList?.toggle('is-drawing',true);updateButtons();
});
function appendEvents(event){
  const coalesced=event.getCoalescedEvents?.()||[],samples=coalesced.length?[...coalesced,event]:[event];
  for(const sample of samples){if(!Number.isFinite(sample.clientX)||!Number.isFinite(sample.clientY))continue;const previous=active.stroke.points.at(-1),next=point(sample,previous);if(Math.hypot(next.x-previous.x,next.y-previous.y)>=.35){active.stroke.points.push(next);const b=active.bounds;b.left=Math.min(b.left,next.x);b.right=Math.max(b.right,next.x);b.top=Math.min(b.top,next.y);b.bottom=Math.max(b.bottom,next.y);}else if(sample.pointerType==='pen'&&sample.type!=='pointerup'&&sample.pressure>0){previous.p=next.p;}}
}
canvas.addEventListener('pointermove',event=>{if(!active||active.id!==event.pointerId)return;event.preventDefault();appendEvents(event);scheduleActive();});
function finish(event){
  if(!active||active.id!==event.pointerId)return;event.preventDefault?.();if(event.type==='pointerup')appendEvents(event);
  if(active.frame)cancelAnimationFrame(active.frame);renderActive();const pointerId=active.id;active=null;document.body.classList?.toggle('is-drawing',false);if(canvas.hasPointerCapture(pointerId))canvas.releasePointerCapture(pointerId);changed();if(!networkDown)status('');
}
['pointerup','pointercancel','lostpointercapture'].forEach(type=>canvas.addEventListener(type,finish));
$('#undo-button').addEventListener('click',()=>{redo.push(structuredClone(strokes));strokes=undo.pop();render();changed();if(!networkDown)status('');});
$('#redo-button').addEventListener('click',()=>{undo.push(structuredClone(strokes));strokes=redo.pop();render();changed();if(!networkDown)status('');});
function selectPen(){erasing=false;$('#pencil-button').setAttribute('aria-pressed','true');$('#eraser-button').setAttribute('aria-pressed','false');$('#tool-label').textContent=`Mono line · mức ${monoLevel}/5`;}
$('#pencil-button').addEventListener('click',()=>{if(busy)return;selectPen();toolPanel($('#tool-panel').hidden);});
$('#close-tool-panel').addEventListener('click',()=>{toolPanel(false);$('#pencil-button').focus?.();});
function chooseMonoLevel(value){
  monoLevel=Math.max(1,Math.min(5,Number(value)||3));width=monoDrawWidth(monoLevel);
  document.querySelectorAll('[data-mono-width]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.monoWidth)===monoLevel)));
  const ledWidth=MONO_LED_WIDTHS[monoLevel-1];$('#mono-width-value').value=`Mức ${monoLevel} · ${ledWidth} px LED`;
  $('#led-scale-help').textContent=`Mức ${monoLevel}: ≈${width.toLocaleString('vi-VN',{minimumFractionDigits:2,maximumFractionDigits:2})} px trên bảng → ${ledWidth} px LED.`;
  $('#brush-preview').setAttribute('aria-label',`Mẫu nét Mono line mức ${monoLevel}`);if(!erasing)selectPen();previewBrush();savePreferences();
}
document.querySelectorAll('[data-mono-width]').forEach(button=>button.addEventListener('click',()=>chooseMonoLevel(button.dataset.monoWidth)));
$('#eraser-button').addEventListener('click',()=>{if(busy)return;erasing=true;toolPanel(false);$('#pencil-button').setAttribute('aria-pressed','false');$('#eraser-button').setAttribute('aria-pressed','true');$('#tool-label').textContent='Tẩy nét vẽ';updateButtons();});
document.addEventListener?.('keydown',event=>{if(event.key==='Escape'&&!$('#tool-panel').hidden){toolPanel(false);$('#pencil-button').focus?.();}});
async function request(path,options={},timeout=15000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{const response=await fetch(apiBase+path,{...options,signal:controller.signal}),text=await response.text();let data;try{data=JSON.parse(text);}catch{data=null;}if(!response.ok)throw new Error(typeof data?.detail==='string'?data.detail:`Server chưa xử lý được (${response.status}). Hãy thử lại.`);if(!data)throw new Error('Phản hồi chưa hợp lệ. Hãy thử lại.');return data;}
  catch(error){if(error.name==='AbortError'||error instanceof TypeError)throw new Error('Chưa xác nhận được kết quả. Kiểm tra kết nối rồi gửi lại; cùng lần gửi sẽ không tạo hình trùng.');throw error;}finally{clearTimeout(timer);}
}
$('#send-button').addEventListener('click',async()=>{
  if(busy||!hasDrawing)return;busy=true;toolPanel(false);updateButtons();status('Đang khắc…','',0);
  try{
    const form=new FormData();form.append('submission_id',submissionId);
    const vectors=strokes.map(stroke=>{
      const material=stroke.erase?null:stroke.material===GRAPHITE_MATERIAL?GRAPHITE_MATERIAL:MONO_MATERIAL;
      return {erase:Boolean(stroke.erase),...(material?{width:stroke.ledWidth,material,...(material===GRAPHITE_MATERIAL?{seed:stroke.seed}:{})}:{}),
        // Unsaved solid drafts adopt the shared palette without losing their alpha 1.
        points:stroke.points.map(p=>material?[p.x,p.y,stroke.material===material?p.p??.55:1]:[p.x,p.y])};
    });
    form.append('strokes',JSON.stringify({version:2,profile:'led-2px',strokes:vectors}));
    const data=await request('/api/drawings',{method:'POST',body:form});if(typeof data.id!=='string'||!data.image_path)throw new Error('Chưa nhận được xác nhận lưu hình. Hãy thử gửi lại.');
    strokes=[];undo=[];redo=[];active=null;erasing=false;render();selectPen();changed();status('Đã khắc vào Thời Khắc','success',3200);
  }catch(error){status('Chưa thể khắc. Thử lại.','error',0);$('#upload-status').title=error.message;}finally{busy=false;updateButtons();}
});
async function check(){
  $('#connection-status').textContent='Đang kết nối…';try{const data=await request('/api/health',{},5000);if(data.status!=='ok')throw new Error();$('#connection-status').textContent='Đã kết nối';if(networkDown)status('Đã kết nối lại','success');networkDown=false;}catch{networkDown=true;$('#connection-status').textContent='Mất kết nối · đang thử lại…';if(!busy)status('Mất kết nối · đang thử lại…','error',0);}
}
async function checkConnection(){if(checking)return;checking=true;try{await check();}finally{checking=false;}}
window.addEventListener('online',checkConnection);window.addEventListener('offline',()=>{networkDown=true;$('#connection-status').textContent='Mất kết nối · đang thử lại…';if(!busy)status('Mất kết nối · đang thử lại…','error',0);});
window.addEventListener('pagehide',()=>{clearInterval(healthTimer);clearTimeout(statusTimer);if(active?.frame)cancelAnimationFrame(active.frame);persist();});window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
try{const saved=JSON.parse(localStorage.getItem(draftKey)||'null');if(saved&&Array.isArray(saved.strokes)&&saved.strokes.length<10000&&/^[a-f0-9]{32}$/.test(saved.submissionId)){strokes=saved.strokes.filter(s=>s.led===true&&Array.isArray(s.points)&&s.points.length&&Number.isFinite(s.width));submissionId=saved.submissionId;render();hasDrawing=context.getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>0);$('#draft-status').textContent='Đã mở lại bản nháp';}}catch{strokes=[];render();}
try{const prefs=JSON.parse(localStorage.getItem(preferencesKey)||'null');if(Number.isInteger(prefs?.monoLevel)&&prefs.monoLevel>=1&&prefs.monoLevel<=5)monoLevel=prefs.monoLevel;}catch{}
chooseMonoLevel(monoLevel);selectPen();updateButtons();checkConnection();healthTimer=setInterval(()=>{if(!document.hidden)checkConnection();},20000);
