import {sampleDrawings} from './samples.js';
import {ENDING_CONFIG} from './config.js';

// Preview-only data: never store generated contributions in shared state.
export function buildRehearsal({state,mask,name,seed,count='live'}){
  const ending=state.ending;
  const page=state.pages.find(p=>p.id===state.current_page_id);
  const sourceCells=ending?.cells||page?.cells||[];
  const ids=new Set(sourceCells.flatMap(cell=>cell.drawing_ids||[]));
  const real=ending?.drawings||state.drawings.filter(d=>!d.deleted&&ids.has(d.id));
  const total=count==='live'?real.length:Number(count);
  if(!Number.isInteger(total)||total<1||total>1500)throw Error('Chọn từ 1–1.500 hình để xem thử. Nếu trang trống, hãy chọn số hình mô phỏng.');
  if(!mask)throw Error('Chọn ảnh đích trước khi xem thử.');
  if(total>mask.points.length)throw Error('Ảnh đích quá mảnh cho số hình đã chọn. Giảm số hình hoặc chọn ảnh có vùng hình lớn hơn.');
  // A smaller trial uses only a subset; it does not remove real submissions.
  const drawings=[...real.slice(0,total)];
  const samples=sampleDrawings(total-drawings.length,seed);
  samples.forEach(d=>{d.id='rehearsal:'+d.id;});
  const realCount=drawings.length;
  drawings.push(...samples);
  const selected=new Set(drawings.map(d=>d.id));
  const cells=Array.from({length:27},(_,i)=>{
    const old=sourceCells[i]||{},drawing_ids=(old.drawing_ids||[]).filter(id=>selected.has(id));
    return {...old,drawing_ids,active:drawing_ids.includes(old.active)?old.active:drawing_ids[0]||null};
  });
  // Fill empty cells first so Normal in the rehearsal matches the LED rule.
  for(const sample of samples){
    const cell=cells.reduce((best,c)=>c.drawing_ids.length<best.drawing_ids.length?c:best,cells[0]);
    cell.drawing_ids.push(sample.id);cell.active||=sample.id;
  }
  return {realCount,sampleCount:samples.length,session:{
    id:crypto.randomUUID(),motion_version:2,start_time:null,duration:20,
    viewport:ENDING_CONFIG.viewport,mask,name,seed,drawings,cells,
  }};
}
