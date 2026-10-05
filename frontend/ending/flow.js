// A smooth divergence-free field: curl of a seeded harmonic potential.
// Nearby contributions sample the same wind, not random directions per frame.
export function curlField(x,y,time,phases){
  const a=x*5.8+time*.28+phases[0],b=y*6.4-time*.21+phases[1];
  const c=x*10.3-time*.17+phases[2],d=y*9.1+time*.19+phases[3];
  return [(.78*Math.sin(a)*Math.cos(b)+.22*Math.cos(c)*Math.cos(d)),
    -(.78*5.8/6.4*Math.cos(a)*Math.sin(b)-.22*10.3/9.1*Math.sin(c)*Math.sin(d))];
}

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=v=>{const p=clamp(v);return p*p*p*(p*(p*6-15)+10);};
function capped(x,y,max){const scale=Math.min(1,max/(Math.hypot(x,y)||1));return [x*scale,y*scale];}

export function hermite(a,va,b,vb,p,duration){
  const p2=p*p,p3=p2*p;
  return (2*p3-3*p2+1)*a+(p3-2*p2+p)*duration*va+(-2*p3+3*p2)*b+(p3-p2)*duration*vb;
}
function hermiteVelocity(a,va,b,p,duration){
  return ((6*p*p-6*p)*a+(3*p*p-4*p+1)*duration*va+(-6*p*p+6*p)*b)/duration;
}

// Fixed-step inertial simulation is prepared once. Playback is an absolute-time
// lookup, preserving seek/reload/multi-display sync regardless of frame rate.
export function simulateCloud(plans,field,aspect,c){
  const hz=c.simulationHz,dt=1/hz;
  const particles=plans.map(plan=>{
    const end=Math.ceil(plan.lockAt*hz);
    const settleStep=Math.max(1,Math.floor((plan.lockAt-c.settleWindow)*hz));
    return {plan,end,settleStep,settleAt:settleStep/hz,
      samples:new Float32Array((end+1)*4),x:plan.start.x,y:plan.start.y*aspect,vx:0,vy:0};
  });
  const end=Math.max(0,...particles.map(p=>p.end));
  for(let i=0;i<=end;i++){
    const t=i/hz;
    // Remove the shared sideways/downward drift. The field retains its local
    // curls, but cannot carry the entire exhibition to one edge of the scroll.
    let bulkX=0,bulkY=0,weight=0;
    for(const p of particles){
      if(i>=p.settleStep)continue;
      const {delay,phase,lockAt}=p.plan;
      p.release=smooth((t-delay)/2.8);
      p.attraction=smooth((t-2.8-delay)/(8.8-delay));
      p.fade=1-smooth((t-7)/(lockAt-1-7));
      const wind=curlField(p.x,p.y,t,field),common=1-c.personalShare;
      p.windX=wind[0]*common+(Math.sin(t*.53+phase)+.35*Math.sin(t*.91+phase*1.7))*c.personalShare;
      p.windY=wind[1]*common+(Math.cos(t*.47+phase)+.35*Math.cos(t*.83+phase*1.3))*c.personalShare;
      const w=p.release*p.fade*(1-p.attraction);
      bulkX+=p.windX*w;bulkY+=p.windY*w;weight+=w;
    }
    if(weight>0){
      const balance=(c.driftBalance??1)*Math.min(1,particles.length/5);
      bulkX=bulkX/weight*balance;bulkY=bulkY/weight*balance;
    }
    for(const particle of particles){
      if(i>particle.end)continue;
      const {plan,samples,settleStep,settleAt}=particle;
      const {start,target,lockAt,phase,speedFactor}=plan;
      const tx=target.x,ty=target.y*aspect;
      let {x,y,vx,vy,settle}=particle;
      if(i>settleStep){
        const duration=lockAt-settleAt,p=clamp((t-settleAt)/duration);
        x=hermite(settle.x,settle.vx,tx,0,p,duration);
        y=hermite(settle.y,settle.vy,ty,0,p,duration);
        vx=hermiteVelocity(settle.x,settle.vx,tx,p,duration);
        vy=hermiteVelocity(settle.y,settle.vy,ty,p,duration);
      }
      const offset=i*4;samples[offset]=x;samples[offset+1]=y/aspect;samples[offset+2]=vx;samples[offset+3]=vy/aspect;
      if(i>=settleStep){particle.settle||={x,y,vx,vy};continue;}
      const {release,attraction,fade,windX,windY}=particle;
      const radius=c.targetRadius*(1-smooth((t-4)/(lockAt-2-4)));
      const aimX=tx+Math.sin(t*.39+phase)*radius,aimY=ty+Math.cos(t*.43+phase)*radius;
      const maxSpeed=c.arrivalSpeed*speedFactor*(1+.07*Math.sin(t*.7+phase));
      const arrival=capped((aimX-x)*c.arrivalRate,(aimY-y)*c.arrivalRate,maxSpeed);
      // A soft home-region tether preserves the initial left/right spacing.
      // It fades continuously as attraction takes over, never pinning a stroke.
      const tether=c.spreadStrength??.65;
      const desiredX=release*(((windX-bulkX)*c.flowSpeed+(start.x-x)*tether)*fade*(1-attraction)+arrival[0]*attraction);
      const desiredY=release*(((windY-bulkY)*c.flowSpeed+(start.y*aspect-y)*tether)*fade*(1-attraction)+arrival[1]*attraction);
      const strength=c.steering*(1+attraction*.6);
      // Soft viewport boundaries redirect before artwork touches the edge.
      const bounds=c.flowBounds||{left:.10,right:.90,top:.14,bottom:.86};
      const left=bounds.left+((bounds.lowerLeft||bounds.left)-bounds.left)*smooth((y/aspect-.62)/.08);
      const wallX=(Math.max(0,left-x)-Math.max(0,x-bounds.right))*20*release;
      const wallY=(Math.max(0,bounds.top*aspect-y)-Math.max(0,y-bounds.bottom*aspect))*20*release;
      const acceleration=capped((desiredX-vx)*strength+wallX,(desiredY-vy)*strength+wallY,.7);
      vx=(vx+acceleration[0]*dt)*Math.exp(-c.damping*dt);
      vy=(vy+acceleration[1]*dt)*Math.exp(-c.damping*dt);
      particle.x=x+vx*dt;particle.y=y+vy*dt;particle.vx=vx;particle.vy=vy;
    }
  }
  return particles.map(({samples,settleAt})=>({samples,hz,settleAt}));
}

export function simulateFlow(plan,field,aspect,c){
  return simulateCloud([plan],field,aspect,c)[0];
}

export function sampleFlow(plan,time){
  const {samples,hz}=plan.trajectory,t=Math.max(0,time)*hz;
  const i=Math.min(Math.floor(t),samples.length/4-2),p=Math.min(1,t-i),a=i*4,b=a+4,dt=1/hz;
  return {x:hermite(samples[a],samples[a+2],samples[b],samples[b+2],p,dt),
    y:hermite(samples[a+1],samples[a+3],samples[b+1],samples[b+3],p,dt),
    vx:samples[a+2]+(samples[b+2]-samples[a+2])*p,
    vy:samples[a+3]+(samples[b+3]-samples[a+3])*p};
}
