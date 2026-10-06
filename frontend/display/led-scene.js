import {apiUrl} from '../shared/api.js';
import {LED,cellGeometry,paintLedVectors} from '../shared/led.js';
import {paintMetallicMask} from '../shared/metallic.js?v=20261006-exhibition';

export class LEDScene{
  constructor(host,{onError=()=>{},onSelect=()=>{},grid=false,animateMetal=!matchMedia('(prefers-reduced-motion: reduce)').matches}={}){
    this.host=host;this.onError=onError;this.onSelect=onSelect;this.grid=grid;this.cache=new Map();this.nodes=[];this.destroyed=false;this.lastShine=0;
    host.classList.add('led-viewport');
    host.setAttribute('aria-label','Màn LED 1536 × 768 · 27 ô nét vẽ');
    host.innerHTML='<div class="led-scene"><img class="led-background" alt=""/><div class="led-cells"></div></div>';
    this.scene=host.querySelector('.led-scene');this.background=host.querySelector('.led-background');this.background.src=apiUrl(LED.background);
    this.background.onerror=()=>onError('Không tải được nền cuộn sớ LED.');
    this.layer=host.querySelector('.led-cells');
    for(let i=0;i<LED.count;i++){
      const node=document.createElement(grid?'button':'div'),box=cellGeometry(i);
      node.className='led-cell';node.style.left=box.x+'px';node.style.top=box.y+'px';
      node.style.width=node.style.height=LED.size+'px';
      if(grid){node.type='button';node.addEventListener('click',()=>this.onSelect(this.nodes[i].id,i));}
      const label=document.createElement('span');label.className='led-cell-label';label.textContent=String(i+1);label.hidden=!grid;node.append(label);
      this.layer.append(node);this.nodes.push({node,id:null,version:0,layers:[],shineOffset:(i%9)/90});
    }
    this.scene.classList.toggle('led-grid',grid);
    this.resize=new ResizeObserver(([entry])=>{const {width,height}=entry.contentRect;this.scene.style.transform=`translate(-50%,-50%) scale(${Math.min(width/LED.width,height/LED.height)})`;});
    this.resize.observe(host);
    this.animateMetal=animateMetal;
    this.resumeShine=()=>{
      cancelAnimationFrame(this.shineFrame);
      this.lastShine=0;
      if(!this.destroyed&&this.animateMetal&&!document.hidden)this.shineFrame=requestAnimationFrame(time=>this.animateShine(time));
    };
    document.addEventListener('visibilitychange',this.resumeShine);
    document.addEventListener('fullscreenchange',this.resumeShine);
    this.resumeShine();
  }
  async asset(drawing){
    const key=drawing.id;
    if(!this.cache.has(key)){
      const task=(async()=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=LED.size;
        const ctx=canvas.getContext('2d');
        let data;
        if(drawing.vector_path){
          const response=await fetch(apiUrl(drawing.vector_path),{signal:AbortSignal.timeout(10000)});
          if(!response.ok)throw new Error('Không tải được đường nét LED.');
          data=await response.json();
        }
        if(data&&(data.version!==2||!drawing.image_path)){
          canvas._material=data.strokes.some(s=>s.material==='graphite-v1')?'graphite-v1':'metallic';
          paintLedVectors(ctx,data,'#fff');
        }else{
          // The saved SVG is the material master, also used by the library and
          // favorites. Do not invent a second rasterization of a thin new mark.
          const response=await fetch(apiUrl(drawing.image_path),{signal:AbortSignal.timeout(10000)});
          if(!response.ok)throw new Error('Không tải được SVG.');
          const blob=await response.blob();
          canvas._material=blob.type.includes('svg')&&(await blob.text()).includes('data-material="graphite-v1"')?'graphite-v1':'metallic';
          const img=new Image(),url=URL.createObjectURL(blob);img.src=url;
          let timer;try{
            await Promise.race([img.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Hết thời gian tải SVG.')),10000);})]);
            const available=LED.size-LED.padding*2,ratio=Math.min(available/img.width,available/img.height);
            ctx.drawImage(img,LED.padding+(available-img.width*ratio)/2,LED.padding+(available-img.height*ratio)/2,img.width*ratio,img.height*ratio);
          }finally{clearTimeout(timer);URL.revokeObjectURL(url);}
          if(canvas._material!=='graphite-v1'){ctx.globalCompositeOperation='source-in';ctx.fillStyle='#fff';ctx.fillRect(0,0,LED.size,LED.size);}
        }
        return canvas;
      })();
      this.cache.set(key,task);
      task.catch(()=>this.cache.delete(key));
      while(this.cache.size>81)this.cache.delete(this.cache.keys().next().value);
    }
    return this.cache.get(key);
  }
  render(state){
    this.state=state;
    const page=state.pages.find(p=>p.id===state.current_page_id),library=new Map(state.drawings.filter(d=>!d.deleted).map(d=>[d.id,d]));
    const cells=page?.cells||[];
    this.nodes.forEach((entry,i)=>{
      const cell=cells[i],drawing=library.get(cell?.active);
      entry.node.setAttribute('aria-label',`Ô ${i+1}, ${cell?.drawing_ids.length||0} hình`);
      if(entry.id===(drawing?.id||null))return;
      entry.id=drawing?.id||null;const version=++entry.version;
      // Do not crossfade old page content into a different page.
      if(this.pageId!==page?.id){entry.layers.forEach(layer=>{layer.getAnimations().forEach(a=>a.cancel());layer.remove();});entry.layers=[];}
      void this.swap(entry,drawing,version);
    });this.pageId=page?.id;
  }
  async swap(entry,drawing,version){
    try{
      const bitmap=drawing?await this.asset(drawing):null;
      if(this.destroyed||entry.version!==version)return;
      const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:(this.state.settings.led_fade??1.2)*1000;
      // Retain at most the last visible layer during a burst of submissions.
      while(entry.layers.length>1){const old=entry.layers.shift();old.getAnimations().forEach(a=>a.cancel());old.remove();}
      const previous=entry.layers.at(-1);
      if(previous){previous.getAnimations().forEach(a=>a.cancel());const out=previous.animate([{opacity:1},{opacity:0}],{duration,fill:'forwards'});out.finished.then(()=>{previous.remove();entry.layers=entry.layers.filter(l=>l!==previous);}).catch(()=>{});}
      if(bitmap){
        const canvas=document.createElement('canvas');canvas.width=canvas.height=LED.size;canvas._shineOffset=entry.shineOffset;
        if(bitmap._material==='graphite-v1'){canvas.classList.add('graphite-stroke');canvas.getContext('2d').drawImage(bitmap,0,0);}
        else{canvas._metalMask=bitmap;paintMetallicMask(canvas.getContext('2d'),bitmap,LED.size,.18+entry.shineOffset);}
        canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Nét vẽ của khách tham quan');entry.node.append(canvas);entry.layers.push(canvas);
        const animation=canvas.animate([{opacity:0},{opacity:1}],{duration,fill:'forwards'});
        animation.finished.then(()=>animation.cancel()).catch(()=>{});
      }
    }catch(error){if(!this.destroyed&&entry.version===version){entry.id=null;this.onError(error.message);}}
  }
  animateShine(time){
    if(this.destroyed)return;
    // Fixed-position presentation hosts have no offsetParent even while visible.
    // Client rects also exclude hosts hidden by display:none on an ancestor.
    if(time-this.lastShine>=50&&!document.hidden&&this.host.getClientRects().length>0){
      this.lastShine=time;const phase=(time%6000)/6000;
      for(const entry of this.nodes)for(const layer of entry.layers)if(layer._metalMask)paintMetallicMask(layer.getContext('2d'),layer._metalMask,LED.size,phase+layer._shineOffset);
    }
    this.shineFrame=requestAnimationFrame(next=>this.animateShine(next));
  }
  async capture(value=this.state){
    const state=structuredClone(value);if(!state)throw new Error('Chưa tải được cảnh LED.');
    await this.background.decode();
    const canvas=document.createElement('canvas');canvas.width=LED.width;canvas.height=LED.height;const ctx=canvas.getContext('2d');
    ctx.drawImage(this.background,0,0,LED.width,LED.height);
    // Snapshot uses the same clean background as the live LED; no debug grid.
    const page=state.pages.find(p=>p.id===state.current_page_id),lib=new Map(state.drawings.map(d=>[d.id,d]));
    for(const cell of page?.cells||[]){const drawing=lib.get(cell.active);if(drawing&&!drawing.deleted){const bitmap=await this.asset(drawing),box=cellGeometry(cell.id);
      if(bitmap._material==='graphite-v1')ctx.drawImage(bitmap,box.x,box.y);
      else{const metal=document.createElement('canvas');metal.width=metal.height=LED.size;paintMetallicMask(metal.getContext('2d'),bitmap,LED.size,(performance.now()%6000)/6000+(cell.id%9)/90);ctx.drawImage(metal,box.x,box.y);}
    }}
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Không xuất được ảnh LED.')),'image/png'));
  }
  destroy(){this.destroyed=true;cancelAnimationFrame(this.shineFrame);document.removeEventListener('visibilitychange',this.resumeShine);document.removeEventListener('fullscreenchange',this.resumeShine);this.resize.disconnect();this.nodes.forEach(e=>e.layers.forEach(l=>l.getAnimations().forEach(a=>a.cancel())));this.cache.clear();this.host.replaceChildren();}
}
