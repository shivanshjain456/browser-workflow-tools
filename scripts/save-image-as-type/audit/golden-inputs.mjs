/** Stable regression inputs: changing this file invalidates the corpus contract. */
import {readFileSync} from 'node:fs';
import {FIXTURES} from '../test/helpers/harness.mjs';
export function goldenOutputs(api) {
  const bytes={
    'alpha.bmp':api.encodeBmp(FIXTURES.halfTransparent(12,10)),
    'odd.bmp':api.encodeBmp(FIXTURES.oddWidth(5,3)),
    'static.gif':api.encodeGif([{imageData:FIXTURES.fourColors(),delayMs:100}]),
    'animated.gif':api.encodeGif(FIXTURES.animFrames(),{loop:0}),
    'single.pdf':api.encodePdf({jpegBytes:new Uint8Array(readFileSync(new URL('../test/fixtures/photo.jpg',import.meta.url))),width:200,height:140,title:'Pinned baseline',now:()=>new Date('2024-02-03T04:05:06Z')}),
  };
  bytes['unicode.zip']=api.encodeZip([{name:'café/alpha.bmp',bytes:bytes['alpha.bmp']},{name:'odd.bmp',bytes:bytes['odd.bmp']}],{now:()=>new Date(2024,1,3,4,5,6)}).bytes;
  return bytes;
}
