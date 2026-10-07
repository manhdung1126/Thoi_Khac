import {apiUrl} from '../shared/api.js';
import {LED,paintLedVectors} from '../shared/led.js';
import {paintMetallicMask} from '../shared/metallic.js';

export async function loadArtwork(drawing,signal) {
  const mask=document.createElement('canvas');mask.width=mask.height=280;
  const ctx=mask.getContext('2d');
  let graphite=false,colored=false;
  let data=drawing.vectors;
  if(!data&&drawing.vector_path){const response=await fetch(apiUrl(drawing.vector_path),{signal});if(!response.ok)throw Error(`Không tải được #${drawing.id.slice(0,8)}`);data=await response.json();}
  if(data&&(data.version!==2||!drawing.image_path)){
    graphite=data.strokes.some(s=>s.material==='graphite-v1');
    colored=data.strokes.some(s=>s.color);
    ctx.scale(280/LED.size,280/LED.size);paintLedVectors(ctx,data,'#fff');ctx.resetTransform();
  }else{
    const response=await fetch(apiUrl(drawing.image_path),{signal});if(!response.ok)throw Error(`Không tải được #${drawing.id.slice(0,8)}`);
    const blob=await response.blob(),svg=blob.type.includes('svg')?await blob.text():'';
    graphite=svg.includes('data-material="graphite-v1"');colored=svg.includes('data-colored="true"');
    const url=URL.createObjectURL(blob);
    let timer;
    try{const img=new Image();img.src=url;await Promise.race([img.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Không đọc được ảnh nét vẽ trong thời gian cho phép.')),8000);})]);const scale=Math.min(280/img.width,280/img.height);ctx.drawImage(img,(280-img.width*scale)/2,(280-img.height*scale)/2,img.width*scale,img.height*scale);}finally{clearTimeout(timer);URL.revokeObjectURL(url);}
  }
  if(signal.aborted)throw new DOMException('Đã hủy','AbortError');
  const pixels=ctx.getImageData(0,0,280,280).data;let left=280,top=280,right=-1,bottom=-1;
  for(let y=0;y<280;y++)for(let x=0;x<280;x++)if(pixels[(y*280+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  if(right<left)throw Error(`Nét vẽ #${drawing.id.slice(0,8)} không có nội dung nhìn thấy.`);
  const metallic=document.createElement('canvas');metallic.width=metallic.height=280;
  if(graphite)metallic.getContext('2d').drawImage(mask,0,0);
  else paintMetallicMask(metallic.getContext('2d'),mask,280,.18,colored);
  // Retain a compact texture, not two full-size canvases per contribution.
  const texture=document.createElement('canvas');texture.width=texture.height=160;
  texture.getContext('2d').drawImage(metallic,0,0,160,160);
  const ratio=160/280;
  return {drawingId:drawing.id,material:graphite?'graphite-v1':colored?'metallic-color':'metallic',canvas:texture,bounds:{x:left*ratio,y:top*ratio,width:(right-left+1)*ratio,height:(bottom-top+1)*ratio}};
}
