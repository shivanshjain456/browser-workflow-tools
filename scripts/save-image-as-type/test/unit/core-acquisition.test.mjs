import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {loadBlobImage,decodeDataUrl} from '../../src/core/raster.js';
import {acquireImage} from '../../src/core/source.js';
import {getOriginalBytes} from '../../src/core/convert.js';

function withDecodeEnvironment(t,{htmlWorks=false,bitmap}={}) {
  const oldImage=Object.getOwnPropertyDescriptor(globalThis,'Image');
  const oldBitmap=Object.getOwnPropertyDescriptor(globalThis,'createImageBitmap');
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  class FakeImage {
    naturalWidth=2;naturalHeight=3;
    set src(value) { queueMicrotask(()=> htmlWorks ? this.onload?.() : this.onerror?.()); }
  }
  Object.defineProperty(globalThis,'Image',{configurable:true,value:FakeImage});
  Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:bitmap});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{href:'https://page.test/',origin:'https://page.test'}}});
  t.after(()=>{
    for(const [key,descriptor]of [['Image',oldImage],['createImageBitmap',oldBitmap],['window',oldWindow]]){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
    }
  });
}
const blob=new Blob([new Uint8Array([1,2,3])],{type:'image/png'});

describe('acquisition — CSP-safe decode leases',()=>{
 test('successful legacy HTML decode remains first and URL is revoked once',async t=>{
  let called=0;withDecodeEnvironment(t,{htmlWorks:true,bitmap:()=>{called++;throw Error('not needed');}});
  const revoked=[];const original=URL.revokeObjectURL.bind(URL);
  t.mock.method(URL,'revokeObjectURL',url=>{revoked.push(url);original(url);});
  const decoded=await loadBlobImage(blob);assert.equal(decoded.image.naturalWidth,2);assert.ok(decoded.objectUrl.startsWith('blob:'));assert.equal(called,0);
  decoded.dispose();decoded.dispose();assert.deepEqual(revoked,[decoded.objectUrl]);
 });
 test('blocked HTML decode falls back to owned bitmap; release is idempotent',async t=>{
  let closed=0;const bitmap={width:2,height:3,close(){closed++;}};
  withDecodeEnvironment(t,{bitmap:async()=>bitmap});const decoded=await loadBlobImage(blob);
  assert.equal(decoded.image,bitmap);assert.equal(decoded.objectUrl,null);decoded.dispose();decoded.dispose();assert.equal(closed,1);
 });
 test('unsupported bitmap codec fails, never reports a fake decode success',async t=>{
  withDecodeEnvironment(t,{bitmap:async()=>{throw Error('codec unavailable');}});
  await assert.rejects(loadBlobImage(blob),e=>e.code==='decode-failed');
 });
 test('timeout closes a bitmap that completes after the lease was abandoned',async t=>{
  let resolveBitmap,closed=0;const pending=new Promise(r=>{resolveBitmap=r;});withDecodeEnvironment(t,{bitmap:()=>pending});
  await assert.rejects(loadBlobImage(blob,{timeout:10,bitmapOnly:true}),e=>e.code==='timeout');
  resolveBitmap({width:2,height:3,close(){closed++;}});await new Promise(r=>setImmediate(r));assert.equal(closed,1);
 });
 test('abort rejects promptly and closes late bitmap exactly once',async t=>{
  let resolveBitmap,closed=0,started;const ready=new Promise(r=>{started=r;});
  withDecodeEnvironment(t,{bitmap:()=>{started();return new Promise(r=>{resolveBitmap=r;});}});
  const controller=new AbortController();const pending=loadBlobImage(blob,{signal:controller.signal,bitmapOnly:true});await ready;controller.abort();
  await assert.rejects(pending,e=>e.code==='aborted');resolveBitmap({width:2,height:3,close(){closed++;}});await new Promise(r=>setImmediate(r));assert.equal(closed,1);
 });
 test('pre-aborted operation never creates a decode',async t=>{
  let calls=0;withDecodeEnvironment(t,{bitmap:()=>{calls++;}});const c=new AbortController();c.abort();await assert.rejects(loadBlobImage(blob,{signal:c.signal}),e=>e.code==='aborted');assert.equal(calls,0);
 });
});

describe('acquisition — local payload and cached byte contract',()=>{
 test('base64, percent-escaped binary and literal UTF8 decode without fetch',()=>{
  assert.deepEqual([...decodeDataUrl('data:image/png;base64,AP8B').bytes],[0,255,1]);
  assert.deepEqual([...decodeDataUrl('data:application/octet-stream,%00%ff+%2B').bytes],[0,255,43,43]);
  assert.equal(new TextDecoder().decode(decodeDataUrl('data:text/plain,é').bytes),'é');
  assert.equal(decodeDataUrl('data:image/png;base64,AP8%2B').mime,'image/png');
  for(const url of ['https://a.test/','data:x','data:image/png,%xx','data:image/png,%'])assert.throws(()=>decodeDataUrl(url));
 });
 test('manager-byte cache returns documented record and original needs no refetch',async t=>{
  withDecodeEnvironment(t,{htmlWorks:true});
  // Two failed anonymous attempts would normally reach GM; fake image first
  // decode fails, then the manager Blob decode succeeds on its new instance.
  let count=0;class FakeImage {
    naturalWidth=2;naturalHeight=3;
    set src(value){count++;queueMicrotask(()=>count===1?this.onerror?.():this.onload?.());}
  }
  Object.defineProperty(globalThis,'Image',{configurable:true,value:FakeImage});
  const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  const documentStub = {
    createElement() {
      return {
        getContext() {
          return {
            drawImage() {},
            getImageData() { return { data: new Uint8ClampedArray(4) }; },
          };
        },
      };
    },
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });
  t.after(()=>oldDocument?Object.defineProperty(globalThis,'document',oldDocument):delete globalThis.document);
  const bytes=new Uint8Array([1,2,3]);let fetches=0;
  const gm={capabilities:{xhr:true},async xhrBlob(){fetches++;return{status:200,response:new Blob([bytes],{type:'image/png'}),responseHeaders:'Content-Type: image/png',finalUrl:'https://cdn.test/final.png'};}};
  const acquired=await acquireImage({kind:'img',url:'https://cdn.test/image.png'},{gm,settings:{allowCrossOriginFetch:true}});
  const cached=await acquired.getBytes();assert.deepEqual(cached.bytes,bytes);assert.equal(cached.mime,'image/png');assert.equal(cached.finalUrl,'https://cdn.test/final.png');
  const original=await getOriginalBytes(acquired,{gm,settings:{allowCrossOriginFetch:false},timeout:20});assert.deepEqual(original.bytes,bytes);assert.equal(fetches,1);acquired.release();acquired.release();
 });
});
