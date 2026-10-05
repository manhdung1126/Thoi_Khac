import {ENDING_CONFIG} from './config.js';
import {compose} from './composition.js';
import {loadArtwork} from './assets.js';
import {EndingPreview} from './preview.js';
import {api,apiUrl} from '../shared/api.js';
import {LED} from '../shared/led.js';

// Shared production and Control rehearsal: identical snapshot, targets and motion.
export class EndingPresentation{
  constructor(host,{display=false,rehearsal=false,onError=()=>{},onReady=()=>{},onTime=()=>{}}={}){
    this.host=host;this.display=display;this.rehearsal=rehearsal;this.onError=onError;this.onReady=onReady;
    this.clientId=crypto.randomUUID();this.generation=0;this.serverOffset=0;
    host.classList.add('ending-presentation');host.hidden=true;
    host.innerHTML='<div class="ending-frame"><img class="ending-background" alt=""><canvas aria-label="Dấu Ấn tập thể"></canvas><p class="ending-final-text" hidden></p></div>';
    this.frame=host.querySelector('.ending-frame');this.canvas=host.querySelector('canvas');this.text=host.querySelector('p');
    host.querySelector('img').src=apiUrl(LED.background);this.text.textContent=ENDING_CONFIG.finalText;
    this.preview=new EndingPreview(this.canvas,(time,running)=>{
      this.text.hidden=!ENDING_CONFIG.finalText||time<19.2;onTime(time,running);
    });
    this.resize=new ResizeObserver(([entry])=>{const {width,height}=entry.contentRect;this.frame.style.transform='translate(-50%,-50%) scale('+Math.min(width/1536,height/768)+')';});
    this.resize.observe(host);
  }
  update(state){
    this.latest=state.ending;this.serverOffset=(state.server_time||Date.now()/1000)*1000-Date.now();
    if(!state.ending){this.clear();return;}
    if(this.key!==state.ending.id){
      this.clear();this.key=state.ending.id;
      void this.prepare(state.ending);
    }else if(this.ready)this.sync();
    else if(!this.loading&&Date.now()>=(this.retryAt||0))void this.prepare(state.ending);
  }
  async prepare(session){
    this.loading=true;
    const version=++this.generation;this.controller=new AbortController();const signal=this.controller.signal;
    const controller=this.controller;
    const timer=setTimeout(()=>controller.abort(new Error('Tải bộ Ending quá lâu. Kiểm tra kết nối rồi tải lại Display.')),40000);
    try{
      if(session.motion_version!==2)throw Error('Phiên Ending cần tải lại ứng dụng.');
      const targets=compose({...ENDING_CONFIG,drawings:session.drawings,mask:session.mask,seed:session.seed,viewport:session.viewport});
      const artwork=new Map();let cursor=0;
      await Promise.all(Array.from({length:Math.min(6,session.drawings.length)},async()=>{
        while(cursor<session.drawings.length&&!signal.aborted){
          const drawing=session.drawings[cursor++];artwork.set(drawing.id,await loadArtwork(drawing,signal));
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }));
      if(signal.aborted||version!==this.generation)return;
      this.preview.prepare({seed:session.seed,viewport:session.viewport,targets,flowBounds:ENDING_CONFIG.flowBounds},artwork,session.cells);
      this.ready=true;this.onReady(true);this.sync();
      if(this.display){void this.acknowledge();this.heartbeat=setInterval(()=>void this.acknowledge(),15000);}
    }catch(error){
      if(version===this.generation){const message=signal.aborted?(signal.reason?.message||error.message):error.message;controller.abort();this.ready=false;this.retryAt=Date.now()+5000;this.onReady(false);this.onError(message);}
    }finally{clearTimeout(timer);if(version===this.generation)this.loading=false;}
  }
  async acknowledge(){
    if(!this.ready||!this.key)return;
    const id=this.key;
    try{await api('/api/ending/'+id+'/ready',{method:'POST',body:{client_id:this.clientId,ready:true}});}catch(error){if(this.ready&&this.key===id)this.onError(error.message);}
  }
  sync(){
    if(this.rehearsal){this.host.hidden=false;return;}
    const start=this.latest?.start_time;
    this.host.hidden=!start;
    if(!start)return;
    const elapsed=Math.max(0,(Date.now()+this.serverOffset)/1000-start);
    this.preview.pause();this.preview.seek(Math.min(20,elapsed));
    if(elapsed<20){
      if(this.startTimer)clearTimeout(this.startTimer);
      if(elapsed===0&&start>(Date.now()+this.serverOffset)/1000){
        this.startTimer=setTimeout(()=>this.sync(),Math.max(0,start*1000-Date.now()-this.serverOffset));
      }else this.preview.play();
    }
  }
  play(){if(this.ready){this.preview.pause();this.preview.seek(0);this.preview.play();}}
  clear(){
    this.generation++;this.controller?.abort();clearInterval(this.heartbeat);clearTimeout(this.startTimer);
    this.preview.destroy();this.ready=false;this.loading=false;this.retryAt=0;this.key=null;this.host.hidden=true;this.onReady(false);
  }
  destroy(){this.clear();this.resize.disconnect();this.host.replaceChildren();}
}
