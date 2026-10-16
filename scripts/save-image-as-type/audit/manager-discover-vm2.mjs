import puppeteer from 'puppeteer';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
const ext=resolve('.local/manager-lab/vm2');
const browser=await puppeteer.launch({headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
try{
 const target=await browser.waitForTarget(t=>t.url().startsWith('chrome-extension://'),{timeout:20000});
 const id=new URL(target.url()).host;
 const page=await browser.newPage();page.on('console',m=>console.log('console',m.text()));page.on('pageerror',e=>console.log('error',e.message));
 await page.goto(`chrome-extension://${id}/options/index.html`);await page.waitForSelector('body');await new Promise(r=>setTimeout(r,1500));
 console.log(id,await page.evaluate(()=>document.body.innerText));
 console.log(await page.evaluate(()=>[...document.querySelectorAll('button,input,a')].map(e=>({tag:e.tagName,text:e.innerText,title:e.title,type:e.type,placeholder:e.placeholder,outer:e.outerHTML.slice(0,350)}))));
 await page.screenshot({path:'audit/evidence/manager-lab/options.png'});
 writeFileSync('audit/evidence/manager-lab/options.html',await page.content());
}finally{await browser.close();}
