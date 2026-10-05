import {random} from './composition.js';

// Vector fixtures, not visitors' work. Variations are reproducible from the seed.
const curve=(fn,n=48)=>Array.from({length:n+1},(_,i)=>fn(i/n));
const ellipse=(x,y,rx,ry)=>curve(t=>[x+rx*Math.cos(t*Math.PI*2),y+ry*Math.sin(t*Math.PI*2)]);
const motifs=[
  ()=>[curve(t=>{const a=t*Math.PI*2;return [360+15*16*Math.sin(a)**3,330-15*(13*Math.cos(a)-5*Math.cos(2*a)-2*Math.cos(3*a)-Math.cos(4*a))];})],
  ()=>[[[110,550],[610,550]],[[180,540],[180,300],[540,300],[540,540]],[[100,300],[200,245],[360,160],[520,245],[620,300],[100,300]],ellipse(360,365,45,45),[[310,540],[310,455],[410,455],[410,540]]],
  ()=>[curve(t=>[360+180*Math.sin(t*Math.PI*2),470-260*Math.sin(t*Math.PI)]),curve(t=>[360-210*Math.sin(t*Math.PI),470-180*Math.sin(t*Math.PI*2)]),curve(t=>[360+210*Math.sin(t*Math.PI),470-180*Math.sin(t*Math.PI*2)]),[[360,470],[350,590]],ellipse(360,490,220,30)],
  ()=>Array.from({length:3},(_,k)=>curve(t=>[100+520*t,260+k*95+40*Math.sin(t*Math.PI*4+k)])),
  ()=>[[[120,390],[245,230],[355,360],[460,250],[605,355]],[[355,360],[400,450],[470,420]],[[245,230],[280,365]]],
  ()=>[Array.from({length:11},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5,r=i%2?105:240;return [360+r*Math.cos(a),360+r*Math.sin(a)];})],
  ()=>[[[140,350],[360,140],[590,350]],[[200,310],[200,580],[520,580],[520,310]],[[310,580],[310,420],[405,420],[405,580]],[[440,355],[480,355],[480,395],[440,395],[440,355]]],
  ()=>[[[355,580],[355,260]],ellipse(360,270,160,145),[[355,410],[255,310]],[[355,365],[455,270]],curve(t=>[160+400*t,590+12*Math.sin(t*6)])],
  ()=>[ellipse(240,470,100,100),ellipse(520,470,100,100),[[240,470],[330,300],[420,470],[240,470],[375,340],[520,470],[465,270],[530,270]],[[290,300],[355,300]]],
  ()=>[[[100,500],[610,500],[540,570],[170,570],[100,500]],[[340,500],[340,145],[150,440],[330,440]],[[365,180],[560,430],[365,430],[365,180]]],
];

export function sampleDrawings(count,seed='demo-01'){
  if(!Number.isInteger(count)||count<0||count>1500)throw Error('Chọn từ 0 đến 1.500 nét thử.');
  return Array.from({length:count},(_,i)=>{
    const rng=random(seed+':'+i),sx=.86+rng()*.12,sy=.86+rng()*.12,tilt=(rng()-.5)*.15;
    const paths=motifs[i%motifs.length]();
    return {id:'sample-'+String(i+1).padStart(4,'0'),synthetic:true,vectors:{version:1,profile:'led-2px',strokes:paths.map(points=>({
      erase:false,width:[1.5,2,2.5,3][Math.floor(rng()*4)],
      points:points.map(([x,y])=>[360+(x-360)*sx+(y-360)*tilt+(rng()-.5)*2,360+(y-360)*sy+(rng()-.5)*2]),
    }))}};
  });
}
