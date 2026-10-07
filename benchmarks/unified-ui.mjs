// Visual evidence only: synthetic artwork, isolated server/storage, no exhibition data.
// Run: PLAYWRIGHT_CHANNEL=chrome node benchmarks/unified-ui.mjs root|draw|control|all
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const surface=process.argv[2]||'all',out=path.resolve(root,'.impeccable/review');
const storage=await mkdtemp(path.join(tmpdir(),'cos-ui-review-'));
const server=spawn(path.join(root,'.venv/bin/python'),['-m','uvicorn','backend.app.main:app','--host','127.0.0.1','--port','0'],
  {cwd:root,env:{...process.env,CLOUD_STORAGE_DIR:storage,CLOUD_ADMIN_PIN:'2468'},stdio:['ignore','ignore','pipe']});
let browser;
try {
  const origin=await new Promise((resolve,reject)=>{
    let log='';const timer=setTimeout(()=>reject(Error(log)),15000);
    server.on('error',reject);server.on('exit',code=>{clearTimeout(timer);reject(Error(`Server ${code}: ${log}`));});
    server.stderr.on('data',chunk=>{log+=chunk;const url=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(url){clearTimeout(timer);resolve(url[0]);}});
  });
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  await mkdir(out,{recursive:true});
  const metrics=[],errors=[];
  const devices=[['ipad-portrait',820,1180],['ipad-landscape',1180,820],['phone',390,844],['desktop',1440,900]];
  async function pageAt(route,width,height){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+route);await page.evaluate(()=>document.fonts.ready);
    return page;
  }
  async function capture(page,name){
    await page.waitForTimeout(250); // Settle the existing 150–200 ms control transitions.
    await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
    metrics.push({name,...await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
      canvas:document.querySelector('#drawing-canvas')?.getBoundingClientRect().toJSON(),
      action:(document.querySelector('.begin')||document.querySelector('#send-button'))?.getBoundingClientRect().toJSON()}))});
  }
  async function gesture(page){
    const box=await page.locator('#drawing-canvas').boundingBox();
    await page.mouse.move(box.x+box.width*.2,box.y+box.height*.45);await page.mouse.down();
    for(let i=1;i<=32;i++)await page.mouse.move(box.x+box.width*(.2+i*.018),box.y+box.height*(.45+Math.sin(i*.22)*.1));
    await page.mouse.up();
    await page.waitForFunction(()=>!document.body.classList.contains('is-drawing')&&!document.querySelector('#send-button').disabled);
  }
  if(surface==='root'||surface==='all') {
    for(const [name,width,height]of devices){const page=await pageAt('/',width,height);await capture(page,'root-'+name);await page.context().close();}
  }
  if(surface==='draw'||surface==='all') {
    for(const [name,width,height]of devices.slice(0,3)){
      const page=await pageAt('/draw/',width,height);await capture(page,'draw-empty-'+name);await gesture(page);await capture(page,'draw-'+name);
      if(name==='ipad-portrait'){
        await page.locator('#pencil-button').click();await page.locator('#tool-panel').waitFor({state:'visible'});await capture(page,'draw-tools');await page.locator('#close-tool-panel').click();
        await page.reload();await capture(page,'draw-draft-recovered');
        let release;const gate=new Promise(resolve=>{release=resolve;});
        await page.route('**/api/drawings',async route=>{await gate;await route.abort('failed');});
        await page.locator('#send-button').click();await page.locator('body.is-submitting').waitFor();await capture(page,'draw-submitting');
        release();await page.locator('#upload-status.error').waitFor();await capture(page,'draw-error');
        await page.unroute('**/api/drawings');await page.locator('#send-button').click();await page.locator('#upload-status.success').waitFor();await capture(page,'draw-success');
      }
      await page.context().close();
    }
    const landscape=await pageAt('/draw/',844,390);await gesture(landscape);await capture(landscape,'draw-phone-landscape');await landscape.context().close();
  }
  if(surface==='control'||surface==='all') {
    // Real upload API, synthetic fixtures. Nothing is written to live storage.
    for(let index=0;index<27;index++){
      const colors=['#E7BD00','#2F6972','#1264A3','#B87333'];
      const strokes={version:2,profile:'led-2px',strokes:[{erase:false,width:2,color:colors[index%4],material:'mono-v1',
        points:Array.from({length:40},(_,i)=>[80+i*13,280+100*Math.sin(i*.17+index),.55])}]};
      const form=new FormData();form.set('submission_id',(index+1).toString(16).padStart(32,'0'));form.set('strokes',JSON.stringify(strokes));
      const response=await fetch(origin+'/api/drawings',{method:'POST',body:form});if(!response.ok)throw Error(await response.text());
    }
    for(const [name,width,height]of [['desktop',1440,1000],['small-desktop',1366,900],['tablet',820,1180]]){
      const page=await pageAt('/control/',width,height);await page.locator('#admin-pin').fill('2468');await page.locator('#login-form').getByRole('button',{name:'Đăng nhập',exact:true}).click();
      await page.locator('#login-dialog').waitFor({state:'hidden'});await page.locator('.library-card').first().waitFor();await page.locator('#notice').waitFor({state:'hidden'});
      await capture(page,'control-'+name);await page.context().close();
    }
  }
  // Geometry sanity is separate from screenshot review; no Safari/hardware claim.
  for(const width of [320,375,390,768,820,1024,1366]){
    for(const route of ['/', '/draw/']){
      const page=await pageAt(route,width,width<600?568:1024);metrics.push({route,...await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}))});await page.context().close();
    }
  }
  await writeFile(path.join(out,surface+'-metrics.json'),JSON.stringify({synthetic:true,browser:'Chrome; not physical Safari',metrics,errors},null,2));
  console.log(JSON.stringify({surface,out,captures:metrics.filter(item=>item.name).length,errors,overflow:metrics.filter(item=>item.scrollWidth>item.width)},null,2));
} finally {
  await browser?.close();
  if(server.exitCode===null&&server.signalCode===null){const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;}
  await rm(storage,{recursive:true,force:true}); // Only the mkdtemp directory above.
}
