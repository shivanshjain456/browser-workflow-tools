#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const manifest=JSON.parse(readFileSync('test/golden/manifest.json'));
const temp='audit/evidence/golden-media-inputs';mkdirSync(temp,{recursive:true});
for(const name of Object.keys(manifest.files).filter(x=>!x.endsWith('.zip')))copyFileSync('test/golden/'+name,temp+'/'+name);
for(const [helper,input,output]of [['verify_media.py',temp,'golden-media.json'],['verify_zip.py','test/golden','golden-zip.json']]){
 const result=spawnSync('python3',['test/helpers/'+helper,input],{encoding:'utf8'});
 if(result.status!==0)throw Error(result.stderr||'Independent verifier failed');
 const facts=JSON.parse(result.stdout);if(facts.errors?.length)throw Error(JSON.stringify(facts.errors));
 writeFileSync('audit/evidence/'+output,result.stdout);console.log(helper+': parsed without errors');
}
