import puppeteer from 'puppeteer';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
const ext=resolve('.local/manager-lab/tm');
const browser=await puppeteer.launch({executablePath:resolve(process.env.LAB_CHROME||'.local/manager-lab/browsers/chrome/linux-155.0.8059.84/chrome-linux64/chrome'),userDataDir:resolve(process.env.TM_PROFILE||'.local/manager-lab/profile-tm'),headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
try{
 const t=await browser.waitForTarget(t=>t.type()==='service_worker'&&t.url().startsWith('chrome-extension://'));const id=new URL(t.url()).host;
 const page=await browser.newPage();await page.goto(`chrome://extensions/?id=${id}`);await new Promise(r=>setTimeout(r,500));
 const dev=await page.$('extensions-manager >>> extensions-toolbar >>> #devMode');if(dev && await dev.evaluate(e=>e.getAttribute('aria-checked')!=='true'))await dev.click();
 const toggle=await page.$('extensions-manager >>> extensions-detail-view >>> #allow-user-scripts');
 if(toggle){const checked=await toggle.evaluate(e=>e.checked??e.shadowRoot.querySelector('cr-toggle').checked);if(!checked)await toggle.click();}
 const options=await browser.newPage();await options.goto(`chrome-extension://${id}/options.html#nav=settings`);await options.waitForSelector('input[name="Anonymous statistics"]');
 if(await options.$eval('input[name="Anonymous statistics"]',e=>e.checked))await options.click('input[name="Anonymous statistics"]');
 await options.locator('[tvid="utils"]').click();await options.waitForSelector('input[type="file"]',{visible:true});
 await (await options.$('input[type="file"]')).uploadFile(resolve(process.argv[2]||'release/save-image-as-type.user.js'));
 await new Promise(r=>setTimeout(r,500));
 console.log('afterFile',await options.evaluate(()=>document.body.innerText));
 await new Promise(r=>setTimeout(r,1000));
 console.log('targets',browser.targets().map(t=>[t.type(),t.url()]));
 const askTarget=await browser.waitForTarget(t=>t.type()==='page'&&t.url().includes('/ask.html?'));
 const ask=await askTarget.page();await ask.waitForSelector('body');console.log('install controls',await ask.evaluate(()=>[...document.querySelectorAll('input,button,a')].map(e=>({tag:e.tagName,value:e.value,text:e.innerText,outer:e.outerHTML.slice(0,300)}))));
 writeFileSync('audit/evidence/manager-lab/tm-ask.html',await ask.content());
 ask.on('dialog',async d=>{console.log('INSTALL_DIALOG',d.type(),d.message());if(/install|Save Image as Type|close|unsaved/i.test(d.message()))await d.accept();else await d.dismiss();});
 await ask.bringToFront();console.log('beforeInstallClick');await ask.click('input.install[name="Install"]');console.log('afterInstallClick');
 await new Promise(r=>setTimeout(r,1100));
 await options.locator('[tvid="dashboard"]').click();
 console.log('INSTALLED',await options.evaluate(()=>document.body.innerText));


 for(const p of await browser.pages())if(p.url().startsWith('chrome-extension://'))console.log('PAGE',p.url(),await p.evaluate(()=>document.body.innerText));
 console.log('afterImport',await options.evaluate(()=>document.body.innerText));
 await options.screenshot({path:'audit/evidence/manager-lab/tm-import.png'});
 writeFileSync('audit/evidence/manager-lab/tm-import.html',await options.content());
}finally{await browser.close();}
