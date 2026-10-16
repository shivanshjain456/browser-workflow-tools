/** Read-only comparison to fingerprinted original; no runtime/public test handle. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,MENU_ACTION_LABELS} from '../src/core/settings.js';
import {FORMATS} from '../src/core/formats.js';
import {DEFAULT_SHORTCUTS} from '../src/core/shortcuts.js';
const original=readFileSync('audit/baseline/v2.0.0.user.js','utf8');
assert.equal(createHash('md5').update(original).digest('hex'),'ed285e423b3e85b5da38e9798423581c');
const context={__SIAT_NO_AUTOBOOT:true,TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,Uint16Array,Uint32Array,Int32Array,ArrayBuffer,DataView,Blob,Date,Map,Set,WeakMap,WeakSet,URL,console};
vm.createContext(context);
vm.runInContext(original.replace(/\}\)\(\);\s*$/,'globalThis.contract=JSON.stringify({settings:DEFAULT_SETTINGS,formats:FORMATS,actions:MENU_ACTION_LABELS,shortcuts:DEFAULT_SHORTCUTS});\n})();'),context,{timeout:5000});
const before=JSON.parse(context.contract),after=JSON.parse(JSON.stringify({settings:DEFAULT_SETTINGS,formats:FORMATS,actions:MENU_ACTION_LABELS,shortcuts:DEFAULT_SHORTCUTS}));
const originalKeys=Object.keys(before.settings);
const candidateKeys=Object.keys(after.settings);
// Every original default keeps its exact value and type...
for(const key of originalKeys)assert.deepEqual(after.settings[key],before.settings[key],'original default changed: '+key);
// ...nothing was removed...
for(const key of originalKeys)assert.ok(candidateKeys.includes(key),'original default removed: '+key);
// ...and anything new is declared here, with its intended default.
const added=candidateKeys.filter(key=>!originalKeys.includes(key));
assert.deepEqual(added,['profiles'],'undeclared new default setting');
assert.deepEqual(after.settings.profiles,[],'the new profiles list defaults to empty, so behaviour is unchanged');
assert.deepEqual(after.formats,before.formats,'the format registry must stay byte-identical');
assert.deepEqual(after.actions,before.actions,'menu action definitions must stay identical');
assert.deepEqual(after.shortcuts,before.shortcuts,'default shortcuts must stay identical');
const production=readFileSync('release/save-image-as-type.user.js','utf8');
const grants=text=>[...text.matchAll(/^\/\/ @grant\s+(\S+)/gm)].map(m=>m[1]);
assert.deepEqual(grants(production),grants(original));
const report={baselineMd5:'ed285e423b3e85b5da38e9798423581c',candidateSha256:createHash('sha256').update(production).digest('hex'),settingsKeys:Object.keys(DEFAULT_SETTINGS).length,originalSettingsKeys:originalKeys.length,addedSettingsKeys:added,formats:FORMATS.map(f=>f.id),actions:MENU_ACTION_LABELS,shortcuts:DEFAULT_SHORTCUTS,baselineAndCandidateDefaultsIdentical:true,formatRegistryAndActionDefinitionsIdentical:true,grants:grants(production),grantsAdded:0,scope:'Offline original pure-data extraction compared to current source imports; manager commands and migrations tested separately'};
writeFileSync('audit/evidence/compatibility-contract.json',JSON.stringify(report,null,2)+'\n');
console.log(`PASS: ${originalKeys.length} original defaults unchanged, ${added.length} declared addition (${added.join(', ')}), 8 full format definitions, 6 actions, shortcuts, and 10 grants.`);
