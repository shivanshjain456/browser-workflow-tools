import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cleanConfigData,parseConfigJson,CONFIG_DATA_LIMITS} from '../../src/core/config-data.js';
import {validateImportedSettings,normalizeSettings,migrateSettings,createSettingsStore,DEFAULT_SETTINGS} from '../../src/core/settings.js';
import {normalizePreset} from '../../src/core/presets.js';
import {createGmAdapter} from '../../src/core/gm.js';
import {startProduction} from '../../src/main.js';
import {sanitizePathComponent,buildFilename} from '../../src/core/filename.js';
import {encodeBmp} from '../../src/encoders/bmp.js';
import {encodeGif} from '../../src/encoders/gif.js';
import {encodePdf} from '../../src/encoders/pdf.js';
import {encodeZip} from '../../src/encoders/zip.js';
import {goldenOutputs} from '../../audit/golden-inputs.mjs';
const hostile=readFileSync(new URL('../corpus/hostile-config.json',import.meta.url),'utf8');
const attacks=JSON.parse(readFileSync(new URL('../corpus/filename-attacks.json',import.meta.url)));

describe('audit — own-data configuration ingress',()=>{
 test('never invokes getters, inherits fields or carries prototype-control keys',()=>{
  let calls=0;const raw=Object.create({filenamePrefix:'inherited'});
  Object.defineProperty(raw,'subfolder',{enumerable:true,get(){calls++;throw Error('getter invoked');}});
  raw.formats=['png'];raw.constructor={prototype:{polluted:true}};
  const clean=cleanConfigData(raw);
  assert.equal(calls,0);assert.equal(Object.getPrototypeOf(clean),null);assert.equal(clean.filenamePrefix,undefined);assert.equal(clean.subfolder,undefined);assert.equal(clean.constructor,undefined);
  assert.equal(normalizeSettings(raw).settings.filenamePrefix,DEFAULT_SETTINGS.filenamePrefix);
  assert.equal(normalizePreset(Object.create({formatId:'jpg'})).preset.formatId,'');
 });
 test('JSON magic keys cannot change migration or schema prototypes',()=>{
  const raw=JSON.parse(hostile);const result=migrateSettings(raw);
  assert.equal(Object.getPrototypeOf(result.value),null);
  assert.equal(result.value.filenamePrefix,'kept');assert.equal(result.value.__proto__,undefined);
  const imported=validateImportedSettings(hostile);assert.equal(imported.ok,true);assert.equal(imported.settings.filenamePrefix,'kept');assert.equal(imported.settings.presets[0].formatId,'png');assert.equal({}.polluted,undefined);
 });
 test('deep nesting, cycles, huge lists, symbols and scalar type confusion are bounded',()=>{
  let raw={};let cursor=raw;for(let n=0;n<10000;n++){cursor.x={};cursor=cursor.x;}
  assert.doesNotThrow(()=>cleanConfigData(raw));raw={};raw.x=raw;raw[Symbol('bad')]='ignored';
  assert.equal(cleanConfigData(raw).x,null);
  assert.deepEqual(Object.getOwnPropertySymbols(cleanConfigData(raw)),[]);
  assert.equal(cleanConfigData(Array(100000).fill(1)).length,CONFIG_DATA_LIMITS.entries);
  for(const value of [false,true,42,[],null,undefined,()=>1]) assert.doesNotThrow(()=>normalizeSettings(value));
 });
 test('every setting field withstands object/array/scalar confusion without throwing',()=>{
  for(const key of Object.keys(DEFAULT_SETTINGS)) for(const value of [{}, {x:1}, [Object.create(null)], false, 42, 'bad', null]) {
    assert.doesNotThrow(()=>normalizeSettings({[key]:value}),key);
    assert.doesNotThrow(()=>validateImportedSettings(JSON.stringify({[key]:value})),key+' import');
  }
  for(const key of ['name','id','formatId','jpegQuality','webpQuality','hosts','transform','destination'])for(const value of [{},[{}],null])assert.doesNotThrow(()=>normalizePreset({[key]:value}),'preset '+key);
 });
 test('text limit is checked before parsing an oversized file',()=>{
  assert.throws(()=>parseConfigJson(' '.repeat(CONFIG_DATA_LIMITS.jsonBytes+1)),/too large/);
  assert.equal(validateImportedSettings(' '.repeat(CONFIG_DATA_LIMITS.jsonBytes+1)).ok,false);
 });
 test('manager load, remote change and save patch share the same boundary',async()=>{
  let remote;const writes=[];const gm={capabilities:{storage:true,valueChangeSync:true},getValue:async()=>hostile,setValue:async(k,v)=>{writes.push(v);return true;},onValueChanged:(_k,fn)=>{remote=fn;return {dispose(){}};}};
  const store=createSettingsStore({gm});await store.load();assert.equal(store.get().filenamePrefix,'kept');
  remote('key',null,'{"__proto__":{"filenamePrefix":"pwn"},"formats":["png"]}');assert.equal(store.get().filenamePrefix,DEFAULT_SETTINGS.filenamePrefix);
  await store.save(JSON.parse('{"__proto__":{"filenamePrefix":"pwn"},"jpegQuality":0.8}'));
  assert.equal(store.get().filenamePrefix,DEFAULT_SETTINGS.filenamePrefix);assert.equal(store.get().jpegQuality,0.8);assert.ok(writes.every(x=>!x.includes('__proto__')));store.dispose();
 });
});

describe('audit — reserved names and final byte budgets',()=>{
 const reserved=attacks.reserved;
 for(const name of reserved)test(`neutralises ${name}`,()=>{
  const component=sanitizePathComponent(name);assert.match(component,/^_/);
  const out=buildFilename({base:name,ext:'png'}).filename;assert.match(out,/^_/);assert.ok(!/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:[. ]|$)/i.test(out));
 });
 test('non-reserved device-like stems stay unchanged',()=>{for(const name of attacks.notReserved)assert.equal(sanitizePathComponent(name),name);});
 test('post-truncation device stems cannot reappear',()=>{assert.equal(sanitizePathComponent('CONvoy',{maxChars:3}),'_CO');const out=buildFilename({base:'CONvoy',ext:'png',maxLength:7});assert.equal(out.filename,'_CO.png');assert.equal(Buffer.byteLength(out.filename),7);});
 test('minimum multibyte stem budget never emits only extension',()=>{for(const base of ['é','😀','अ'])assert.equal(buildFilename({base,ext:'png',maxLength:4}).filename,'i.png');});
});

describe('audit — honest environment and startup funnel',()=>{
 for(const injectInto of ['', 'auto','page','content','sandbox'])test(`isolation unknown for unverified metadata ${injectInto}`,()=>{const gm=createGmAdapter({GM_info:{injectInto,script:{'run-at':'document-start'}}});assert.equal(gm.sandboxed,null);assert.equal(gm.injectInto,injectInto);});
 test('a rejected startup promise is reported once without escaping',async()=>{const error=Error('forced asynchronous startup failure');const errors=[];assert.equal(await startProduction(async()=>{await Promise.resolve();throw error;},e=>errors.push(e)),null);assert.deepEqual(errors,[error]);});
 test('broken reporter does not turn contained failure into unhandled rejection',async()=>{assert.equal(await startProduction(async()=>{throw Error('x');},()=>{throw Error('reporter');}),null);});
});

describe('audit — deterministic encoder bytes pinned to audited original',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../golden/manifest.json',import.meta.url)));
 const actual=goldenOutputs({encodeBmp,encodeGif,encodePdf,encodeZip});
 for(const [name,bytes]of Object.entries(actual))test(name,()=>{
  const expected=readFileSync(new URL('../golden/'+name,import.meta.url));assert.equal(Buffer.from(bytes).equals(expected),true,'ANY byte difference requires explicit reviewed corpus/version decision');assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.files[name].sha256);assert.equal(bytes.length,manifest.files[name].bytes);
 });
});
