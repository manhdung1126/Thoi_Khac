import {readMaskFile} from '../ending/mask.js';
import {EndingPresentation} from '../ending/session.js';
import {buildRehearsal} from '../ending/rehearsal.js';

export class EndingControl{
  constructor({mutate,notice,getState,onAccess}){
    this.mutate=mutate;this.notice=notice;this.getState=getState;this.custom=null;
    this.onAccess=onAccess;this.uploadVersion=0;
    this.$=id=>document.getElementById(id);
    this.session=new EndingPresentation(this.$('ending-preview-host'),{
      rehearsal:true,
      onError:message=>{this.$('ending-preview-status').textContent=message;notice(message,true);},
      onReady:ready=>{
        this.$('ending-preview-play').disabled=!ready;this.$('ending-preview-pause').disabled=!ready;
        if(ready){this.$('ending-preview-status').textContent=this.previewLabel;this.session.play();}
      },
      onTime:(time,running)=>{
        this.$('ending-preview-time').textContent=time.toFixed(1)+' / 20 giây';
        this.$('ending-preview-pause').textContent=running?'Tạm dừng':'Tiếp tục';
      },
    });
    this.$('ending-image').onchange=()=>void this.upload();
    this.$('ending-mask-mode').onchange=()=>void this.upload();
    this.$('ending-prepare').onclick=()=>void this.prepare();
    this.$('ending-start').onclick=()=>{
      const id=getState()?.ending?.id;
      if(id)void mutate('/api/ending/'+id+'/start','POST',{},'Đã bắt đầu Dấu Ấn trên màn chiếu.');
    };
    this.$('ending-reset').onclick=()=>{
      const id=getState()?.ending?.id;
      if(id)void mutate('/api/ending/'+id+'/reset','POST',{},'Đã quay lại trình chiếu thường.');
    };
    this.$('ending-preview-open').onclick=()=>this.open();
    this.$('ending-preview-close').onclick=()=>this.$('ending-preview-dialog').close();
    this.$('ending-preview-dialog').addEventListener('close',()=>this.session.clear());
    this.$('ending-preview-play').onclick=()=>this.session.play();
    this.$('ending-preview-pause').onclick=()=>{
      if(this.session.isPlaying())this.session.pause();else this.session.resume();
      this.$('ending-preview-pause').textContent=this.session.isPlaying()?'Tạm dừng':'Tiếp tục';
    };
  }
  async upload(){
    const file=this.$('ending-image').files[0];if(!file)return;
    const version=++this.uploadVersion;this.uploading=true;this.render(this.getState());this.onAccess();
    this.$('ending-mask-label').textContent='Đang đọc ảnh…';
    try{
      const result=await readMaskFile(file,{mode:this.$('ending-mask-mode').value});
      if(version!==this.uploadVersion)return;
      this.custom=result;
    }catch(error){if(version===this.uploadVersion)this.notice(error.message,true);}
    finally{if(version===this.uploadVersion){this.uploading=false;this.render(this.getState());this.onAccess();}}
  }
  async prepare(){
    if(!this.custom||this.uploading)return;
    try{
      await this.mutate('/api/ending/prepare','POST',{
        request_id:crypto.randomUUID(),mask:this.custom.mask,name:this.custom.name,
        seed:this.$('ending-seed').value.trim()||'thoi-khac-01',
      },'Đã chốt nét thật. Đợi màn chiếu sẵn sàng để bắt đầu.');
    }catch(error){this.notice(error.message,true);}
  }
  open(){
    try{
      const state=this.getState(),e=state?.ending;
      if(!state||this.uploading)return;
      const {session,realCount,sampleCount}=buildRehearsal({
        state,mask:e?.mask||this.custom?.mask,name:e?.name||this.custom?.name,
        seed:e?.seed||this.$('ending-seed').value.trim()||'thoi-khac-01',
        count:this.$('ending-preview-count').value,
      });
      this.previewLabel=session.drawings.length+' hình · '+realCount+' nét thật'+(sampleCount?' + '+sampleCount+' nét mẫu':'')+' · chỉ xem thử';
      this.$('ending-preview-status').textContent='Đang tạo bản xem thử…';
      this.$('ending-preview-title').textContent='Dấu Ấn · '+session.drawings.length+' hình';
      if(!this.$('ending-preview-dialog').open)this.$('ending-preview-dialog').showModal();
      this.$('ending-preview-time').textContent='0.0 / 20 giây';
      this.session.update({ending:session});
    }catch(error){this.notice(error.message,true);}
  }
  render(state){
    const e=state.ending,page=state.pages.find(p=>p.id===state.current_page_id);
    const ids=new Set((page?.cells||[]).flatMap(c=>c.drawing_ids));
    const count=e?.drawings.length??state.drawings.filter(d=>!d.deleted&&ids.has(d.id)).length;
    this.$('ending-source').textContent=(e?.page_name||page?.name||'Trang đang chiếu')+' · '+count+' nét thật';
    this.$('ending-preview-count').options[0].textContent='Nét thật ('+count+' hình)';
    const ready=e?.ready_displays?.length||0;
    this.$('ending-state').textContent=!e?'Chưa chuẩn bị':e.start_time?(e.phase==='LOCKED'?'Đã khắc':'Đang chiếu'):ready?'Sẵn sàng':'Đang tải trên LED';
    this.$('ending-step-prepare').classList.toggle('complete',!!e);
    this.$('ending-step-ready').classList.toggle('complete',!!ready||!!e?.start_time);
    this.$('ending-step-start').classList.toggle('complete',!!e?.start_time);
    this.$('ending-next-action').textContent=!e
      ? !count?'Thêm nét thật vào trang đang chiếu trước khi chuẩn bị.':!this.custom?'Chọn ảnh đích, xem thử rồi chuẩn bị LED.':'Có thể xem thử riêng hoặc chuẩn bị LED.'
      : !e.start_time?ready?'LED đã sẵn sàng. Bấm Bắt đầu trên LED khi đến thời điểm kết thúc.':'Đợi màn chiếu tải xong. Nếu chưa sẵn sàng, kiểm tra trang Display đang mở.'
      :'Dấu Ấn đã phát trên LED. Về trình chiếu để kết thúc và trở lại trang thường.';
    this.$('ending-prepare').toggleAttribute('data-locked',!!e||!!this.uploading||!this.custom||!count);
    this.$('ending-start').toggleAttribute('data-locked',!e||!!e.start_time||!ready);
    this.$('ending-reset').toggleAttribute('data-locked',!e);
    this.$('ending-preview-open').disabled=!!this.uploading||!(e||this.custom);
    this.$('ending-preview-count').disabled=!!this.uploading;
    this.$('ending-image').disabled=!!e;this.$('ending-seed').disabled=!!e;this.$('ending-mask-mode').disabled=!!e;
    if(!this.uploading)this.$('ending-mask-label').textContent=e?.name||this.custom?.name||'Chưa chọn ảnh';
    const thumbnail=this.$('ending-mask-thumbnail');
    thumbnail.hidden=!this.custom||!!e;
    if(this.custom)thumbnail.src=this.custom.preview;
    // State broadcasts must never overwrite a local simulation mid-rehearsal.
  }
  destroy(){this.uploadVersion++;this.session.destroy();}
}
