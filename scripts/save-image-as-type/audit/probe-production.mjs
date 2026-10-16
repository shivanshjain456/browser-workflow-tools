// Trusted offline verifier: never included in the installed script.
import puppeteer from 'puppeteer';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const path=process.argv[2] || 'release/save-image-as-type.user.js';
const output=process.argv[3] || 'audit/evidence/production.json';
const source=readFileSync(path,'utf8');
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html'); if(req.url==='/csp')res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'none'; frame-src 'self'");res.end('<!doctype html><html><body>'+ (req.url==='/frames'?Array.from({length:10},()=>'<iframe src="/empty"></iframe>').join(''):'')+'</body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const report={artifact:path,sha256:createHash('sha256').update(source).digest('hex'),browser:await browser.version(),scope:'Chrome same-world CDP injection with a fake manager, NOT a real userscript manager',cases:[],performance:[]};
async function pageFor(kind,url='/empty'){
 const p=await browser.newPage();const requests=[],errors=[];p.on('request',r=>requests.push({url:r.url(),type:r.resourceType()}));p.on('pageerror',e=>errors.push(e.message));
 await p.evaluateOnNewDocument((kind)=>{
  const writes=[];const commands=[];const storage=[]; window.__audit={writes,commands,storage};
  for(const obj of [localStorage,sessionStorage]) for(const key of ['setItem','removeItem','clear'])obj[key]=(...args)=>storage.push({key,args});
  indexedDB.open=()=>{storage.push({key:'indexedDB.open'});throw Error('page database forbidden');};
  window.GM_info={scriptHandler:'audit-emulation',version:'1',script:{version:'audit'},downloadMode:'browser'};
  window.GM_getValue=(_k,f)=>f;window.GM_setValue=(k,v)=>writes.push({k,v}); window.GM_deleteValue=()=>{};
  window.GM_registerMenuCommand=(label,fn)=>{commands.push({label,fn});return commands.length;};
  window.GM_addValueChangeListener=()=>1;window.GM_removeValueChangeListener=()=>{};
  window.GM_download=()=>{throw Error('unexpected download');};window.GM_notification=()=>{throw Error('unexpected notification');};window.GM_xmlhttpRequest=()=>{throw Error('unexpected privileged request');};
  if(kind==='preseed')window.__saveImageAsTypeInitialised={pageControlled:true};
  if(kind==='flag')window.__SIAT_NO_AUTOBOOT=true;
  if(kind==='attribute') new MutationObserver(()=>document.documentElement?.setAttribute('data-siat-no-autoboot','')).observe(document,{childList:true});
 },kind);
 // For the attribute attack ensure the attribute exists synchronously before code runs.
 await p.evaluateOnNewDocument((kind)=>{if(kind==='attribute') { const root=document.documentElement || document.appendChild(document.createElement('html'));root.setAttribute('data-siat-no-autoboot',''); }},kind);
 await p.evaluateOnNewDocument(source); await p.goto(base+url,{waitUntil:'load'});await new Promise(r=>setTimeout(r,1700));return {p,requests,errors};
}
try{
 for(const kind of ['clean','preseed','flag','attribute']){
  const {p,requests,errors}=await pageFor(kind);
  const facts=await p.evaluate(async()=>{
   const api=window.__saveImageAsTypeInitialised;
   const before=__audit.writes.length;
   if(api?.gm)await api.gm.setValue('audit.attack','page wrote through public capability');
   return {commands:__audit.commands.length,publicHandle:!!api?.gm,preseedAdopted:!!api?.pageControlled,privilegedWrite:__audit.writes.length>before,pageStorageCalls:__audit.storage,roots:['__saveImageAsTypeInitialised'].map(k=>({document:!!document[k],html:!!document.documentElement?.[k],body:!!document.body?.[k],window:!!window[k]})),cookie:document.cookie};
  });report.cases.push({kind,...facts,requests,errors});await p.close();
 }
 const {p,requests}=await pageFor('clean','/frames');
 const frames=[];for(const f of p.frames())frames.push(await f.evaluate(()=>({url:location.href,commands:__audit.commands.length,handle:!!window.__saveImageAsTypeInitialised?.gm,hosts:document.querySelectorAll('[id^="siat-"]').length})));
 report.frames={frames,requests};await p.close();
 // Compiler injection is confined to this verifier. No hook is added to distribution.
 const perf=await browser.newPage();await perf.goto(base+'/empty');
 const instrumented=source.replace(/\}\)\(\);\s*$/, 'globalThis.__auditEncode = {encodeGif,encodeBmp};\n})();');await perf.evaluate(instrumented);
 for(const size of [512,1024])for(let run=0;run<3;run++)report.performance.push(await perf.evaluate(async({size,run})=>{
   const data=new Uint8ClampedArray(size*size*4);for(let n=0;n<data.length;n+=4){data[n]=(n/4)%256;data[n+1]=Math.floor(n/size)%256;data[n+2]=(n*17)%256;data[n+3]=255;}
   let tick;const waiting=new Promise(r=>setTimeout(()=>{tick=performance.now();r();},0));const start=performance.now();const bytes=__auditEncode.encodeGif([{imageData:{data,width:size,height:size},delayMs:100}]);const end=performance.now();await waiting;return {size,run,encodeMs:end-start,timerDelayMs:tick-start,bytes:bytes.length};
 },{size,run}));
 await perf.close();
 const csp=await pageFor('clean','/csp'); report.csp=await csp.p.evaluate(async()=>{
  let violation=null;document.addEventListener('securitypolicyviolation',e=>{violation={directive:e.violatedDirective,blocked:e.blockedURI};},{once:true});const img=new Image();const outcome=await new Promise(r=>{img.onload=()=>r('load');img.onerror=()=>r('error');img.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2lWQAAAAASUVORK5CYII=';document.body.append(img);});await new Promise(r=>setTimeout(r,30));return {outcome,violation};
 });await csp.p.close();
}finally{await browser.close();server.close();writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
