const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function drawingPage(responses, savedStorage, profile='') {
  const elements = new Map(), storage = new Map(savedStorage), uploads = [], vectors=[];
  const monoButtons=Array.from({length:5},(_,index)=>({dataset:{monoWidth:String(index+1)},handlers:{},setAttribute(name,value){this[name]=value;},addEventListener(name,fn){this.handlers[name]=fn;}}));
  let ink = false;
  const context = {
    save() {}, restore() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {},setTransform(){},drawImage(){},createPattern(){return {setTransform(){}};},
    fill() { ink = true; }, stroke() { ink = true; }, clearRect() { ink = false; },
    getImageData() { return {data: [0, 0, 0, ink ? 255 : 0]}; },
  };
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      handlers: {}, dataset: {}, classList: {toggle() {}},
      addEventListener(name, fn) { this.handlers[name] = fn; },
      setAttribute(name, value) { this[name] = value; },
    });
    return elements.get(selector);
  }
  Object.assign(element('#drawing-canvas'), {
    getContext: () => context, getBoundingClientRect: () => ({left: 0, top: 0, width: 720, height: 720}),
    setPointerCapture() {}, hasPointerCapture: () => false,
  });
  Object.assign(element('#brush-preview'), {width:280,height:48,getContext:()=>({save(){},restore(){},clearRect(){},beginPath(){},arc(){},fill(){},moveTo(){},lineTo(){},quadraticCurveTo(){},stroke(){},setTransform(){},createPattern(){return {setTransform(){}};}})});
  const offscreenContext={setTransform(){},clearRect(){},drawImage(){},scale(){},fillRect(){},beginPath(){},arc(){},fill(){}};
  const sandbox = vm.createContext({
    document: {body:{dataset:{profile},classList:{toggle(){}}},addEventListener(){},querySelector: element, querySelectorAll: selector=>selector==='[data-mono-width]'?monoButtons:selector==='[data-rgb]'?['r','g','b'].map(c=>element('#rgb-'+c)):[],createElement:tag=>tag==='canvas'?{width:0,height:0,getContext:()=>offscreenContext}:element(`created-${tag}`)},
    location: {port: '8000', origin: 'http://localhost:8000'},
    crypto: require('node:crypto').webcrypto, structuredClone, Uint8Array, Uint32Array, Blob, FormData,
    window: {addEventListener() {},devicePixelRatio:2}, requestAnimationFrame:callback=>{callback();return 0;},cancelAnimationFrame(){},setInterval: () => 1, clearInterval() {},
    AbortController, setTimeout, clearTimeout, atob, TypeError,
    localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)},
    fetch: async (url, options) => {
      if (url.endsWith('/api/health')) return new Response('{"status":"ok"}');
      uploads.push(options.body.get('submission_id'));
      vectors.push(options.body.get('strokes'));
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (next.delay) await new Promise(resolve => setTimeout(resolve, next.delay));
      return new Response(JSON.stringify(next.body), {status: next.status || 201});
    },
  });
  vm.runInContext(fs.readFileSync('frontend/shared/monoline.js', 'utf8').replaceAll('export function', 'function').replaceAll('export const','const'), sandbox);
  vm.runInContext(fs.readFileSync('frontend/shared/graphite.js', 'utf8').replace(/^import .*\n/gm,'').replaceAll('export function', 'function').replaceAll('export const','const'), sandbox);
  vm.runInContext(fs.readFileSync('frontend/shared/metallic.js', 'utf8').replaceAll('export function', 'function').replaceAll('export const','const'), sandbox);
  vm.runInContext(fs.readFileSync('frontend/shared/led.js', 'utf8').replace(/^import .*\n/gm,'').replaceAll('export function', 'function').replaceAll('export const','const'), sandbox);
  vm.runInContext(fs.readFileSync('frontend/draw/pencil.js', 'utf8').replace(/^import .*\n/gm,'').replaceAll('export function', 'function'), sandbox);
  vm.runInContext(fs.readFileSync('frontend/draw/submission.js', 'utf8').replace(/^import .*\n/gm,'').replaceAll('export function', 'function'), sandbox);
  vm.runInContext(fs.readFileSync('frontend/draw/app.js', 'utf8').replace(/^import .*\n/gm, ''), sandbox);
  element('#tool-panel').hidden = true;
  const draw = () => {
    element('#drawing-canvas').handlers.pointerdown({button: 0, pointerId: 1, clientX: 20, clientY: 20, preventDefault() {}});
    element('#drawing-canvas').handlers.pointerup({pointerId: 1});
  };
  return {element, monoButtons, draw, uploads, vectors, storage, ink: () => ink,
    draft: () => JSON.parse(storage.get('cloud-strokes-draft-v2')),
    send: () => element('#send-button').handlers.click()};
}

test('minimal Draw chrome exposes only the essential carving controls by default',()=>{
  const html=fs.readFileSync('frontend/draw/index.html','utf8');
  assert.match(html,/id="send-button"[^>]*aria-label="Khắc tác phẩm"[^>]*>Khắc</);
  assert.match(html,/id="eraser-button"[^>]*aria-label="Tẩy"/);
  assert.match(html,/id="undo-button"[^>]*aria-label="Hoàn tác"/);
  assert.match(html,/id="redo-button"[^>]*aria-label="Làm lại"/);
  assert.match(html,/id="pencil-button"[^>]*aria-label="Bút"/);
  assert.match(html,/id="close-tool-panel"[^>]*aria-label="Đóng tùy chỉnh bút"/);
  assert.doesNotMatch(html,/>Gửi</);
  assert.doesNotMatch(html,/Tải PNG|Xóa bản vẽ|Kiểm tra kết nối/);
  assert.doesNotMatch(html,/class="app-header"|class="intro"|Vẽ một nét riêng/);
});

test('eraser stays selected until Pen restores drawing and opens its compact panel',()=>{
  const page=drawingPage([],undefined,'led');
  page.element('#eraser-button').handlers.click();
  page.element('#eraser-button').handlers.click();
  assert.equal(page.element('#eraser-button')['aria-pressed'],'true');
  assert.equal(page.element('#pencil-button')['aria-pressed'],'false');
  page.element('#pencil-button').handlers.click();
  assert.equal(page.element('#eraser-button')['aria-pressed'],'false');
  assert.equal(page.element('#pencil-button')['aria-pressed'],'true');
  assert.equal(page.element('#tool-panel').hidden,false);
  assert.equal(page.element('#pencil-button')['aria-expanded'],'true');
  page.element('#close-tool-panel').handlers.click();
  assert.equal(page.element('#tool-panel').hidden,true);
  assert.equal(page.element('#pencil-button')['aria-expanded'],'false');
});

test('Khắc prevents duplicate submission while the first request is pending',async()=>{
  const page=drawingPage([{delay:20,body:{id:'saved',image_path:'/api/drawings/saved'}}],undefined,'led');
  page.draw();
  const first=page.send(),second=page.send();
  await Promise.all([first,second]);
  assert.equal(page.uploads.length,1);
  assert.equal(page.element('#upload-status').textContent,'Đã khắc vào Thời Khắc');
});

for (const replayed of [false, true]) test(`confirmed submission clears canvas and draft (replayed=${replayed})`, async () => {
  const page = drawingPage([{body: {id:'saved',image_path:'/api/drawings/saved',replayed}}, {body: {id:'next',image_path:'/api/drawings/next',replayed: false}}]);
  page.draw();
  const oldId = page.draft().submissionId;
  page.element('#eraser-button').handlers.click();
  await page.send();
  assert.equal(page.ink(), false);
  assert.deepEqual(page.draft().strokes, []);
  assert.equal('pendingPng' in page.draft(), false);
  assert.notEqual(page.draft().submissionId, oldId);
  for (const name of ['send', 'undo', 'redo']) assert.equal(page.element(`#${name}-button`).disabled, true);
  assert.equal(page.element('#eraser-button')['aria-pressed'], 'false');
  page.draw();
  assert.equal(page.ink(), true);
  assert.equal(page.element('#send-button').disabled, false);
  await page.send();
  assert.notEqual(page.uploads[0], page.uploads[1]);
});

test('Draw scales a 2px line from a 110px scroll cell into its 720px canvas',async()=>{
  const page=drawingPage([{status:500,body:{detail:'Retry'}},{body:{id:'led',image_path:'/api/drawings/led'}}],undefined,'led');
  page.draw();const stroke=page.draft().strokes[0];
  assert.equal(stroke.led,true);assert.equal(stroke.color,'#096120');assert.equal(stroke.material,'mono-v1');
  assert.equal(stroke.width,2*720/110);
  await page.send();await page.send();
  assert.equal(page.uploads[0],page.uploads[1]);assert.equal(page.vectors[0],page.vectors[1]);
  assert.equal(JSON.parse(page.vectors[0]).profile,'led-2px');
  assert.equal(JSON.parse(page.vectors[0]).version,2);
  assert.deepEqual(JSON.parse(page.vectors[0]).strokes[0],{erase:false,width:2,material:'mono-v1',color:'#096120',points:[[20,20,.55]]});
  assert.equal(page.ink(),false);
});

test('new visitors get dark green ink without replacing a returning visitor’s chosen color',()=>{
  const fresh=drawingPage([]);assert.equal(fresh.element('#stroke-color').value,'#096120');
  const saved=new Map([['cloud-strokes-brush-v1',JSON.stringify({monoLevel:4,inkColor:'#E7BD00'})]]);
  const returning=drawingPage([],saved);returning.draw();
  assert.equal(returning.draft().strokes[0].color,'#E7BD00');
  assert.equal(returning.draft().strokes[0].ledWidth,2.5);
});

test('five Mono levels persist and belong to each new stroke',()=>{
  const page=drawingPage([],undefined,'led');page.monoButtons[0].handlers.click();page.draw();page.monoButtons[4].handlers.click();page.draw();
  const strokes=page.draft().strokes;
  assert.deepEqual(strokes.map(stroke=>stroke.ledWidth),[1,3]);
  assert.deepEqual(strokes.map(stroke=>stroke.width),[720/110,3*720/110]);
  assert.equal(JSON.parse(page.storage.get('cloud-strokes-brush-v1')).monoLevel,5);
});

test('Draw color applies only to new ink, survives draft reload/undo and keeps failed retry identical',async()=>{
  const page=drawingPage([{status:500,body:{detail:'Retry'}},{body:{id:'saved',image_path:'/api/drawings/saved'}}]);
  const color=page.element('#stroke-color');
  color.handlers.input({target:{value:'#2f6972'}});page.draw();
  color.handlers.input({target:{value:'#1264a3'}});page.draw();
  assert.deepEqual(page.draft().strokes.map(s=>s.color),['#2F6972','#1264A3']);
  page.element('#undo-button').handlers.click();assert.equal(page.draft().strokes.length,1);
  page.element('#redo-button').handlers.click();
  const rgb=['r','g','b'].map(c=>page.element('#rgb-'+c));
  [18,52,86].forEach((value,i)=>{rgb[i].value=String(value);});rgb[0].handlers.input();
  assert.equal(color.value,'#123456');
  rgb[0].value='256';rgb[0].handlers.input();assert.equal(rgb[0]['aria-invalid'],'true');assert.equal(color.value,'#123456');
  rgb[0].value='';rgb[0].handlers.input();assert.equal(color.value,'#123456');
  rgb[0].value='18';rgb[0].handlers.input();
  const restored=drawingPage([],page.storage);restored.draw();
  assert.deepEqual(restored.draft().strokes.map(s=>s.color),['#2F6972','#1264A3','#123456']);
  await page.send();await page.send();
  assert.equal(page.vectors[0],page.vectors[1]);assert.equal(page.uploads[0],page.uploads[1]);
  assert.deepEqual(JSON.parse(page.vectors[1]).strokes.map(s=>s.color),['#2F6972','#1264A3']);
  assert.equal(page.ink(),false);
});

test('returning to Mono preserves an existing graphite draft and its export metadata',async()=>{
  const oldStroke={led:true,color:'#514739',material:'graphite-v1',seed:17,width:2*720/110,ledWidth:2,erase:false,points:[{x:50,y:50,p:.4}]};
  const saved=new Map([['cloud-strokes-draft-v2',JSON.stringify({submissionId:'a'.repeat(32),strokes:[oldStroke]})]]);
  const page=drawingPage([{body:{id:'saved',image_path:'/api/drawings/saved'}}],saved,'led');
  page.draw();assert.equal(page.draft().strokes[1].material,'mono-v1');
  await page.send();const data=JSON.parse(page.vectors[0]);
  assert.equal(data.version,2);assert.equal(data.strokes[0].material,'graphite-v1');
  assert.deepEqual(data.strokes[0].points,[[50,50,.4]]);
  assert.deepEqual(data.strokes[1],{erase:false,width:2,material:'mono-v1',color:'#096120',points:[[20,20,.55]]});
});

test('solid legacy draft adopts the shared SVG palette without reducing its opacity',async()=>{
  const oldStroke={led:true,color:'#FFD700',width:2*720/110,ledWidth:2,erase:false,points:[{x:50,y:50}]};
  const saved=new Map([['cloud-strokes-draft-v2',JSON.stringify({submissionId:'a'.repeat(32),strokes:[oldStroke]})]]);
  const page=drawingPage([{body:{id:'saved',image_path:'/api/drawings/saved'}}],saved,'led');
  await page.send();const data=JSON.parse(page.vectors[0]);
  assert.equal(data.version,2);assert.deepEqual(data.strokes[0],{erase:false,width:2,material:'mono-v1',points:[[50,50,1]]});
});

test('Mono input consumes coalesced pointer samples, keeps the final finger position and uses a Retina backing store',()=>{
  const page=drawingPage([],undefined,'led'),canvas=page.element('#drawing-canvas');let prevented=0;
  assert.equal(canvas.width,1440);assert.equal(canvas.height,1440);
  canvas.handlers.pointerdown({button:0,pointerType:'touch',isPrimary:true,pointerId:7,clientX:10,clientY:10,preventDefault(){prevented++;}});
  canvas.handlers.pointermove({pointerId:7,preventDefault(){prevented++;},getCoalescedEvents:()=>[
    {pointerType:'touch',clientX:100,clientY:12,timeStamp:2},{pointerType:'touch',clientX:105,clientY:110,timeStamp:3}
  ]});
  canvas.handlers.pointerup({type:'pointerup',pointerId:7,pointerType:'touch',clientX:130,clientY:140,timeStamp:4,preventDefault(){prevented++;}});
  const points=page.draft().strokes[0].points;
  assert.deepEqual(points.map(({x,y})=>[x,y]),[[10,10],[100,12],[105,110],[130,140]]);
  assert.equal(prevented,3);
});

test('failed submission preserves drawing and retry identity until confirmation', async () => {
  const page = drawingPage([{status: 500, body: {detail: 'Try again'}}, {body: {id:'saved',image_path:'/api/drawings/saved',replayed: true}}]);
  page.draw();
  const before = page.draft();
  await page.send();
  assert.equal(page.ink(), true);
  assert.equal(page.element('#upload-status').textContent,'Chưa thể khắc. Thử lại.');
  assert.deepEqual(page.draft().strokes, before.strokes);
  assert.equal(page.draft().submissionId, before.submissionId);
  assert.equal('pendingPng' in page.draft(), false);
  assert.equal(page.element('#send-button').disabled, false);
  await page.send();
  assert.equal(page.uploads[0], page.uploads[1]);
  assert.equal(page.ink(), false);
});

test('malformed success does not erase the drawing', async () => {
  const page = drawingPage([{body: {ok:true}}]);
  page.draw(); const id = page.draft().submissionId;
  await page.send();
  assert.equal(page.ink(), true);
  assert.equal(page.draft().submissionId, id);
  assert.equal(page.element('#upload-status').textContent,'Chưa thể khắc. Thử lại.');
});
