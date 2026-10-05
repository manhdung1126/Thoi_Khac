// Pure, DOM-independent layout. A versioned mask point set avoids differences
// in browser SVG rasterization. One target always represents one contribution.
export function hash(value) {
  let result=2166136261;
  for(const char of String(value)) result=Math.imul(result^char.charCodeAt(0),16777619);
  return result>>>0;
}
export function random(seed) {
  let state=hash(seed)||1;
  return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
}
export function compose({drawings,mask,seed,viewport={width:1536,height:768},margin=.09,packing=.78,maxDrawingSize=.22,area=null,referenceSize=140}) {
  if(!Array.isArray(drawings)||!mask?.points?.length)throw Error('Mask hoặc danh sách nét vẽ không hợp lệ.');
  const ids=drawings.map(d=>d.id);
  if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)throw Error('Mỗi nét vẽ cần một ID riêng, không trùng lặp.');
  if(ids.length>mask.points.length)throw Error(`Mask này hỗ trợ tối đa ${mask.points.length} nét vẽ.`);
  const {width,height}=viewport;
  if(!(width>0&&height>0))throw Error('Kích thước màn hình không hợp lệ.');
  const region=area||{x:0,y:0,width,height};
  if(![region.x,region.y,region.width,region.height].every(Number.isFinite)||region.x<0||region.y<0||region.width<=0||region.height<=0||region.x+region.width>width||region.y+region.height>height)throw Error('Vùng hội tụ phải nằm trong màn LED.');
  const h=Math.min(region.height*(1-2*margin),region.width*(1-2*margin)/mask.aspect),w=h*mask.aspect;
  const left=region.x+(region.width-w)/2,top=region.y+(region.height-h)/2;
  const rng=random(`${seed}:${mask.id}`);
  const candidates=mask.points.map(([x,y])=>({x:left+(x+(rng()-.5)*.4)/mask.width*w,y:top+(y+(rng()-.5)*.4)/mask.height*h}));
  // Seeded traversal breaks ties without randomness during rendering.
  for(let i=candidates.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
  const distances=new Float64Array(candidates.length).fill(Infinity),used=new Uint8Array(candidates.length),slots=[];
  let next=0,best=Infinity;
  for(let i=0;i<candidates.length;i++){const p=candidates[i],d=(p.x-region.x-region.width/2)**2+(p.y-region.y-region.height/2)**2;if(d<best){best=d;next=i;}}
  // Farthest-point placement covers separate regions of the silhouette early.
  for(let n=0;n<ids.length;n++){
    const chosen=candidates[next];slots.push(chosen);used[next]=1;let farthest=-1;
    for(let i=0;i<candidates.length;i++)if(!used[i]){
      const p=candidates[i];distances[i]=Math.min(distances[i],Math.max(Math.abs(p.x-chosen.x),Math.abs(p.y-chosen.y)));
      if(distances[i]>farthest){farthest=distances[i];next=i;}
    }
  }
  const ordered=ids.sort((a,b)=>hash(`${seed}:${a}`)-hash(`${seed}:${b}`)||(a<b?-1:a>b?1:0));
  return slots.map((point,i)=>{
    let separation=Math.min(width,height)*maxDrawingSize/packing;
    for(let j=0;j<slots.length;j++)if(i!==j)separation=Math.min(separation,Math.max(Math.abs(point.x-slots[j].x),Math.abs(point.y-slots[j].y)));
    const rotation=(hash(`${seed}:${ordered[i]}:angle`)%1000/999-.5)*8;
    const extent=Math.abs(Math.cos(rotation*Math.PI/180))+Math.abs(Math.sin(rotation*Math.PI/180));
    const edge=Math.min(point.x-region.x,region.x+region.width-point.x,point.y-region.y,region.y+region.height-point.y);
    const size=Math.min(separation*packing,Math.max(0,edge-2)*2/extent);
    return {drawingId:ordered[i],x:point.x/width,y:point.y/height,width:size/width,height:size/height,scale:size/referenceSize,rotation,opacity:1,z:i};
  });
}
