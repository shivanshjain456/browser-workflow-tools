/** G-67 semantic/workflow study. Optional original-attachment inputs, not runtime code.
 * Extracts a few hash-verified pure functions into a context with NO GM/DOM.
 * This is not a user survey, manager test, or security boundary claim about vm.
 * Usage: node audit/study-profiles.mjs <competitor-A.user.js> <competitor-B.user.js>
 * The competitors are not redistributed or inlined into the installed artifact.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {basename} from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import tokenizer from 'js-tokens';
import {normalizePreset,effectiveSettings} from '../src/core/presets.js';
const paths=process.argv.slice(2);
if(paths.length!==2)throw Error('Supply the two original competitor attachment paths (A then B).');
const expected=['2bdcd447318a9b576d2184c7647fb574','5772b531f84325987730792cb6435ba4'];
const inputs=paths.map((path,index)=>{
 const source=readFileSync(path,'utf8'),md5=createHash('md5').update(source).digest('hex');
 assert.equal(md5,expected[index],'Do not execute selected functions from unreviewed input');
 return {path:basename(path),source,md5,sha256:createHash('sha256').update(source).digest('hex'),extracted:[]};
});
function extract(input,name){
 const start=input.source.indexOf('function '+name+'(');assert.ok(start>=0,name+' exists');
 const tail=input.source.slice(start),re=new RegExp(tokenizer.default.source,'g');let depth=0,opened=false;
 for(const match of tail.matchAll(re)){
  const token=tokenizer.matchToToken(match);
  if(token.type!=='punctuator')continue;
  if(token.value==='{'){depth++;opened=true;}
  if(token.value==='}'&&--depth===0&&opened){
   const end=start+match.index+1;
   input.extracted.push({name,start,end,sha256:createHash('sha256').update(input.source.slice(start,end)).digest('hex')});
   return input.source.slice(start,end);
  }
 }
 throw Error('Unbalanced function '+name);
}
const [A,B]=inputs;
const excluded=JSON.parse(A.source.match(/Ui=(\[[^\]]+\])/)[1]);
const formats=JSON.parse(B.source.match(/const FORMAT_ORDER = (\[[^\]]+\])/)[1].replaceAll("'",'"'));
const a=vm.createContext({});
vm.runInContext('const Ui='+JSON.stringify(excluded)+';const Qr=40;'+['Fe','Ue','mn','pn','fn','Fi','bn'].map(n=>extract(A,n)).join('\n'),a,{timeout:1000});
const b=vm.createContext({});
vm.runInContext('const FORMAT_ORDER='+JSON.stringify(formats)+';'+['clampInt','sanitizeFilenameBase','normalizeProfile'].map(n=>extract(B,n)).join('\n'),b,{timeout:1000});
function jsonRun(context,code){return JSON.parse(vm.runInContext('JSON.stringify('+code+')',context,{timeout:1000}));}
const full={formats:{png:true,jpeg:false},resize:{mode:'max',width:1400,height:1000},language:'ar',hotkeys:{save:'Alt+S'},rules:[{host:'example.test',enabled:true}],metadata:'strip',profiles:[],presetBackup:{},devProbe:false};
a.input=full;
const snapshot=jsonRun(a,'pn(input,"Publishing", "fixed-study-id")');
assert.deepEqual(snapshot.values,Object.fromEntries(Object.entries(full).filter(([key])=>!excluded.includes(key))));
a.snapshot=snapshot;
const exported=jsonRun(a,'JSON.parse(bn(snapshot))');assert.deepEqual(exported.values,snapshot.values);
const overlay=jsonRun(a,'fn({formats:{png:false,jpeg:true},language:"en",profiles:[1]},snapshot.values)');
assert.equal(overlay.language,'ar');assert.equal(overlay.formats.png,true);assert.deepEqual(overlay.profiles,[1]);
b.input={name:'Album',format:'jpg',resize:1400,pack:'pdf',language:'ar',hotkeys:{save:'Alt+S'}};
const outputProfile=jsonRun(b,'normalizeProfile(input)');assert.deepEqual(Object.keys(outputProfile),['name','format','resize','pack']);assert.equal(outputProfile.pack,'pdf');
const own=normalizePreset({name:'Web',formatId:'jpg',transform:{resize:{mode:'fit',width:1400,height:1000}},destination:'zip',language:'ar',hotkeys:{save:'Alt+S'},rules:full.rules}).preset;
const effective=effectiveSettings({language:'en',hotkeys:{save:'Ctrl+S'},rules:[]},own);
assert.equal(effective.language,'en');assert.deepEqual(effective.rules,[]);
const report={scope:'Hash-verified pure source function execution and constructed workflow coverage; NOT actual user interviews or a manager compatibility test',inputs:inputs.map(({source,...rest})=>rest),A:{excluded,snapshot,exported,overlay},B:{outputProfile},own:{normalized:own,effective},conclusion:'B output profiles largely overlap conversion presets, but PDF packing and automatic format are separate open capabilities. A named portable global snapshots include language/hotkeys/site rules and are NOT semantically subsumed by current output presets. Keep G-67 open; do not permanently decline by name overlap. Actual demand/UX research remains unperformed.'};
writeFileSync('audit/evidence/profile-semantics.json',JSON.stringify(report,null,2)+'\n');
console.log('PASS: A global snapshot/export/apply differs from B output profiles and current conversion presets; no runtime code copied. Demand study is not a user survey.');
