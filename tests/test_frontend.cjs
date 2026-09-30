const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

// These tests exercise the API client and the finalized Control surface without a browser.
global.location = {port:"8000", origin:"http://localhost:8000", protocol:"http:", hostname:"localhost"};
const tokens = new Map();
global.sessionStorage = {getItem:key=>tokens.get(key)||null, setItem:(key,value)=>tokens.set(key,value), removeItem:key=>tokens.delete(key)};

test("same-origin API supports a different machine hostname", async()=>{
  const api = await import("../frontend/shared/api.js");
  assert.equal(api.apiUrl("/api/state"), "http://localhost:8000/api/state");
});

test("Control keeps only snapshot management and exposes irreversible trash cleanup",()=>{
  const html=fs.readFileSync("frontend/control/index.html","utf8");
  const app=fs.readFileSync("frontend/control/app.js","utf8");
  assert.doesNotMatch(html,/id="save-form"|id="save-mode"|id="saves"|Bố cục đã lưu/);
  assert.doesNotMatch(html,/id="settings-form"|id="led-settings-form"|id="item-form"|id="preview-edit"|id="reset-layout"|id="led-title"|id="led-subtitle"/);
  assert.match(html,/id="snapshots"/);
  assert.match(html,/id="page-select"/);
  assert.match(html,/id="new-page"/);
  assert.match(html,/id="rename-page"/);
  assert.match(html,/id="delete-page"/);
  assert.match(html,/id="show-page"/);
  assert.doesNotMatch(html,/id="page-name-form"/);
  assert.match(app,/\/api\/pages\/\$\{page\.id\}`, "DELETE"/);
  assert.match(app,/selectedPageId=event\.target\.value/);
  assert.match(app,/\/api\/pages\/\$\{selectedPageId\}\/activate/);
  assert.match(html,/Lưu khoảnh khắc/);
  assert.match(html,/id="show-favorites"/);
  assert.match(app,/cell_id: selectedCell/);
  assert.match(app,/Thêm vào ô/);
  assert.match(app,/\/favorite`, "PATCH", \{ favorite: !drawing\.favorite \}/);
  assert.match(app,/\/api\/drawings\/\$\{drawing\.id\}\/purge/);
  assert.match(app,/\/api\/snapshots\/\$\{snapshot\.id\}/);
  assert.match(app,/Xóa vĩnh viễn/);
});

test("API translates text server errors and clears expired admin sessions", async()=>{
  const {api,getToken,setToken} = await import("../frontend/shared/api.js");
  const original=global.fetch;
  try{
    global.fetch=async()=>new Response("Internal Server Error",{status:500});
    await assert.rejects(()=>api("/api/state"),/500/);
    setToken("expired");
    global.fetch=async()=>new Response(JSON.stringify({detail:"Phiên hết hạn"}),{status:401});
    await assert.rejects(()=>api("/api/settings",{method:"PATCH",auth:true,body:{paused:true}}),/Phiên hết hạn/);
    assert.equal(getToken(),"");
  }finally{global.fetch=original;}
});

test("API preserves multipart uploads and sends admin bearer only when requested", async()=>{
  const {api,setToken}=await import("../frontend/shared/api.js");
  const original=global.fetch;setToken("demo-token");
  try{
    const form=new FormData();form.append("name","snapshot");
    global.fetch=async(url,options)=>{
      assert.equal(options.body,form);
      assert.equal(options.headers.get("Content-Type"),null);
      assert.equal(options.headers.get("Authorization"),"Bearer demo-token");
      return new Response(JSON.stringify({id:"saved"}),{status:201});
    };
    assert.equal((await api("/api/snapshots",{method:"POST",body:form,auth:true})).id,"saved");
  }finally{global.fetch=original;setToken("");}
});
