/** Maintainer-only corpus creation from fingerprinted ORIGINAL, never part of verification. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {goldenOutputs} from './golden-inputs.mjs';
const original=readFileSync('audit/baseline/v2.0.0.user.js','utf8');
if(createHash('md5').update(original).digest('hex')!=='ed285e423b3e85b5da38e9798423581c')throw Error('Not audited original');
class FrozenDate extends Date { constructor(...args) { super(...(args.length ? args : ['2024-02-03T04:05:06Z'])); } }
const context={__SIAT_NO_AUTOBOOT:true, TextEncoder, TextDecoder, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int32Array, ArrayBuffer, DataView, Blob, Date:FrozenDate, Map,Set,WeakMap,WeakSet,URL,console};
vm.createContext(context);
vm.runInContext(original.replace(/\}\)\(\);\s*$/, 'globalThis.pinned = {encodeBmp,encodeGif,encodePdf,encodeZip};\n})();'),context,{timeout:5000});
const output=goldenOutputs(context.pinned), manifest={sourceMd5:'ed285e423b3e85b5da38e9798423581c',sourceSha256:createHash('sha256').update(original).digest('hex'),clock:'Local DOS wall time 2024-02-03 04:05:06; no timezone-dependent UTC construction',files:{}};
mkdirSync('test/golden',{recursive:true});
for(const [name,data]of Object.entries(output)){
 const bytes=Buffer.from(data);writeFileSync('test/golden/'+name,bytes);manifest.files[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
writeFileSync('test/golden/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
