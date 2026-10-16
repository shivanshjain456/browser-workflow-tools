/** Exact-production UI/browser checks; fake GM transport is explicitly not a manager. */
import puppeteer from 'puppeteer';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sourcePath=process.argv[2]||'release/save-image-as-type.user.js';
const label=process.argv[3]||'candidate';
const source=readFileSync(sourcePath,'utf8');
const server=createServer((req,res)=>{
 if(req.url==='/fixture.png'){res.setHeader('Content-Type','image/png');res.end(readFileSync('test/fixtures/opaque.png'));return;}
 if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const report={sourcePath,sha256:createHash('sha256').update(source).digest('hex'),browser:await browser.version(),scope:'Exact production source with timing marks outside its bytes; Chrome CDP and fake GM, not actual manager',boot:[],a11y:[]};
try{
 for(let i=0;i<5;i++){
  const page=await browser.newPage();const requests=[],errors=[];page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
  await page.evaluateOnNewDocument(()=>{
   const commands=[],downloads=[],writes=[],store={};window.__audit={commands,downloads,writes,store};
   window.GM_info={scriptHandler:'audit-emulation',version:'1',script:{version:'audit'},downloadMode:'browser'};
   // A store that actually remembers: paths that reload from manager storage must
   // be exercised, not short-circuited to the fallback value.
   window.GM_getValue=(k,f)=>(k in store?store[k]:f);window.GM_setValue=(k,v)=>{store[k]=v;writes.push({k,v});};window.GM_deleteValue=k=>{delete store[k];};
   window.GM_addValueChangeListener=()=>1;window.GM_removeValueChangeListener=()=>{};
   window.GM_registerMenuCommand=(label,fn)=>commands.push({label,fn});
   window.GM_download=options=>{fetch(options.url).then(r=>r.arrayBuffer()).then(data=>{const bytes=new Uint8Array(data);let str='';for(const n of bytes)str+=String.fromCharCode(n);downloads.push({name:options.name,base64:btoa(str)});options.onload?.();}).catch(e=>options.onerror?.(e));};
   window.GM_notification=()=>{};window.GM_xmlhttpRequest=()=>{throw Error('unexpected network escalation');};
  });
  await page.evaluateOnNewDocument('window.__audit.start=performance.now();\n'+source+'\nwindow.__audit.returned=performance.now();');
  await page.goto(origin,{waitUntil:'load'});await new Promise(r=>setTimeout(r,1800));
  const fact=await page.evaluate(()=>({syncStartupMs:__audit.returned-__audit.start,commands:__audit.commands.length,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage),cookie:document.cookie,publicHandle:!!window.__saveImageAsTypeInitialised?.gm}));
  report.boot.push({...fact,requests,errors});
  if(i>0){await page.close();continue;}
  // Open through the actual registered callback; no internal API test hook.
  await page.evaluate(()=>__audit.commands.find(x=>/— Settings/.test(x.label)).fn());
  await page.waitForFunction(()=>!!document.getElementById('siat-panel-host')?.shadowRoot?.querySelector('[role="dialog"]'));
  const cdp=await page.createCDPSession();
  for(const mode of ['default','large-type','reduced-motion','forced-colors','more-contrast','dark']){
   const features=[{name:'prefers-reduced-motion',value:mode==='reduced-motion'?'reduce':'no-preference'},{name:'forced-colors',value:mode==='forced-colors'?'active':'none'},{name:'prefers-contrast',value:mode==='more-contrast'?'more':'no-preference'},{name:'prefers-color-scheme',value:mode==='dark'?'dark':'light'}];
   await cdp.send('Emulation.setEmulatedMedia',{features});
   await page.evaluate(mode=>{document.documentElement.style.fontSize=mode==='large-type'?'32px':'16px';const sr=document.getElementById('siat-panel-host').shadowRoot;sr.querySelector('button').focus();let probe=sr.querySelector('.audit-motion');if(!probe){probe=document.createElement('i');probe.className='audit-motion';probe.style.animation='audit-motion 1s infinite';probe.style.transition='opacity 1s';sr.append(probe);}},mode);
   const facts=await page.evaluate(()=>{
    const sr=document.getElementById('siat-panel-host').shadowRoot;
    const text=[...sr.querySelectorAll('*')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()));
    const sizes=text.map(e=>parseFloat(getComputedStyle(e).fontSize));const dialog=sr.querySelector('[role="dialog"]'),button=sr.activeElement;
    const motion=getComputedStyle(sr.querySelector('.audit-motion'));return {motionAnimation:motion.animationName,motionTransition:motion.transitionDuration,minTextPx:Math.min(...sizes),maxTextPx:Math.max(...sizes),textNodes:sizes.length,dialogColor:getComputedStyle(dialog).color,dialogBackground:getComputedStyle(dialog).backgroundColor,focusOutline:button?getComputedStyle(button).outline:'none',reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,forcedColors:matchMedia('(forced-colors: active)').matches,moreContrast:matchMedia('(prefers-contrast: more)').matches};
   });
   const screenshot=`audit/evidence/${label}-${mode}.png`;await page.screenshot({path:screenshot});report.a11y.push({mode,...facts,screenshot});
  }
  await cdp.send('Emulation.setEmulatedMedia',{features:[]});await page.evaluate(()=>{document.documentElement.style.fontSize='16px';});
  // G-67 configuration profiles, driven through the real controls with trusted
  // input: type a name, capture, change the configuration, re-apply, then reload
  // the page and check the manager store still holds it.
  const SHADOW='#siat-panel-host';
  const deep=(selector)=>`${SHADOW} >>> ${selector}`;
  const typeInto=async(selector,text)=>{await page.click(deep(selector));await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.keyboard.type(text);};
  const readValue=(selector)=>page.$eval(deep(selector),el=>el.value);
  const clickButtonByText=async(text)=>{
    const handle=await page.evaluateHandle((host,label)=>{const root=document.querySelector(host).shadowRoot;return [...root.querySelectorAll('button')].find(b=>b.textContent.trim()===label)||null;},SHADOW,text);
    const element=handle.asElement();if(!element)throw Error('Button not found: '+text);await element.click();await new Promise(r=>setTimeout(r,250));
  };
  const shadowFacts=()=>page.evaluate(host=>{const root=document.querySelector(host).shadowRoot;const section=root.querySelector('#siat-profiles-section');return {sectionPresent:!!section,direction:section?section.getAttribute('dir')||'ltr':null,rows:root.querySelectorAll('[id$="-apply"]').length,subfolder:(root.querySelector('#siat-subfolder')||{}).value??null,banner:(root.querySelector('[role="status"]')||{}).textContent??''};},SHADOW);
  await page.screenshot({path:`audit/evidence/${label}-profiles-section.png`});
  await typeInto('#siat-subfolder','profile-shots');
  await typeInto('#siat-profile-new-name','Evidence profile');
  await clickButtonByText('Save current settings as a profile');
  const afterCapture=await shadowFacts();
  await clickButtonByText('Save');
  await new Promise(r=>setTimeout(r,400));
  await page.evaluate(label=>__audit.commands.find(x=>/— Settings/.test(x.label)).fn(),label);
  await page.waitForFunction(host=>!!document.querySelector(host)?.shadowRoot?.querySelector('#siat-profiles-section'),{},SHADOW);
  await typeInto('#siat-subfolder','other-folder');
  await clickButtonByText('Save');
  await new Promise(r=>setTimeout(r,400));
  await page.evaluate(()=>__audit.commands.find(x=>/— Settings/.test(x.label)).fn());
  await page.waitForFunction(host=>!!document.querySelector(host)?.shadowRoot?.querySelector('[id$="-apply"]'),{},SHADOW);
  const applyHandle=await page.$(`${SHADOW} >>> [id$="-apply"]`);await applyHandle.click();await new Promise(r=>setTimeout(r,300));
  await page.waitForFunction(host=>!!document.querySelector(host)?.shadowRoot?.querySelector('#siat-profiles-section'),{},SHADOW);
  const afterApply=await shadowFacts();
  const storedProfilesBeforeReload=await page.evaluate(()=>Object.values(__audit.store).filter(value=>JSON.stringify(value).includes('Evidence profile')).length);
  const settingsWriteSeen=await page.evaluate(()=>__audit.writes.filter(entry=>JSON.stringify(entry.v).includes('Evidence profile')).length);
  await page.keyboard.press('Escape');
  await page.reload({waitUntil:'load'});await new Promise(r=>setTimeout(r,1500));
  await page.evaluate(()=>__audit.commands.find(x=>/— Settings/.test(x.label)).fn());
  await page.waitForFunction(host=>!!document.querySelector(host)?.shadowRoot?.querySelector('#siat-profiles-section'),{},SHADOW);
  const afterReload=await shadowFacts();
  report.profileWorkflow={afterCapture,afterApply,afterReload,sameDocumentStoreWritesContainingProfile:settingsWriteSeen,profilesInSameDocumentStore:storedProfilesBeforeReload,
    capturedThroughRealUI:afterCapture.rows===1&&afterCapture.subfolder==='profile-shots',
    appliedThroughRealUI:afterApply.subfolder==='profile-shots'&&afterApply.rows===1,
    fakeStoreResetsOnReload:afterReload.rows===0&&afterReload.subfolder==='',
    reloadPersistenceScope:'not claimed here: this harness store is per-document (it is re-injected on every navigation by design). Cross-reload persistence of a profile is verified in the actual manager lab instead.',
    scope:'Real trusted input in a shadow-root dialog, exact production code; language/direction come from the document, and no page-authored flag can enable this'};
  await page.evaluate(()=>{const root=document.querySelector('#siat-panel-host')?.shadowRoot;root?.querySelector('[role="dialog"]')?.closest('div')&&null;});
  await page.keyboard.press('Escape');
  // Real mouse input in production context, then independent decoder checks saved bytes.
  await page.evaluate(()=>{const img=document.createElement('img');img.id='audit-image';img.src='/fixture.png';img.width=160;img.height=120;document.body.append(img);});
  await page.waitForFunction(()=>document.getElementById('audit-image')?.naturalWidth>0);
  const center=await page.$eval('#audit-image',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.click(center.x,center.y,{button:'right'});
  await page.waitForFunction(()=>{const s=document.getElementById('siat-menu-host')?.shadowRoot;return !!s?.querySelector('[role="menuitem"]');});
  const pos=await page.evaluate(()=>{const s=document.getElementById('siat-menu-host').shadowRoot;const b=[...s.querySelectorAll('[role="menuitem"]')].find(x=>x.querySelector('.siat-ext')?.textContent==='PNG');const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.click(pos.x,pos.y);
  await page.waitForFunction(()=>__audit.downloads.length>0,{timeout:20000});await new Promise(r=>setTimeout(r,100));
  const downloads=await page.evaluate(()=>__audit.downloads);report.save={count:downloads.length,name:downloads[0].name,bytes:Buffer.from(downloads[0].base64,'base64').length};
  mkdirSync(`audit/evidence/${label}-saved`,{recursive:true});for(let n=0;n<downloads.length;n++)writeFileSync(`audit/evidence/${label}-saved/${n}.png`,Buffer.from(downloads[n].base64,'base64'));
  // A trusted keyboard event must not be downgraded to a synthetic .click().
  report.keyboardSaves=[];
  for(const key of ['1','Enter','Space']) {
    const beforeKeyboard=await page.evaluate(()=>__audit.downloads.length);
    await page.mouse.click(center.x,center.y,{button:'right'});
    await page.keyboard.press(key);
    await page.waitForFunction(n=>__audit.downloads.length>n,{timeout:20000},beforeKeyboard);
    report.keyboardSaves.push({key,newDownloads:await page.evaluate(n=>__audit.downloads.length-n,beforeKeyboard),mode:'real key, production event policy'});
  }
  report.keyboardSave=report.keyboardSaves[0];
  // Explicitly test separate executions. Report the duplication, never call it idempotent.
  const prior=await page.evaluate(()=>__audit.commands.length);await page.evaluate(source);await new Promise(r=>setTimeout(r,100));report.separateExecution={commandsBefore:prior,commandsAfter:await page.evaluate(()=>__audit.commands.length),supported:false};
  await page.close();
 }
}finally{await browser.close();server.close();writeFileSync(`audit/evidence/${label}-browser-checks.json`,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
