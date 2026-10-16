#!/usr/bin/env node
/** Actual unpacked Violentmonkey. No injected GM shim or modified userscript.
 * Preparation: manager-lab-setup.mjs imports production via manager UI and
 * enables Chrome's Allow User Scripts switch through its normal settings UI.
 */
import puppeteer from 'puppeteer';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
const manager=process.argv[2]||'vm';
if(!['vm','tm'].includes(manager))throw Error('Expected vm or tm');
const dir=resolve('audit/evidence/manager-lab');mkdirSync(dir,{recursive:true});
const downloads=resolve('.local/manager-lab/downloads-'+manager);mkdirSync(downloads,{recursive:true});
const source=readFileSync('release/save-image-as-type.user.js');
const requests=[];const image=readFileSync('test/fixtures/opaque.png');
const imageServer=createServer((req,res)=>{if(req.url==='/child-cross'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><img id="source" src="/opaque.png" width="160" height="120">');return;}requests.push({server:'image',url:req.url,origin:req.headers.origin||'',referer:req.headers.referer||'',fetchSite:req.headers['sec-fetch-site']||''});res.setHeader('Content-Type','image/png');res.end(image);});
await new Promise(r=>imageServer.listen(0,'127.0.0.1',r));const imageOrigin=`http://127.0.0.1:${imageServer.address().port}`;
const server=createServer((req,res)=>{requests.push({server:'page',url:req.url});if(req.url==='/fixture.png'){res.setHeader('Content-Type','image/png');res.end(image);return;}if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
 if(['/csp','/data-csp','/svg-csp'].includes(req.url))res.setHeader('Content-Security-Policy',`default-src 'none'; img-src 'self' ${imageOrigin}; style-src 'unsafe-inline'`);
 let src=['/same','/child-same'].includes(req.url)?'/fixture.png':imageOrigin+'/opaque.png';
 if(req.url==='/data-csp')src='data:image/png;base64,'+image.toString('base64');
 let target=`<img id="source" src="${src}" width="160" height="120" alt="fixture">`;
 if(req.url==='/svg-csp')target='<svg id="source" xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="red"/></svg>';
 if(req.url==='/frames')target+=`<iframe style="display:block;border:0;width:240px;height:140px" src="/child-same"></iframe><iframe style="display:block;border:0;width:240px;height:140px" src="${imageOrigin}/child-cross"></iframe>`;
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><body>${target}<p>Actual manager local test</p></body></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const ext=resolve('.local/manager-lab/'+manager);
const browser=await puppeteer.launch({executablePath:resolve(process.env.LAB_CHROME||'.local/manager-lab/browsers/chrome/linux-155.0.8059.84/chrome-linux64/chrome'),userDataDir:resolve(manager==='vm'?(process.env.VM_PROFILE||'.local/manager-lab/profile-vm-'+createHash('sha256').update(source).digest('hex').slice(0,12)):(process.env.TM_PROFILE||'.local/manager-lab/profile-tm')),headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
const report={manager,driver:{node:process.version,puppeteer:JSON.parse(readFileSync(new URL('../node_modules/puppeteer/package.json',import.meta.url))).version},scope:'Actual userscript manager unpacked official MV3 distribution, installed via manager UI, production artifact unmodified; local HTTP fixture, headless Chrome, not public-site/other-OS certification',artifactSha256:createHash('sha256').update(source).digest('hex'),tests:[],requests};
try{
 report.browser=await browser.version();const target=await browser.waitForTarget(t=>t.type()==='service_worker'&&t.url().startsWith('chrome-extension://'));const id=new URL(target.url()).host;
 const options=await browser.newPage();await options.goto(`chrome-extension://${id}/${manager==='vm'?'options/index.html':'options.html'}`);await new Promise(r=>setTimeout(r,500));
 const data=await options.evaluate(()=>chrome.storage.local.get(null));
 report.managerManifest=await options.evaluate(()=>chrome.runtime.getManifest());
 report.storedKeys=Object.keys(data);
 report.storedCodeHashes=Object.entries(data).filter(([k,v])=>typeof v==='string'&&v.includes('// ==UserScript==')).map(([key,value])=>({key,sha256:createHash('sha256').update(value).digest('hex')}));
 if(manager==='tm'){
   await options.locator('[tvid="dashboard"]').click();
   await options.locator('::-p-text(Save Image as Type)').click();
   await new Promise(r=>setTimeout(r,500));
   const codes=await options.evaluate(()=>[...document.querySelectorAll('.CodeMirror')].filter(e=>e.getBoundingClientRect().width>0&&e.CodeMirror).map(e=>e.CodeMirror.getValue()));
   report.storedCodeHashes=codes.map(value=>({key:'manager editor visible document',sha256:createHash('sha256').update(value).digest('hex')}));
 }
 if(!report.storedCodeHashes.some(x=>x.sha256===report.artifactSha256))throw Error('Installed code hash does not match current artifact');
 console.log('storage',report.storedKeys,'hashes',report.storedCodeHashes);
 const cdp=await browser.target().createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
 const events=[],completed=new Set(),completionWaiters=new Map();
 cdp.on('Browser.downloadWillBegin',e=>events.push(e));
 cdp.on('Browser.downloadProgress',e=>{if(e.state==='completed'){completed.add(e.guid);completionWaiters.get(e.guid)?.();}});
 async function snapshotDownloads(captured,label) {
   const files=[];
   for(const event of captured){
     if(!completed.has(event.guid))await new Promise((resolve,reject)=>{
       const timer=setTimeout(()=>reject(Error('Download did not complete')),5000);
       completionWaiters.set(event.guid,()=>{clearTimeout(timer);resolve();});
     });
     const bytes=readFileSync(downloads+'/'+event.suggestedFilename);
     const file='audit/evidence/manager-lab/'+manager+'-'+label+'-'+files.length+(event.suggestedFilename.endsWith('.svg')?'.svg':'.png');
     writeFileSync(file,bytes);files.push({name:event.suggestedFilename,file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
   }
   return files;
 }

 for(const path of (process.env.LAB_CASES?.split(',')||['/same','/cross','/csp','/data-csp','/svg-csp'])){
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+path,{waitUntil:'load'});await page.bringToFront();if(!['/data-csp','/svg-csp'].includes(path))await page.waitForFunction(()=>document.getElementById('source').naturalWidth>0);
  await new Promise(r=>setTimeout(r,350));
  const boot=await page.evaluate(()=>({publicApi:!!window.__saveImageAsTypeInitialised,localKeys:Object.keys(localStorage),sessionKeys:Object.keys(sessionStorage),gmExposed:typeof GM_xmlhttpRequest!=='undefined'}));
  // A page-created event must not open an owned menu.
  const syntheticBefore=requests.length;
  const synthetic=await page.evaluate(()=>{
    const event=new MouseEvent('contextmenu',{bubbles:true,button:2});
    document.getElementById('source').dispatchEvent(event);
    const shadow=document.getElementById('siat-menu-host')?.shadowRoot;
    const menu=shadow?.querySelector('[role="menu"]');
    const button=shadow?.querySelector('[role="menuitem"]');
    if(button)button.click();
    return {isTrusted:event.isTrusted,visible:!!menu&&!menu.hidden,buttonExists:!!button};
  });
  await new Promise(r=>setTimeout(r,350));const syntheticRequests=requests.slice(syntheticBefore);
  const r=await page.$eval('#source',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.evaluate(()=>{window.__labContexts=[];document.addEventListener('contextmenu',e=>__labContexts.push({trusted:e.isTrusted,target:e.target.outerHTML.slice(0,500),prevented:e.defaultPrevented}),true);});
  await page.mouse.click(r.x,r.y,{button:'right'});
  await page.waitForFunction(()=>document.getElementById('siat-menu-host')?.shadowRoot?.querySelector('[role="menu"]')?.hidden === false,{timeout:4000}).catch(async error=>{report.menuFailure={path,point:r,facts:await page.evaluate(({x,y})=>({hit:document.elementFromPoint(x,y)?.outerHTML,source:document.getElementById('source').outerHTML,events:window.__labContexts,hosts:[...document.querySelectorAll('[id^=siat]')].map(e=>e.id)}),r),errors};throw error;});
  await page.bringToFront();
  await page.evaluate(()=>{window.__labKeys=[];document.addEventListener('keydown',e=>__labKeys.push({key:e.key,trusted:e.isTrusted,prevented:e.defaultPrevented}),true);});
  const before=events.length;await page.keyboard.press('1');
  await page.waitForFunction(()=>document.getElementById('siat-menu-host')?.shadowRoot?.querySelector('[role="menu"]')?.hidden === true,{timeout:3000}).catch(async e=>{report.keyboardFailure={message:e.message,keys:await page.evaluate(()=>window.__labKeys),focus:await page.evaluate(()=>({hasFocus:document.hasFocus(),active:document.activeElement.outerHTML}))};});
  await new Promise(r=>setTimeout(r,1800));
  const after=await page.evaluate(()=>({toast:document.getElementById('siat-toast-host')?.shadowRoot?.querySelector('.siat-toast-stack')?.innerText,menu:document.getElementById('siat-menu-host')?.shadowRoot?.querySelector('[role="menu"]')?.hidden === false}));
  report.tests.push({path,boot,synthetic,syntheticRequests,downloads:await snapshotDownloads(events.slice(before),path.slice(1)+'-png'),after,errors});
  const originalBefore=events.length;
  await page.mouse.click(r.x,r.y,{button:'right'});
  const originalPosition=await page.evaluate(()=>{
    const root=document.getElementById('siat-menu-host').shadowRoot;
    const button=[...root.querySelectorAll('[role="menuitem"]')].find(e=>e.querySelector('.siat-ext')?.textContent==='Original');
    const rect=button.getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  });
  await page.mouse.click(originalPosition.x,originalPosition.y);await new Promise(r=>setTimeout(r,1100));
  report.tests.at(-1).original={downloads:await snapshotDownloads(events.slice(originalBefore),path.slice(1)+'-original'),toast:await page.evaluate(()=>document.getElementById('siat-toast-host')?.shadowRoot?.querySelector('.siat-toast-stack')?.innerText)};
  await page.screenshot({path:dir+`/${manager}-${path.slice(1)}.png`});
  if(path==='/same'){
   // Observe the real manager popup while leaving the website the active tab.
   await page.bringToFront();const {targetId}=await cdp.send('Target.createTarget',{url:`chrome-extension://${id}/${manager==='vm'?'popup/index.html':'action.html'}`,background:true});
   const popTarget=await browser.waitForTarget(t=>t._targetId===targetId);const popup=await popTarget.page();await new Promise(r=>setTimeout(r,900));
   report.popupText=await popup.evaluate(()=>document.body.innerText);await popup.screenshot({path:dir+'/'+manager+'-popup.png'});await popup.close();
  }
  await page.close();
 }
 // Exercise manager-only persistence through trusted form input, then restore.
 const settingsPage=await browser.newPage();await settingsPage.goto(origin+'/same');await settingsPage.bringToFront();
 async function clickOwned(page,host,selector,label=null) {
   const pos=await page.evaluate(({host,selector,label})=>{
     const root=document.getElementById(host)?.shadowRoot;
     const node=[...root.querySelectorAll(selector)].find(e=>label===null||e.textContent===label);
     if(!node)throw Error('Owned UI control unavailable');
     node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};
   },{host,selector,label});
   await page.mouse.click(pos.x,pos.y);
 }
 async function openSettings(page) {
   const pos=await page.$eval('#source',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
   await page.mouse.click(pos.x,pos.y,{button:'right'});
   await page.waitForFunction(()=>document.getElementById('siat-menu-host')?.shadowRoot?.querySelector('[role="menu"]')?.hidden===false);
   // The settings button has a label span plus a hint, so select its parent by
   // its owned class and scroll it into view before the actual mouse click.
   const target=await page.evaluate(()=>{
     const root=document.getElementById('siat-menu-host').shadowRoot;
     const label=[...root.querySelectorAll('.siat-ext')].find(e=>e.textContent==='Settings');
     label.parentElement.scrollIntoView({block:'center'});const r=label.parentElement.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};
   });
   await page.mouse.click(target.x,target.y);
   await page.waitForFunction(()=>!!document.getElementById('siat-panel-host')?.shadowRoot?.querySelector('#siat-prefix'));
 }
 async function writePrefix(page,value) {
   await clickOwned(page,'siat-panel-host','#siat-prefix');
   await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');
   await page.keyboard.press('Backspace');if(value)await page.keyboard.type(value);
   await clickOwned(page,'siat-panel-host','button','Save');
   await page.waitForFunction(()=>!document.getElementById('siat-panel-host')?.shadowRoot?.querySelector('[role="dialog"]'));
 }
 await openSettings(settingsPage);await writePrefix(settingsPage,'lab-owned-storage');
 await settingsPage.reload({waitUntil:'load'});await openSettings(settingsPage);
 report.settingsPersistence={prefixAfterReload:await settingsPage.evaluate(()=>document.getElementById('siat-panel-host').shadowRoot.querySelector('#siat-prefix').value)};
 if(report.settingsPersistence.prefixAfterReload!=='lab-owned-storage')throw Error('Real manager persistence failed');
 await writePrefix(settingsPage,'');await settingsPage.reload({waitUntil:'load'});await openSettings(settingsPage);
 report.settingsPersistence.restoredPrefix=await settingsPage.evaluate(()=>document.getElementById('siat-panel-host').shadowRoot.querySelector('#siat-prefix').value);
 // G-67 named configuration profiles in the actual manager: capture, reload,
 // apply through the real button, then delete and confirm the lab is clean.
 async function typeInto(page,selector,value) {
   await clickOwned(page,'siat-panel-host',selector);
   await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');
   await page.keyboard.press('Backspace');if(value)await page.keyboard.type(value);
 }
 const profileFacts=()=>settingsPage.evaluate(()=>{const root=document.getElementById('siat-panel-host').shadowRoot;return {rows:root.querySelectorAll('[id$="-apply"]').length,subfolder:root.querySelector('#siat-subfolder').value,direction:root.querySelector('#siat-profiles-section')?.getAttribute('dir')||'ltr'};});
 await typeInto(settingsPage,'#siat-subfolder','vm-profile-shots');
 await typeInto(settingsPage,'#siat-profile-new-name','VM lab profile');
 await clickOwned(settingsPage,'siat-panel-host','button','Save current settings as a profile');
 await clickOwned(settingsPage,'siat-panel-host','button','Save');
 await settingsPage.waitForFunction(()=>!document.getElementById('siat-panel-host')?.shadowRoot?.querySelector('[role="dialog"]'));
 const captured=await (async()=>{await openSettings(settingsPage);return profileFacts();})();
 await settingsPage.reload({waitUntil:'load'});await openSettings(settingsPage);
 const afterReload=await profileFacts();
 await typeInto(settingsPage,'#siat-subfolder','vm-temp');
 await clickOwned(settingsPage,'siat-panel-host','button','Save');
 await settingsPage.waitForFunction(()=>!document.getElementById('siat-panel-host')?.shadowRoot?.querySelector('[role="dialog"]'));
 await openSettings(settingsPage);
 await clickOwned(settingsPage,'siat-panel-host','[id$="-apply"]');
 await settingsPage.waitForFunction(()=>!!document.getElementById('siat-panel-host')?.shadowRoot?.querySelector('#siat-profiles-section'));
 const afterApply=await profileFacts();
 await settingsPage.screenshot({path:dir+'/'+manager+'-profiles.png'});
 await clickOwned(settingsPage,'siat-panel-host','[id$="-delete"]');
 await typeInto(settingsPage,'#siat-subfolder','');
 await clickOwned(settingsPage,'siat-panel-host','button','Save');
 await settingsPage.waitForFunction(()=>!document.getElementById('siat-panel-host')?.shadowRoot?.querySelector('[role="dialog"]'));
 await settingsPage.reload({waitUntil:'load'});await openSettings(settingsPage);
 const restored=await profileFacts();
 report.profileWorkflow={captured,afterReload,afterApply,restored,
   capturedThroughRealUI:captured.rows===1,'persistedAfterPageReload':afterReload.rows===1&&afterReload.subfolder==='vm-profile-shots',
   'appliedThroughRealUI':afterApply.subfolder==='vm-profile-shots'&&afterApply.rows===1,
   'deletedAndRestored':restored.rows===0&&restored.subfolder==='',
   scope:'Actual Violentmonkey storage and a real page reload; trusted input only'};
 if(!report.profileWorkflow.capturedThroughRealUI||!report.profileWorkflow.persistedAfterPageReload||!report.profileWorkflow.appliedThroughRealUI||!report.profileWorkflow.deletedAndRestored)throw Error('Real-manager profile workflow failed');
 await settingsPage.close();
 // Real manager: preserve same- and cross-origin frame conversions while
 // contributing exactly eight top-level menu entries, not eight per frame.
 const framePage=await browser.newPage();await framePage.goto(origin+'/frames',{waitUntil:'load'});await framePage.bringToFront();
 report.embeddedConversions=[];
 for(const [index,frame] of framePage.frames().filter(f=>f!==framePage.mainFrame()).entries()){
   await frame.waitForFunction(()=>document.getElementById('source')?.naturalWidth>0);
   const offset=await framePage.evaluate(index=>{const r=document.querySelectorAll('iframe')[index].getBoundingClientRect();return{x:r.x,y:r.y};},index);
   const inside=await frame.$eval('#source',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
   const before=events.length;await framePage.mouse.click(offset.x+inside.x,offset.y+inside.y,{button:'right'});
   await frame.waitForFunction(()=>document.getElementById('siat-menu-host')?.shadowRoot?.querySelector('[role="menu"]')?.hidden===false);
   await framePage.keyboard.press('1');await new Promise(r=>setTimeout(r,1100));
   const saved=await snapshotDownloads(events.slice(before),'frame-'+index+'-png');
   if(saved.length!==1)throw Error('Embedded document did not save once');
   report.embeddedConversions.push({url:frame.url(),files:saved});
 }
 await framePage.bringToFront();
 const {targetId:popupId}=await cdp.send('Target.createTarget',{url:`chrome-extension://${id}/${manager==='vm'?'popup/index.html':'action.html'}`,background:true});
 const framePopup=await(await browser.waitForTarget(t=>t._targetId===popupId)).page();await new Promise(r=>setTimeout(r,600));
 report.framePopupText=await framePopup.evaluate(()=>document.body.innerText);
 report.frameMenuEntries=report.framePopupText.split('\n').filter(line=>line.startsWith('Save Image as Type — ')).length;
 if(manager==='vm'&&report.frameMenuEntries!==8)throw Error('Expected eight actual manager menu entries with frames');
 await framePopup.screenshot({path:dir+'/'+manager+'-frame-popup.png'});await framePopup.close();await framePage.close();
 report.completed=true;
 report.downloadedFiles=readdirSync(downloads).map(name=>({name,sha256:createHash('sha256').update(readFileSync(downloads+'/'+name)).digest('hex'),bytes:readFileSync(downloads+'/'+name).length}));
 // Inspect manager-persisted values, not page storage.
 const finalStorage=await options.evaluate(()=>chrome.storage.local.get(null));report.valueKeys=Object.keys(finalStorage).filter(k=>/^val:|value/i.test(k));
}catch(error){report.error=error.message;throw error;}finally{await browser.close();server.close();imageServer.close();writeFileSync(dir+'/'+manager+'-production.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
