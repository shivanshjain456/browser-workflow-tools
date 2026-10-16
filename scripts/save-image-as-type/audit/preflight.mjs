#!/usr/bin/env node
/** Fail closed: never turn missing independent tools into a smaller green suite. */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
const checks=[];
const [major,minor,patch]=process.versions.node.split('.').map(Number);
checks.push({tool:'supported Node',ok:major>22||(major===22&&(minor>22||(minor===22&&patch>=2))),version:process.version,minimum:'22.22.2'});
for(const name of ['jsdom','puppeteer']) {
 try{await import(name);checks.push({tool:name,ok:true});}catch(e){checks.push({tool:name,ok:false,reason:e.message});}
}
const py=spawnSync('python3',['-c',"import json,sys,PIL,pypdf;from PIL import features;assert features.check('webp');print(json.dumps({'python':sys.version.split()[0],'Pillow':PIL.__version__,'pypdf':pypdf.__version__,'webp':True}))"],{encoding:'utf8'});
checks.push({tool:'independent-codecs',ok:py.status===0,result:py.stdout?.trim(),error:py.stderr?.trim()});
const file=spawnSync('file',['--version'],{encoding:'utf8'});checks.push({tool:'file(1)',ok:file.status===0,result:file.stdout?.split('\n')[0]});
try {
 const {default:puppeteer}=await import('puppeteer');
 const binary=await puppeteer.executablePath();if(!existsSync(binary))throw Error('Chrome executable missing: '+binary);
 const ld=spawnSync('ldd',[binary],{encoding:'utf8'});if(ld.status!==0||/not found/.test(ld.stdout))throw Error('Chrome shared libraries missing: '+ld.stdout);
 checks.push({tool:'Chrome executable/libraries',ok:true,binary});
}catch(e){checks.push({tool:'Chrome executable/libraries',ok:false,reason:e.message});}
console.log(JSON.stringify({node:process.version,checks},null,2));if(checks.some(x=>!x.ok))process.exitCode=1;
