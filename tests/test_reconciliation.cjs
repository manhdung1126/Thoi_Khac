const {test}=require('node:test');
const assert=require('node:assert/strict');

// Advance an event-loop turn, not an elapsed-time sleep, to drain fetch microtasks.
const turn=()=>new Promise(setImmediate);
const value=revision=>({revision,current_page_id:'live',pages:[{id:'live',name:'Trang '+revision}],drawings:[]});

async function transport(t){
  const keys=['location','sessionStorage','fetch','WebSocket','setInterval','clearInterval'];
  const originals=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(global,key)]));
  const requests=[],states=[],statuses=[],sockets=[],intervals=new Set();let subscription;
  t.after(()=>{
    subscription?.close();
    for(const [key,descriptor] of originals){
      if(descriptor)Object.defineProperty(global,key,descriptor);else delete global[key];
    }
  });
  global.location={port:'8000',origin:'http://localhost:8000'};
  global.sessionStorage={getItem:()=>null};
  global.setInterval=callback=>{intervals.add(callback);return callback;};
  global.clearInterval=callback=>intervals.delete(callback);
  global.fetch=(url,options)=>{
    assert.equal(url,'http://localhost:8000/api/state');assert.equal(options.method,'GET');
    const pending=Promise.withResolvers();
    requests.push({...pending,reply:data=>pending.resolve(new Response(JSON.stringify(data)))});
    return pending.promise;
  };
  global.WebSocket=class extends EventTarget{
    static OPEN=1;
    constructor(){super();this.readyState=0;sockets.push(this);}
    open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
    message(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
    close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
    send(){}
  };
  const {subscribeState}=await import('../frontend/shared/api.js');
  subscription=subscribeState(state=>states.push(state),status=>statuses.push(status));
  requests[0].reply(value(1));await turn();
  return {subscription,requests,states,statuses,socket:sockets[0],intervals};
}

test('failed HTTP refresh resolves null, reports the error and retains the last delivered state',async t=>{
  const {subscription,requests,states,statuses}=await transport(t);
  const refresh=subscription.refresh();requests[1].reject(new TypeError('offline'));
  assert.equal(await refresh,null);
  assert.deepEqual(states,[value(1)]);
  assert.equal(statuses.at(-1).connected,false);
  assert.match(statuses.at(-1).message,/Không kết nối được server/);
});

test('overlapping refresh requests are serialized and coalesced instead of completing out of order',async t=>{
  const {subscription,requests,states}=await transport(t);
  const a=subscription.refresh(),b=subscription.refresh(),c=subscription.refresh();
  assert.equal(requests.length,2,'Only initial read and A may have started; B/C must wait');
  requests[1].reply(value(2));await Promise.all([a,b,c]);
  assert.equal(requests.length,3,'B/C together schedule exactly one subsequent read');
  assert.deepEqual(states,[value(1),value(2)]);
  requests[2].reply(value(3));await turn();
  assert.deepEqual(states,[value(1),value(2),value(3)]);
});

test('a later HTTP response with older revision cannot repaint delivered state; equal revision readiness can update',async t=>{
  const {subscription,requests,states}=await transport(t);
  const newer=subscription.refresh();requests[1].reply(value(3));await newer;
  const older=subscription.refresh();requests[2].reply(value(2));await older;
  assert.deepEqual(states,[value(1),value(3)]);
  const ready={...value(3),ending:{ready_displays:['screen-1']}};
  const equal=subscription.refresh();requests[3].reply(ready);await equal;
  assert.deepEqual(states,[value(1),value(3),ready]);
});

test('repeated WebSocket notifications only request authoritative HTTP state, never apply their embedded partial data',async t=>{
  const {subscription,requests,states,socket,intervals}=await transport(t);
  socket.open();requests[1].reply(value(1));await turn();
  const signal={type:'state_changed',revision:999,current_page_id:'wrong',pages:[]};
  socket.message(signal);socket.message(signal);socket.message({type:'drawing_created',drawings:['wrong']});
  assert.equal(requests.length,3);
  assert.deepEqual(states,[value(1),value(1)]);
  requests[2].reply(value(2));await turn();
  assert.equal(requests.length,4);
  requests[3].reply(value(3));await turn();
  assert.deepEqual(states,[value(1),value(1),value(2),value(3)]);
  subscription.close();assert.equal(intervals.size,0);
  socket.message(signal);assert.equal(requests.length,4);
});
