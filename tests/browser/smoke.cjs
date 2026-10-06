const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');

const root=path.resolve(__dirname,'../..');
let server,browser,origin,storage;
async function startServer(port=0){
  server=spawn(path.join(root,'.venv/bin/python'),['-m','uvicorn','backend.app.main:app','--host','127.0.0.1','--port',String(port)],
    {cwd:root,env:{...process.env,CLOUD_STORAGE_DIR:storage,CLOUD_ADMIN_PIN:'2468',NO_COLOR:'1'},stdio:['ignore','ignore','pipe']});
  origin=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(Error('Test server did not start: '+output)),15000);
    server.on('error',error=>{clearTimeout(timer);reject(error);});
    server.on('exit',code=>{clearTimeout(timer);reject(Error(`Test server exited (${code}): ${output}`));});
    server.stderr.on('data',chunk=>{
      output=(output+chunk.toString()).slice(-12000);
      const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if(match){clearTimeout(timer);resolve(match[0]);}
    });
  });
  assert.equal((await fetch(origin+'/api/health')).status,200);
}
async function stopServer(signal='SIGTERM'){
  if(server&&server.exitCode===null&&server.signalCode===null){
    const stopped=once(server,'exit'),timer=setTimeout(()=>server.kill('SIGKILL'),5000);
    server.kill(signal);try{await stopped;}finally{clearTimeout(timer);}
  }
}
before(async()=>{
  storage=mkdtempSync(path.join(tmpdir(),'cos-browser-'));
  await startServer();
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
},{timeout:30000});
after(async()=>{
  try{await browser?.close();}
  finally{
    await stopServer();
    if(storage)rmSync(storage,{recursive:true,force:true}); // Only the directory made by mkdtemp above.
  }
});

async function canvasPixels(page){
  return page.getByLabel('Vùng vẽ của khách tham quan',{exact:true}).evaluate(canvas=>{
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    // A same-run digest, not a brittle saved image snapshot.
    let hash=2166136261;for(const byte of data)hash=Math.imul(hash^byte,16777619)>>>0;
    return {hash,hasInk:data.some((byte,index)=>index%4===3&&byte>0)};
  });
}
async function state(page){return (await page.request.get(origin+'/api/state')).json();}
async function waitState(page,predicate,timeout=30000){
  const deadline=Date.now()+timeout;
  do{
    const value=await state(page);if(predicate(value))return value;
    await new Promise(resolve=>setTimeout(resolve,500));
  }while(Date.now()<deadline);
  throw Error('Public API state did not reach the expected condition');
}
async function usable(page,locator){await locator.waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#send-button').disabled);}

async function contractControl(t){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});t.after(()=>context.close());
  const page=await context.newPage(),errors=[],messages=[],waiting=[];
  const signals={next:()=>messages.length?Promise.resolve(messages.shift()):new Promise(resolve=>waiting.push(resolve))};
  page.on('pageerror',error=>errors.push(error.message));
  await page.routeWebSocket('**/ws/display',socket=>{
    signals.socket=socket;const remote=socket.connectToServer();
    remote.onMessage(message=>{
      if(['state_changed','drawing_created'].includes(JSON.parse(String(message)).type)){
        if(waiting.length)waiting.shift()(message);else messages.push(message);
      }else socket.send(message);
    });
  });
  await page.goto(origin+'/control/');
  const login=page.waitForResponse(response=>response.url()===origin+'/api/admin/login'&&response.ok());
  await page.getByLabel('Mã quản lý',{exact:true}).fill('2468');
  await page.getByRole('dialog').getByRole('button',{name:'Đăng nhập',exact:true}).click();
  const headers={Authorization:'Bearer '+(await (await login).json()).token};
  await page.locator('#login-dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#page-select').options.length&&!document.querySelector('#page-select').disabled);
  return {page,headers,signals,errors};
}

test('Control retains its previous view when mutation commits but authoritative refresh fails', {timeout:30000},async t=>{
  const {page,signals,errors}=await contractControl(t);
  const before=await state(page),selected=await page.locator('#page-select').inputValue();
  const previous=before.pages.find(item=>item.id===selected).name,newName='Đã lưu nhưng chưa đồng bộ';
  await page.route(origin+'/api/state',route=>route.abort('failed'));
  await page.getByRole('button',{name:'Đổi tên trang',exact:true}).click();
  await page.getByLabel('Tên trang',{exact:true}).fill(newName);
  const committed=page.waitForResponse(response=>response.url()===origin+'/api/pages/'+selected&&response.request().method()==='PATCH'&&response.ok());
  await page.getByRole('button',{name:'Lưu tên',exact:true}).click();await committed;await signals.next();
  await page.waitForFunction(()=>!document.querySelector('#rename-page').disabled&&document.querySelector('#connection-status').textContent.includes('Không kết nối được server'));
  assert.equal(await page.locator('#rename-page-dialog').evaluate(node=>node.open),true);
  assert.equal(await page.locator('#page-name').inputValue(),newName);
  assert.equal(await page.locator('#page-select').inputValue(),selected);
  const label=await page.locator('#page-select option').evaluateAll((options,id)=>options.find(option=>option.value===id).textContent,selected);
  assert.equal(label,(selected===before.current_page_id?'● ':'')+previous);
  // Capture current behavior, not a decision about the desired failure UX.
  assert.equal(await page.locator('#notice').textContent(),'Đã đổi tên trang.');
  const after=await state(page);
  assert.equal(after.pages.find(item=>item.id===selected).name,newName);
  assert.equal(after.revision,before.revision+1);
  assert.equal(after.current_page_id,before.current_page_id);
  assert.deepEqual(errors,[]);
});

test('Control preview selection survives mutation and repeated WebSocket reconciliation, explicit projection and live-page deletion fallback', {timeout:30000},async t=>{
  const {page,headers,signals,errors}=await contractControl(t),before=await state(page),live=before.current_page_id;
  const picker=page.getByRole('combobox',{name:/Trang đang chọn/});
  await page.getByRole('button',{name:/Tạo trang/}).click();
  await page.waitForFunction(id=>document.querySelector('#page-select').value!==id,live);await signals.next();
  const first=await picker.inputValue();
  assert.equal((await state(page)).current_page_id,live);
  await page.getByRole('button',{name:/Tạo trang/}).click();
  await page.waitForFunction(id=>document.querySelector('#page-select').value!==id,first);await signals.next();
  const second=await picker.inputValue();
  await picker.selectOption(first);
  assert.equal((await state(page)).current_page_id,live);
  await page.getByRole('button',{name:'Đổi tên trang',exact:true}).click();
  await page.getByLabel('Tên trang',{exact:true}).fill('Trang chỉ đang xem trước');
  await page.getByRole('button',{name:'Lưu tên',exact:true}).click();
  await page.locator('#rename-page-dialog').waitFor({state:'hidden'});await signals.next();
  assert.equal((await state(page)).current_page_id,live);
  const name='Trang live đồng bộ qua HTTP';
  const changed=await page.request.patch(origin+'/api/pages/'+live,{headers,data:{name}});
  assert.equal(changed.status(),200);const authoritative=await changed.json(),message=await signals.next();
  const started=Promise.withResolvers(),release=Promise.withResolvers();let held=false;
  t.after(()=>release.resolve());
  await page.route(origin+'/api/state',async route=>{
    const response=await route.fetch();
    if(!held){held=true;started.resolve();await release.promise;}
    await route.fulfill({response});
  });
  signals.socket.send(message);await started.promise;
  // Even misleading repeated notification payloads must never become UI state.
  for(let i=0;i<4;i++)signals.socket.send(JSON.stringify({type:'state_changed',revision:999999,pages:[],current_page_id:'not-a-page'}));
  release.resolve();
  await page.waitForFunction(({id,name})=>Array.from(document.querySelector('#page-select').options).find(option=>option.value===id)?.textContent==='● '+name,{id:live,name});
  assert.equal(await picker.inputValue(),first);
  assert.equal(await page.locator('#stage-title').textContent(),'Bản xem trước trang');
  assert.deepEqual(await picker.locator('option').evaluateAll(options=>options.map(option=>option.value)),authoritative.pages.map(item=>item.id));
  assert.equal((await state(page)).current_page_id,live);
  await page.unroute(origin+'/api/state');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Xóa trang',exact:true}).click();
  await page.waitForFunction(id=>document.querySelector('#page-select').value===id,second);await signals.next();
  const deleted=await state(page);
  assert.equal(deleted.current_page_id,live);assert.ok(!deleted.pages.some(item=>item.id===first));
  await page.getByRole('button',{name:'Chiếu trang',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#show-page').textContent==='Đang chiếu');await signals.next();
  assert.equal((await state(page)).current_page_id,second);assert.equal(await picker.inputValue(),second);
  // Deleting the live page is the documented exception: select/project a fallback.
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Xóa trang',exact:true}).click();
  await page.waitForFunction(id=>document.querySelector('#page-select').value===id&&document.querySelector('#show-page').textContent==='Đang chiếu',live);await signals.next();
  const fallback=await state(page);
  assert.equal(fallback.current_page_id,live);assert.ok(!fallback.pages.some(item=>item.id===second));assert.deepEqual(errors,[]);
});

test('Control preserves focused and dirty cycle input and unfinished page-name editing across unrelated HTTP reconciliation', {timeout:30000},async t=>{
  const {page,headers,signals,errors}=await contractControl(t),live=(await state(page)).current_page_id;
  await page.getByRole('button',{name:/Tạo trang/}).click();
  await page.waitForFunction(id=>document.querySelector('#page-select').value!==id,live);await signals.next();
  const selected=await page.locator('#page-select').inputValue(),cycle=page.locator('#rotation-seconds');
  async function renameFromAnotherOperator(name){
    const response=await page.request.patch(origin+'/api/pages/'+selected,{headers,data:{name}});
    assert.equal(response.status(),200);signals.socket.send(await signals.next());
    await page.waitForFunction(({id,name})=>Array.from(document.querySelector('#page-select').options).find(option=>option.value===id)?.textContent===name,{id:selected,name});
  }
  await cycle.fill('37');await renameFromAnotherOperator('Đồng bộ khi đang nhập chu kỳ');
  assert.equal(await cycle.inputValue(),'37');assert.equal(await cycle.evaluate(node=>node===document.activeElement),true);
  await page.locator('#stage-title').click();await renameFromAnotherOperator('Đồng bộ khi đã rời ô chu kỳ');
  assert.equal(await cycle.inputValue(),'37');
  await page.getByRole('button',{name:'Đổi tên trang',exact:true}).click();
  const input=page.getByLabel('Tên trang',{exact:true});await input.fill('Tên còn đang nhập, chưa lưu');
  const settings=await page.request.patch(origin+'/api/settings',{headers,data:{rotation_seconds:11}});
  assert.equal(settings.status(),200);await signals.next();
  await renameFromAnotherOperator('Tên từ server không thay nội dung đang nhập');
  assert.equal(await input.inputValue(),'Tên còn đang nhập, chưa lưu');
  assert.equal(await input.evaluate(node=>node===document.activeElement),true);
  assert.equal(await cycle.inputValue(),'37');assert.equal(await page.locator('#page-select').inputValue(),selected);
  const after=await state(page);assert.equal(after.settings.rotation_seconds,11);assert.equal(after.current_page_id,live);
  assert.equal(after.pages.find(item=>item.id===selected).name,'Tên từ server không thay nội dung đang nhập');
  assert.deepEqual(errors,[]);
});

test('Control keeps authoritative refreshed state when a delayed mutation response is older', {timeout:30000},async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const login=await page.request.post(origin+'/api/admin/login',{data:{pin:'2468'}});
  assert.equal(login.status(),200);
  const headers={Authorization:'Bearer '+(await login.json()).token};
  const before=await state(page);
  const created=await page.request.post(origin+'/api/pages',{headers,data:{}});
  assert.equal(created.status(),200);
  const offAir=(await created.json()).pages.find(item=>!before.pages.some(old=>old.id===item.id));
  assert.ok(offAir);
  // Hold back change notifications so the explicit post-mutation HTTP refresh is
  // the only reconciliation source. The real server and mutation APIs still run.
  await page.routeWebSocket('**/ws/display',socket=>{
    const remote=socket.connectToServer();
    remote.onMessage(message=>{
      const type=JSON.parse(String(message)).type;
      if(!['state_changed','drawing_created'].includes(type))socket.send(message);
    });
  });
  await page.goto(origin+'/control/');
  await page.getByLabel('Mã quản lý',{exact:true}).fill('2468');
  await page.getByRole('dialog').getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await page.locator('#login-dialog').waitFor({state:'hidden'});
  await page.getByRole('combobox',{name:/Trang đang chọn/}).selectOption(offAir.id);
  const oldName='Tên từ phản hồi cũ',newName='Tên mới từ HTTP refresh';
  const delivered=Promise.withResolvers();let mutationState,newerState;
  await page.route(origin+'/api/pages/'+offAir.id,async route=>{
    if(route.request().method()!=='PATCH')return route.continue();
    try{
      const response=await route.fetch();assert.equal(response.status(),200);
      mutationState=await response.json();
      // A second operator commits while the first operator's response is in flight.
      const newer=await page.request.patch(origin+'/api/pages/'+offAir.id,{headers,data:{name:newName}});
      assert.equal(newer.status(),200);newerState=await newer.json();
      await route.fulfill({response});delivered.resolve();
    }catch(error){delivered.reject(error);await route.abort();}
  });
  const reconciled=Promise.withResolvers();
  await page.route(origin+'/api/state',async route=>{
    const response=await route.fetch(),value=await response.json();
    await route.fulfill({response});
    if(value.pages.some(item=>item.id===offAir.id&&item.name===newName))reconciled.resolve(value);
  });
  // Observe visible option text, not Control's private state or render functions.
  await page.evaluate(id=>{
    window.controlOptionHistory=[];
    const picker=document.querySelector('#page-select');
    const observer=new MutationObserver(()=>window.controlOptionHistory.push(
      Array.from(picker.options).find(option=>option.value===id)?.textContent));
    observer.observe(picker,{childList:true,subtree:true,characterData:true});
    window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
  },offAir.id);
  await page.getByRole('button',{name:'Đổi tên trang',exact:true}).click();
  await page.getByLabel('Tên trang',{exact:true}).fill(oldName);
  await page.getByRole('button',{name:'Lưu tên',exact:true}).click();
  await delivered.promise;const refreshed=await reconciled.promise;
  await page.waitForFunction(()=>!document.querySelector('#rename-page-dialog').open&&!document.querySelector('#rename-page').disabled);
  assert.ok(refreshed.revision>mutationState.revision);
  assert.equal(refreshed.revision,newerState.revision);
  assert.equal((await state(page)).current_page_id,before.current_page_id);
  assert.equal(await page.locator('#page-select').inputValue(),offAir.id);
  assert.ok((await page.evaluate(()=>window.controlOptionHistory)).includes(newName),'The newer HTTP state must actually reach the UI');
  assert.deepEqual(errors,[]);
  const displayedName=await page.locator('#page-select option').evaluateAll((options,id)=>options.find(option=>option.value===id).textContent,offAir.id);
  assert.equal(displayedName,newName,'An older mutation response must not overwrite the already-rendered authoritative HTTP state');
});

test('Control Ending rehearsal pauses without changing pixels, resumes and replays from the beginning', {timeout:45000},async t=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  t.after(()=>context.close());
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/control/');
  await page.locator('#admin-pin').fill('2468');
  await page.locator('#login-form').getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#login-dialog').open);
  const before=await state(page);
  await page.locator('#ending-image').setInputFiles({name:'circle.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="70" fill="black"/></svg>')});
  await page.waitForFunction(()=>!document.querySelector('#ending-preview-open').disabled);
  await page.locator('#ending-preview-count').selectOption('27');
  await page.locator('#ending-preview-open').click();
  const readTime=async()=>parseFloat(await page.locator('#ending-preview-time').textContent());
  const pixels=()=>page.locator('#ending-preview-host canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data).reduce((hash,value)=>Math.imul(hash^value,16777619)>>>0,2166136261));
  await page.waitForFunction(()=>parseFloat(document.querySelector('#ending-preview-time').textContent)>.8);
  await page.locator('#ending-preview-pause').click();
  assert.equal(await page.locator('#ending-preview-pause').textContent(),'Tiếp tục');
  const paused=await readTime(),digest=await pixels();
  await page.waitForTimeout(350);
  assert.equal(await readTime(),paused);assert.equal(await pixels(),digest);
  await page.locator('#ending-preview-pause').click();
  assert.equal(await page.locator('#ending-preview-pause').textContent(),'Tạm dừng');
  await page.waitForFunction(time=>parseFloat(document.querySelector('#ending-preview-time').textContent)>time+.2,paused);
  await page.locator('#ending-preview-pause').click();
  assert.ok(await readTime()>paused);
  await page.locator('#ending-preview-play').click();
  assert.ok(await readTime()<.5);
  assert.equal(await page.locator('#ending-preview-pause').textContent(),'Tạm dừng');
  await page.locator('#ending-preview-close').click();
  assert.equal(await page.locator('#ending-preview-dialog').evaluate(node=>node.open),false);
  const after=await state(page);
  assert.equal(after.ending,before.ending);
  assert.equal(after.revision,before.revision);
  assert.equal(after.current_page_id,before.current_page_id);
  assert.deepEqual(errors,[]);
});

test('home → Draw; width, undo/redo, reload, failed send/retry → realtime Display and fullscreen shine', {timeout:45000},async t=>{
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});
  t.after(()=>context.close());const draw=await context.newPage(),display=await context.newPage(),errors=[];
  for(const page of [draw,display])page.on('pageerror',e=>errors.push(e.message));
  await display.goto(origin+'/display/');
  await display.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('trực tiếp'));
  let notifications=0;display.on('websocket',socket=>socket.on('framereceived',frame=>{if(String(frame.payload).includes('state_changed'))notifications++;}));
  // Open the Display again so its actual WebSocket is observed before submission.
  await display.reload();
  await display.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('trực tiếp'));
  await draw.goto(origin+'/');await draw.getByRole('link',{name:/Vẽ nét của bạn/}).click();
  await draw.waitForURL('**/draw/');
  await draw.getByRole('button',{name:'Bút',exact:true}).click();
  const weight=draw.getByRole('button',{name:'Nét mức 5',exact:true});await weight.click();assert.equal(await weight.getAttribute('aria-pressed'),'true');
  await draw.getByRole('button',{name:'Nét mức 3',exact:true}).click();await draw.getByRole('button',{name:'Đóng tùy chỉnh bút',exact:true}).click();
  const box=await draw.getByLabel('Vùng vẽ của khách tham quan',{exact:true}).boundingBox();
  await draw.mouse.move(box.x+box.width*.2,box.y+box.height*.4);await draw.mouse.down();
  for(let step=1;step<=16;step++)await draw.mouse.move(box.x+box.width*(.2+step*.035),box.y+box.height*(.4+Math.sin(step*.25)*.06));
  await draw.mouse.up();
  const send=draw.getByRole('button',{name:'Khắc tác phẩm',exact:true});await usable(draw,send);
  const original=await canvasPixels(draw);assert.equal(original.hasInk,true);
  await draw.getByRole('button',{name:'Hoàn tác',exact:true}).click();assert.equal((await canvasPixels(draw)).hasInk,false);assert.equal(await send.isEnabled(),false);
  await draw.getByRole('button',{name:'Làm lại',exact:true}).click();assert.deepEqual(await canvasPixels(draw),original);
  await draw.reload();await usable(draw,send);assert.deepEqual(await canvasPixels(draw),original);
  let attempts=0;
  await draw.route('**/api/drawings',route=>route.request().method()==='POST'&&++attempts===1?route.abort('failed'):route.continue());
  await send.click();await draw.getByRole('status').filter({hasText:'Chưa thể khắc'}).waitFor();
  assert.deepEqual(await canvasPixels(draw),original);assert.equal((await state(draw)).drawings.length,0);
  const submitted=draw.waitForResponse(response=>response.url()===origin+'/api/drawings'&&response.request().method()==='POST');
  await send.click();const result=await submitted;assert.equal(result.status(),201);const drawing=await result.json();
  await draw.waitForFunction(()=>document.querySelector('#send-button').disabled);
  assert.equal((await canvasPixels(draw)).hasInk,false);assert.equal((await state(draw)).drawings.length,1);
  const vectors=await (await draw.request.get(origin+drawing.vector_path)).json();
  assert.equal(vectors.strokes[0].width,2);assert.equal(vectors.strokes[0].material,'mono-v1');assert.ok(vectors.strokes[0].points.every(point=>point.length===3));
  assert.match(await (await draw.request.get(origin+drawing.image_path)).text(),/data-material="mono-v1"/);
  const artwork=display.getByRole('img',{name:'Nét vẽ của khách tham quan',exact:true});await artwork.waitFor();assert.ok(notifications>0);
  await display.bringToFront();await display.locator('body').click({position:{x:10,y:10}});await display.keyboard.press('f');
  await display.waitForFunction(()=>Boolean(document.fullscreenElement));
  const first=await artwork.evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data));
  await display.waitForFunction(previous=>{
    const canvas=document.querySelector('canvas[role="img"]'),next=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    return next.some((value,index)=>index%4!==3&&value!==previous[index]);
  },first,{timeout:8000});
  const alphaDelta=await artwork.evaluate((canvas,previous)=>{
    const next=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let delta=0;for(let index=3;index<next.length;index+=4)delta=Math.max(delta,Math.abs(next[index]-previous[index]));return delta;
  },first);assert.equal(alphaDelta,0);
  // Use the app's public toggle; Escape is not forwarded to fullscreen in headless Chrome.
  await display.keyboard.press('f');await display.waitForFunction(()=>!document.fullscreenElement);
  assert.deepEqual(errors,[]);
});

test('Control login → edit an off-air page → favorite SVG → save/project moment → delete off-air page', {timeout:45000},async t=>{
  const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Seed through the public API, never by editing server state or storage files.
  const response=await page.request.post(origin+'/api/drawings',{multipart:{submission_id:require('node:crypto').randomUUID().replaceAll('-',''),strokes:JSON.stringify({version:2,profile:'led-2px',strokes:[{erase:false,material:'mono-v1',width:2,points:[[100,100,.5],[600,600,.5]]}]})}});
  assert.equal(response.status(),201);const drawing=await response.json();
  await page.goto(origin+'/');await page.getByRole('link',{name:/Bàn điều khiển/}).click();await page.waitForURL('**/control/');
  assert.equal(await page.getByRole('button',{name:/Tạo trang/}).isEnabled(),false);
  await page.getByLabel('Mã quản lý',{exact:true}).fill('2468');await page.getByRole('dialog').getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await page.locator('#login-dialog').waitFor({state:'hidden'});
  const live=(await state(page)).current_page_id;
  await page.getByRole('button',{name:/Tạo trang/}).click();await page.getByText('Bản xem trước trang',{exact:true}).waitFor();
  const picker=page.getByRole('combobox',{name:/Trang đang chọn/}),selected=await picker.inputValue();assert.notEqual(selected,live);assert.equal((await state(page)).current_page_id,live);
  await page.getByRole('button',{name:'Đổi tên trang',exact:true}).click();await page.getByLabel('Tên trang',{exact:true}).fill('Trang hồi quy');await page.getByRole('button',{name:'Lưu tên',exact:true}).click();
  await page.locator('#rename-page-dialog').waitFor({state:'hidden'});assert.equal((await state(page)).pages.find(p=>p.id===selected).name,'Trang hồi quy');
  await page.getByRole('combobox',{name:/Ô đang chọn/}).selectOption('4');await page.getByPlaceholder('Tìm mã hình…').fill(drawing.id);
  await page.getByRole('button',{name:'＋ Thêm vào ô 5',exact:true}).click();await page.getByText('1 hình',{exact:true}).waitFor();
  let current=await state(page);assert.equal(current.current_page_id,live);assert.equal(current.pages.find(p=>p.id===selected).cells[4].active,drawing.id);
  await page.getByRole('button',{name:'Thêm vào yêu thích',exact:true}).click();await page.getByRole('button',{name:'Bỏ khỏi yêu thích',exact:true}).waitFor();
  await page.getByRole('button',{name:'♥ Yêu thích',exact:true}).click();
  const favorite=await page.request.get(origin+'/api/favorites/'+drawing.id),original=await page.request.get(origin+drawing.image_path);
  assert.equal(favorite.status(),200);assert.equal(await favorite.text(),await original.text());
  const saved=page.waitForResponse(r=>r.url()===origin+'/api/snapshots'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Lưu khoảnh khắc',exact:true}).click();const momentResponse=await saved;assert.equal(momentResponse.status(),201);const moment=await momentResponse.json();
  current=await state(page);assert.equal(current.current_page_id,live);
  const layout=current.pages.find(p=>p.id===moment.page_id);assert.deepEqual(layout.cells[4].drawing_ids,[drawing.id]);
  assert.equal(layout.cells.reduce((count,c)=>count+c.drawing_ids.length,0),1);
  await page.locator('#moments-panel summary').click();
  const projected=page.waitForResponse(r=>r.url().endsWith('/api/pages/'+moment.page_id+'/activate')&&r.status()===200);
  await page.getByRole('button',{name:'Chiếu khoảnh khắc',exact:true}).click();await projected;
  assert.equal((await state(page)).current_page_id,moment.page_id);
  await picker.selectOption(selected);page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Xóa trang',exact:true}).click();
  await page.waitForFunction(id=>!Array.from(document.querySelector('#page-select').options).some(option=>option.value===id),selected);
  current=await state(page);assert.equal(current.current_page_id,moment.page_id);assert.ok(!current.pages.some(p=>p.id===selected));
  assert.deepEqual(errors,[]);
});

test('Display reconnects after a real server restart, catches missed drawings and keeps receiving WebSocket updates without reload', {timeout:45000},async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  const display=await context.newPage(),errors=[];let connections=0,notifications=0,navigations=0;
  display.on('pageerror',error=>errors.push(error.message));
  display.on('websocket',socket=>{connections++;socket.on('framereceived',frame=>{if(String(frame.payload).includes('state_changed'))notifications++;});});
  await display.goto(origin+'/display/');
  await display.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('trực tiếp'));
  display.on('framenavigated',frame=>{if(frame===display.mainFrame())navigations++;});
  const before=await state(display),oldOrigin=origin,oldConnections=connections;
  await context.setOffline(true);await stopServer();
  await display.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('Mất kết nối'));
  await startServer(Number(new URL(oldOrigin).port));assert.equal(origin,oldOrigin);
  const recovered=await state(display);
  assert.deepEqual(recovered.drawings,before.drawings);assert.equal(recovered.current_page_id,before.current_page_id);
  async function submit(x){
    const response=await context.request.post(origin+'/api/drawings',{multipart:{submission_id:require('node:crypto').randomUUID().replaceAll('-',''),
      strokes:JSON.stringify({version:2,profile:'led-2px',strokes:[{erase:false,material:'mono-v1',width:2,points:[[100,100,.5],[x,500,.5]]}]})}});
    assert.equal(response.status(),201);return response.json();
  }
  const missed=await submit(400);
  const catchup=display.waitForResponse(async response=>response.url()===origin+'/api/state'&&response.ok()&&(await response.json()).drawings.some(d=>d.id===missed.id));
  await context.setOffline(false);await catchup;
  await display.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('trực tiếp'));
  assert.ok(connections>oldConnections);
  const earlierNotifications=notifications,newDrawing=await submit(500);
  const fresh=await state(display);assert.ok(fresh.drawings.some(d=>d.id===newDrawing.id));
  const activeCount=fresh.pages.find(p=>p.id===fresh.current_page_id).cells.filter(c=>c.active).length;
  await display.waitForFunction(count=>document.querySelectorAll('canvas[role="img"]').length===count,activeCount);
  assert.ok(notifications>earlierNotifications);assert.equal(navigations,0);assert.deepEqual(errors,[]);
});

test('Control uploads an Ending mask → prepare → real Display ready → start → reset to the unchanged normal page', {timeout:45000},async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  const control=await context.newPage(),display=await context.newPage(),errors=[];
  for(const page of [control,display])page.on('pageerror',error=>errors.push(error.message));
  await control.goto(origin+'/control/');
  const loggedIn=control.waitForResponse(r=>r.url()===origin+'/api/admin/login'&&r.ok());
  await control.getByLabel('Mã quản lý',{exact:true}).fill('2468');
  await control.getByRole('dialog').getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await loggedIn;
  await control.locator('#login-dialog').waitFor({state:'hidden'});
  const original=(await state(control)).current_page_id;
  const prepare=control.getByRole('button',{name:'Chuẩn bị LED',exact:true}),start=control.getByRole('button',{name:'Bắt đầu trên LED',exact:true});
  assert.equal(await prepare.isEnabled(),false);assert.equal(await start.isEnabled(),false);
  // A real uploaded SVG silhouette exercises the browser's file/mask conversion.
  await control.getByLabel(/Ảnh đích/).setInputFiles({name:'ending-test.svg',mimeType:'image/svg+xml',
    buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect x="10" y="10" width="44" height="44" fill="black"/></svg>')});
  const prepared=control.waitForResponse(r=>r.url()===origin+'/api/ending/prepare'&&r.ok());
  await prepare.click();const frozen=(await (await prepared).json()).ending;
  assert.equal(frozen.phase,'PREPARE');assert.equal(frozen.start_time,null);assert.equal(frozen.page_id,original);
  assert.equal(await start.isEnabled(),false); // No Display exists to acknowledge readiness yet.
  await display.goto(origin+'/display/');
  await control.waitForFunction(()=>!document.querySelector('#ending-start').disabled);
  const ready=(await state(control)).ending;assert.ok(ready.ready_displays.length>0);
  const started=control.waitForResponse(r=>r.url()===origin+'/api/ending/'+frozen.id+'/start'&&r.ok());
  await start.click();const running=(await (await started).json()).ending;assert.ok(running.start_time>0);assert.equal(running.phase,'CONVERGE');
  const collective=display.getByLabel('Dấu Ấn tập thể',{exact:true});await collective.waitFor({state:'visible'});
  await display.waitForFunction(()=>{
    const canvas=document.querySelector('canvas[aria-label="Dấu Ấn tập thể"]');
    return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>0);
  });
  const reset=control.waitForResponse(r=>r.url()===origin+'/api/ending/'+frozen.id+'/reset'&&r.ok());
  await control.getByRole('button',{name:'Về trình chiếu',exact:true}).click();await reset;
  await collective.waitFor({state:'hidden'});const normal=await state(control);
  assert.equal(normal.ending,undefined);assert.equal(normal.current_page_id,original);
  const page=normal.pages.find(p=>p.id===original);
  // Reset resumes carousel clocks, so compare the visible layout/queues, not timestamps.
  const layout=cells=>cells.map(({id,active,drawing_ids})=>({id,active,drawing_ids}));
  assert.deepEqual(layout(page.cells),layout(frozen.cells));
  await display.getByRole('img',{name:'Nét vẽ của khách tham quan',exact:true}).first().waitFor();
  assert.deepEqual(errors,[]);
});

test('mobile touch: Retina, no scroll, secondary finger ignored, cancellation and next stroke remain usable', {timeout:45000},async t=>{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  t.after(()=>context.close());const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/draw/');
  const canvas=page.getByLabel('Vùng vẽ của khách tham quan',{exact:true});
  const dimensions=await canvas.evaluate(c=>({width:c.width,height:c.height,dpr:devicePixelRatio,touchAction:getComputedStyle(c).touchAction}));
  assert.deepEqual(dimensions,{width:2160,height:2160,dpr:3,touchAction:'none'});
  await page.getByRole('button',{name:'Bút',exact:true}).tap();
  await page.getByRole('button',{name:'Nét mức 3',exact:true}).tap();
  await page.getByRole('button',{name:'Đóng tùy chỉnh bút',exact:true}).tap();
  const box=await canvas.boundingBox(),cdp=await context.newCDPSession(page),scroll=await page.evaluate(()=>scrollY);
  const primary={id:1,x:box.x+box.width*.2,y:box.y+box.height*.3},secondary={id:2,x:box.x+box.width*.8,y:box.y+box.height*.7};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[primary,secondary]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...primary,x:primary.x+60,y:primary.y+40},secondary]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  const dot={id:3,x:box.x+box.width*.4,y:box.y+box.height*.8};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[dot]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(await page.evaluate(()=>scrollY),scroll);assert.equal((await canvasPixels(page)).hasInk,true);
  const saved=page.waitForResponse(r=>r.url()===origin+'/api/drawings'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Khắc tác phẩm',exact:true}).tap();
  const response=await saved;assert.equal(response.status(),201);const drawing=await response.json();
  const vectors=await (await context.request.get(origin+drawing.vector_path)).json();
  assert.equal(vectors.strokes.length,2);assert.equal(vectors.strokes[1].points.length,1);
  for(const stroke of vectors.strokes){assert.equal(stroke.width,2);assert.equal(stroke.material,'mono-v1');assert.ok(stroke.points.every(([x,y,p])=>x>=0&&x<=720&&y>=0&&y<=720&&p>=0&&p<=1));}
  await page.waitForFunction(()=>document.querySelector('#send-button').disabled);
  assert.equal((await canvasPixels(page)).hasInk,false);assert.deepEqual(errors,[]);
});

test('Ending SVG upload rejects script, event handlers and external images before executing or fetching them', {timeout:45000},async t=>{
  const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage(),errors=[];let dialogs=0,external=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async dialog=>{dialogs++;await dialog.dismiss();});
  await context.route('https://evil.invalid/**',route=>{external++;return route.abort();});
  await page.goto(origin+'/control/');await page.getByRole('dialog').getByRole('button',{name:'Xem trước',exact:true}).click();
  const files=[
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("unsafe")</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.invalid/image"/></svg>',
  ];
  for(const [i,svg] of files.entries()){
    await page.getByLabel(/Ảnh đích/).setInputFiles({name:`unsafe-${i}.svg`,mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
    await page.locator('#notice').filter({hasText:/SVG/}).waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#ending-mask-label').textContent==='Chưa chọn ảnh');
    assert.equal(await page.getByRole('button',{name:'Xem thử',exact:true}).isEnabled(),false);
  }
  assert.equal(dialogs,0);assert.equal(external,0);assert.deepEqual(errors,[]);
});

test('two Displays survive 60 submissions and independent carousel crossfades without unbounded DOM layers', {timeout:45000},async t=>{
  const context=await browser.newContext({viewport:{width:1536,height:768}});t.after(()=>context.close());
  const pages=[await context.newPage(),await context.newPage()],errors=[];
  for(const page of pages){page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/display/');}
  const login=await context.request.post(origin+'/api/admin/login',{data:{pin:'2468'}});const headers={Authorization:'Bearer '+(await login.json()).token};
  await context.request.patch(origin+'/api/settings',{headers,data:{paused:false,rotation_seconds:2,led_fade:.2}});
  let cursor=0;
  await Promise.all(Array.from({length:6},async()=>{
    while(cursor<60){const index=cursor++;
      const response=await context.request.post(origin+'/api/drawings',{multipart:{submission_id:require('node:crypto').randomUUID().replaceAll('-',''),
        strokes:JSON.stringify({version:2,profile:'led-2px',strokes:[{erase:false,material:'mono-v1',width:2,points:[[100,100,.5],[500+index,400,.5]]}]})}});
      assert.equal(response.status(),201);
    }
  }));
  const initial=await state(pages[0]),pageId=initial.current_page_id;
  const cells=initial.pages.find(p=>p.id===pageId).cells;
  assert.ok(cells.every(c=>c.drawing_ids.length>=2));
  const expected=cells.map(c=>`Ô ${c.id+1}, ${c.drawing_ids.length} hình`);
  for(const page of pages){await page.waitForFunction(labels=>labels.every(label=>document.querySelector(`[aria-label="${label}"]`)),expected);}
  const sessions=await Promise.all(pages.map(page=>context.newCDPSession(page)));
  async function heaps(){return Promise.all(sessions.map(async session=>{
    await session.send('HeapProfiler.collectGarbage');return (await session.send('Runtime.getHeapUsage')).usedSize;
  }));}
  const heapBefore=await heaps();
  for(let cycle=0;cycle<4;cycle++){
    await pages[0].waitForTimeout(2200);
    for(const page of pages){
      const counts=await page.getByRole('img',{name:'Nét vẽ của khách tham quan',exact:true}).count();assert.ok(counts>=27&&counts<=54);
    }
  }
  const current=(await state(pages[0])).pages.find(p=>p.id===pageId).cells;
  assert.ok(current.some((cell,i)=>cell.active!==cells[i].active||cell.shown_at>cells[i].shown_at));
  const queues=current.flatMap(c=>c.drawing_ids);assert.equal(new Set(queues).size,queues.length);
  const heapAfter=await heaps();
  heapAfter.forEach((bytes,i)=>assert.ok(bytes-heapBefore[i]<8*1024*1024,'Short-run JS heap growth exceeds 8 MiB after GC'));
  t.diagnostic('Post-GC JS heap deltas (bytes): '+heapAfter.map((bytes,i)=>bytes-heapBefore[i]).join(', '));
  const settings=await context.request.patch(origin+'/api/settings',{headers,data:{paused:true}});assert.equal(settings.status(),200);
  assert.deepEqual(errors,[]);
});

test('Display stays open through 120 seconds offline and three reconnect cycles, then receives new drawings', {timeout:180000},async t=>{
  const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage(),errors=[];let navigations=0,connections=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('websocket',()=>connections++);
  await page.goto(origin+'/display/');await page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('trực tiếp'));
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  const before=await state(page);
  for(const duration of [120000,3000,3000]){
    const previousConnections=connections;await context.setOffline(true);
    // Chromium's offline flag can leave an already-open WebSocket alive.
    // Stop only our test server to guarantee a real transport disconnect.
    const port=Number(new URL(origin).port);await stopServer();
    await page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('Mất kết nối'));
    await startServer(port);
    const response=await context.request.post(origin+'/api/drawings',{multipart:{submission_id:require('node:crypto').randomUUID().replaceAll('-',''),
      strokes:JSON.stringify({version:2,profile:'led-2px',strokes:[{erase:false,material:'mono-v1',width:2,points:[[100,100,.5],[duration/1000+300,500,.5]]}]})}});
    assert.equal(response.status(),201);const drawing=await response.json();
    await page.waitForTimeout(duration);
    const caughtUp=page.waitForResponse(async r=>r.url()===origin+'/api/state'&&r.ok()&&(await r.json()).drawings.some(d=>d.id===drawing.id));
    await context.setOffline(false);await caughtUp;
    await page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('trực tiếp'));
    assert.ok(connections>previousConnections);
  }
  const after=await state(page);assert.equal(after.drawings.length,before.drawings.length+3);
  assert.equal(after.current_page_id,before.current_page_id);assert.equal(navigations,0);assert.deepEqual(errors,[]);
});

test('two Displays finish the real 20-second Ending identically after SIGKILL/restart midway and reset without reloading', {timeout:70000},async t=>{
  const contexts=[await browser.newContext({viewport:{width:1536,height:768}}),await browser.newContext({viewport:{width:1536,height:768}})];
  t.after(()=>Promise.all(contexts.map(c=>c.close())));const pages=await Promise.all(contexts.map(c=>c.newPage())),errors=[];let navigations=0;
  const request=contexts[0].request;
  async function login(){const response=await request.post(origin+'/api/admin/login',{data:{pin:'2468'}});assert.equal(response.status(),200);return {Authorization:'Bearer '+(await response.json()).token};}
  let headers=await login();
  for(let i=0;i<3;i++){
    const response=await request.post(origin+'/api/drawings',{multipart:{submission_id:require('node:crypto').randomUUID().replaceAll('-',''),
      strokes:JSON.stringify({version:2,profile:'led-2px',strokes:[{erase:false,material:'mono-v1',width:2,points:[[100,100,.5],[400+i*50,500,.5]]}]})}});
    assert.equal(response.status(),201);
  }
  const original=await state(pages[0]);
  const mask={width:64,height:64,points:Array.from({length:576},(_,i)=>[8+(i%24)*2,8+Math.floor(i/24)*2])};
  const prepared=await request.post(origin+'/api/ending/prepare',{headers,data:{request_id:require('node:crypto').randomUUID().replaceAll('-',''),mask,seed:'durable-two-displays'}});
  assert.equal(prepared.status(),200);const frozen=(await prepared.json()).ending;
  for(const page of pages){page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/display/');page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});}
  await waitState(pages[0],state=>state.ending?.ready_displays.length===2);
  const completions=pages.map(page=>page.getByLabel('Dấu Ấn tập thể',{exact:true}).evaluate(canvas=>new Promise(resolve=>canvas.addEventListener('ending-complete',e=>resolve(e.detail),{once:true}))));
  const started=await request.post(origin+'/api/ending/'+frozen.id+'/start',{headers});assert.equal(started.status(),200,await started.text());
  const start=(await started.json()).ending.start_time;
  await pages[0].waitForTimeout(7000);
  const port=Number(new URL(origin).port);await stopServer('SIGKILL');await startServer(port);
  const recovered=(await state(pages[0])).ending;assert.equal(recovered.id,frozen.id);assert.equal(recovered.start_time,start);assert.deepEqual(recovered.drawings,frozen.drawings);
  assert.equal((await request.post(origin+'/api/ending/'+frozen.id+'/reset',{headers})).status(),401);
  headers=await login();
  const complete=await Promise.all(completions);assert.equal(complete[0].finalDrawingId,complete[1].finalDrawingId);
  await waitState(pages[0],state=>state.ending?.phase==='LOCKED');
  await pages[0].waitForTimeout(700); // Let the final frame settle on both screens, without a screenshot baseline.
  async function digest(page){return page.getByLabel('Dấu Ấn tập thể',{exact:true}).evaluate(canvas=>{
    const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let hash=2166136261,ink=0;
    for(let i=0;i<pixels.length;i++){hash=Math.imul(hash^pixels[i],16777619)>>>0;if(i%4===3&&pixels[i])ink++;}return {hash,ink};
  });}
  const first=await Promise.all(pages.map(digest));assert.ok(first[0].ink>0);assert.deepEqual(first[0],first[1]);
  await pages[0].waitForTimeout(500);assert.deepEqual(await Promise.all(pages.map(digest)),first);
  const reset=await request.post(origin+'/api/ending/'+frozen.id+'/reset',{headers});assert.equal(reset.status(),200);
  for(const page of pages)await page.getByLabel('Dấu Ấn tập thể',{exact:true}).waitFor({state:'hidden'});
  const normal=await state(pages[0]);assert.equal(normal.ending,undefined);assert.equal(normal.current_page_id,original.current_page_id);
  assert.equal(normal.drawings.length,original.drawings.length);assert.equal(navigations,0);assert.deepEqual(errors,[]);
});
