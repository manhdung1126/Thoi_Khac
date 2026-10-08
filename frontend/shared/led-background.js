import {apiUrl} from './api.js';
import {LED} from './led.js';

// One native decoder per visible scene; hidden Ending previews do not keep playing.
export function mountLedBackground(host,className,onError=()=>{}){
  const video=document.createElement('video'),poster=new Image();
  video.className=poster.className=className;
  video.setAttribute('aria-hidden','true');poster.alt='';
  video.muted=true;video.loop=true;video.playsInline=true;video.preload='metadata';
  poster.src=video.poster=apiUrl(LED.poster);video.src=apiUrl(LED.background);
  host.prepend(video);
  let visible=false,failed=false,destroyed=false;
  const sync=()=>{
    if(destroyed||failed)return;
    // Autoplay denial leaves the poster visible, without blocking visitor artwork.
    if(visible&&!document.hidden)void video.play().catch(()=>{});
    else video.pause();
  };
  const fallback=()=>{
    if(destroyed||failed)return;
    failed=true;video.pause();video.replaceWith(poster);
    onError('Không phát được video nền; đang dùng ảnh dự phòng.');
  };
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync();});
  observer.observe(video);
  document.addEventListener('visibilitychange',sync);
  video.addEventListener('error',fallback);
  return {
    async frame(){
      if(!failed&&video.readyState>=2)return video;
      await poster.decode();return poster;
    },
    destroy(){
      destroyed=true;observer.disconnect();document.removeEventListener('visibilitychange',sync);
      video.removeEventListener('error',fallback);video.pause();video.removeAttribute('src');video.load();
    }
  };
}
