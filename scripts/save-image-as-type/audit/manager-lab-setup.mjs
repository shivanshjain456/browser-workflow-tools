import puppeteer from 'puppeteer';
import {resolve} from 'node:path';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const artifactHash=createHash('sha256').update(readFileSync('release/save-image-as-type.user.js')).digest('hex');
const ext=resolve('.local/manager-lab/vm');
const browser=await puppeteer.launch({executablePath:resolve('.local/manager-lab/browsers/chrome/linux-155.0.8059.84/chrome-linux64/chrome'),userDataDir:resolve(process.env.VM_PROFILE || '.local/manager-lab/profile-vm-'+artifactHash.slice(0,12)),headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
try{
 const t=await browser.waitForTarget(t=>t.type()==='service_worker'&&t.url().startsWith('chrome-extension://'),{timeout:20000});const id=new URL(t.url()).host;
 const page=await browser.newPage();await page.goto(`chrome://extensions/?id=${id}`);await new Promise(r=>setTimeout(r,900));
 console.log('extensions text',await page.evaluate(()=>{let o=[];function walk(r){for(const e of r.querySelectorAll('*')){if(e.shadowRoot)walk(e.shadowRoot);if(['CR-TOGGLE','CR-CHECKBOX','INPUT'].includes(e.tagName))o.push({tag:e.tagName,id:e.id,text:e.outerHTML});}}walk(document);return o;}));
 await page.screenshot({path:'audit/evidence/manager-lab/permission-before.png'});
 const toggle=await page.$('extensions-manager >>> extensions-detail-view >>> #allow-user-scripts');
 console.log('toggle?',!!toggle);
 if(toggle){const checked=await toggle.evaluate(e=>e.checked ?? e.shadowRoot.querySelector('cr-toggle').checked);console.log('permissionChecked',checked);if(!checked)await toggle.click();}
 console.log('after',await page.evaluate(()=>document.body.innerText));
 const options=await browser.newPage();await options.goto(`chrome-extension://${id}/options/index.html`);await new Promise(r=>setTimeout(r,800));
 console.log('options',await options.evaluate(()=>document.body.innerText));
 const existing=await options.evaluate(()=>chrome.storage.local.get(null));
 const alreadyInstalled=Object.values(existing).some(value=>typeof value==='string'&&createHash('sha256').update(value).digest('hex')===artifactHash);
 if(!alreadyInstalled){
 // New-install test, using the normal manager file chooser. Do not paste a
 // 600KB source through CodeMirror: that exhausted the 2GB lab on Chrome155.
 await options.click('a.btn-ghost');
 const chooserPromise=options.waitForFileChooser();
 await options.locator('::-p-text(New from file)').click();
 const chooser=await chooserPromise;await chooser.accept([resolve('release/save-image-as-type.user.js')]);
 await new Promise(r=>setTimeout(r,1300));
 await options.locator('button::-p-text(Save & Close)').click();
 await new Promise(r=>setTimeout(r,800));
 }
 console.log('targets',browser.targets().map(t=>[t.type(),t.url()]));
 for(const p of await browser.pages())if(p.url().startsWith('chrome-extension://')){
  console.log('PAGE',p.url(),await p.evaluate(()=>document.body.innerText));writeFileSync('audit/evidence/manager-lab/install-page.html',await p.content());await p.screenshot({path:'audit/evidence/manager-lab/install-page.png'});
 }
}finally{await browser.close();}
