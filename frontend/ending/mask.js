import {hash} from './composition.js';

export function maskFromPixels({data,width,height},mode='auto',threshold=180){
  if(!['auto','alpha','dark','light'].includes(mode))throw Error('Chế độ đọc ảnh không hợp lệ.');
  let transparent=0;
  for(let i=3;i<data.length;i+=4)if(data[i]<32)transparent++;
  const resolved=mode==='auto'?(transparent>width*height*.01?'alpha':'dark'):mode;
  const selected=new Uint8Array(width*height);let filled=0;
  for(let i=0;i<selected.length;i++){
    const p=i*4,alpha=data[p+3],luma=.2126*data[p]+.7152*data[p+1]+.0722*data[p+2];
    if(alpha>128&&(resolved==='alpha'||(resolved==='dark'?luma<threshold:luma>threshold))){selected[i]=1;filled++;}
  }
  if(!filled)throw Error('Không tìm thấy hình đích. Hãy đổi vùng lấy hình hoặc ngưỡng sáng.');
  if(filled/selected.length>.95)throw Error('Ảnh gần như một khối đặc. Chọn vùng tối/sáng hoặc dùng ảnh nền trong suốt.');
  const points=[];
  for(let y=1;y<height-1;y+=2)for(let x=1;x<width-1;x+=2)if(selected[y*width+x])points.push([x,y]);
  if(points.length<10)throw Error('Hình đích quá mảnh hoặc nhỏ. Hãy dùng silhouette rõ và lớn hơn.');
  // Bound work for the farthest-point sampler; preserve deterministic ordering.
  const bounded=points.length>6000?Array.from({length:6000},(_,i)=>points[Math.floor(i*points.length/6000)]):points;
  return {mask:{id:'upload-'+hash(JSON.stringify([width,height,bounded])).toString(16),width,height,aspect:width/height,points:bounded},selected,mode:resolved};
}

function validateSvg(text){
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('SVG không được chứa DTD hoặc entity.');
  const doc=new DOMParser().parseFromString(text,'image/svg+xml');
  const allowed=new Set(['svg','g','path','rect','circle','ellipse','polygon','polyline','line','defs','clipPath','mask','title','desc']);
  if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')throw Error('SVG không hợp lệ.');
  for(const el of doc.querySelectorAll('*')){
    if(!allowed.has(el.localName))throw Error('SVG cần là hình vector tĩnh, không có script, ảnh nhúng, CSS hoặc liên kết.');
    for(const attr of el.attributes){
      if(/^on/i.test(attr.name)||/href/i.test(attr.name)||/url\s*\(|@import|javascript:/i.test(attr.value))throw Error('SVG có nội dung động hoặc tham chiếu không được hỗ trợ.');
    }
  }
}

export async function readMaskFile(file,{mode='auto',threshold=180}={}){
  if(!file||file.size>8*1024*1024)throw Error('Chọn ảnh tối đa 8 MB.');
  if(!/\.(png|jpe?g|webp|svg)$/i.test(file.name))throw Error('Chỉ hỗ trợ PNG, JPG, WebP hoặc SVG.');
  if(/\.svg$/i.test(file.name))validateSvg(await file.text());
  const blob=/\.svg$/i.test(file.name)?new Blob([await file.text()],{type:'image/svg+xml'}):file;
  const url=URL.createObjectURL(blob),img=new Image();let timer;
  try{
    img.src=url;
    await Promise.race([img.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Ảnh tải quá lâu. Hãy thử ảnh nhỏ hơn.')),8000);})]);
    if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>16000000)throw Error('Ảnh tối đa 16 triệu pixel.');
    const ratio=Math.min(256/img.naturalWidth,256/img.naturalHeight);
    const canvas=document.createElement('canvas');canvas.width=Math.max(4,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(4,Math.round(img.naturalHeight*ratio));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const result=maskFromPixels(ctx.getImageData(0,0,canvas.width,canvas.height),mode,threshold);
    const preview=ctx.createImageData(canvas.width,canvas.height);
    result.selected.forEach((v,i)=>{preview.data[i*4+3]=v?255:0;});
    ctx.putImageData(preview,0,0);
    return {...result,preview:canvas.toDataURL('image/png'),name:file.name};
  }finally{clearTimeout(timer);URL.revokeObjectURL(url);}
}
