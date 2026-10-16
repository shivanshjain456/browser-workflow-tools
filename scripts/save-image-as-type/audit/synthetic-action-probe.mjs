/** Adversarial regression discovery: can page-authored DOM events initiate GM fetch? */
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import puppeteer from 'puppeteer';
import {createHash} from 'node:crypto';
const scriptPath=process.argv[2]||'release/save-image-as-type.user.js';
const label=process.argv[3]||'synthetic-action-after';
const script=readFileSync(scriptPath,'utf8');
const pixels=readFileSync('test/fixtures/opaque.png');
const cdn=createServer((req,res)=>{res.setHeader('Content-Type','image/png');res.end(pixels);});
const site=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');});
for(const server of [site,cdn])await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${site.address().port}`,image=`http://127.0.0.1:${cdn.address().port}/image.png`;
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const page=await browser.newPage();
try{
 await page.evaluateOnNewDocument(()=>{
  window.__audit={attempts:[],commands:[]};window.GM_info={scriptHandler:'audit-emulation',script:{version:'audit'},downloadMode:'browser'};
  window.GM_getValue=(_k,f)=>f;window.GM_setValue=()=>{};window.GM_deleteValue=()=>{};window.GM_addValueChangeListener=()=>1;window.GM_removeValueChangeListener=()=>{};
  window.GM_registerMenuCommand=(label,fn)=>__audit.commands.push({label,fn});window.GM_notification=()=>{};window.GM_download=()=>{throw Error('unexpected write');};
  window.GM_xmlhttpRequest=options=>{__audit.attempts.push({url:options.url});throw Error('Probe intentionally stops before privileged transport');};
 });
 await page.evaluateOnNewDocument(script);await page.goto(origin);await new Promise(r=>setTimeout(r,300));
 const events=await page.evaluate(async url=>{
  const img=document.createElement('img');img.src=url;img.width=100;img.height=100;document.body.append(img);await new Promise(r=>{img.onload=img.onerror=r;});
  const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:40});img.dispatchEvent(event);
  const shadow=document.getElementById('siat-menu-host')?.shadowRoot;
  const button=shadow&&[...shadow.querySelectorAll('[role="menuitem"]')].find(x=>x.querySelector('.siat-ext')?.textContent==='PNG');
  if(button)button.click();return {contextEventTrusted:event.isTrusted,menuOpened:!!button,publicApiPresent:!!window.__saveImageAsTypeInitialised?.gm};
 },image);
 let reached=false;try{await page.waitForFunction(()=>__audit.attempts.length>0,{timeout:6000});reached=true;}catch{}
 const result={scriptPath,sha256:createHash('sha256').update(script).digest('hex'),scope:'Chrome shared-world page DOM attack with fake GM; NOT actual-manager exploit validation',...events,privilegedFetchAttempted:reached,attempts:await page.evaluate(()=>__audit.attempts),status:reached?'CONFIRMED ADDITIONAL RELEASE BLOCKER':(!events.menuOpened?'REJECTED by production UI event boundary':'No privileged attempt; acquisition must be inspected')};
 writeFileSync('audit/evidence/'+label+'.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();site.close();cdn.close();}
