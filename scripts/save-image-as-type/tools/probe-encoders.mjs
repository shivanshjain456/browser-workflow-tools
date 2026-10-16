import puppeteer from 'puppeteer';
const b = await puppeteer.launch({args:['--no-sandbox','--disable-dev-shm-usage','--enable-features=CanvasOopRasterization']});
const p = await b.newPage();
await p.setContent('<canvas id=c width=8 height=8></canvas>');
const out = await p.evaluate(async () => {
  const r = {ua: navigator.userAgent, ver: navigator.userAgentData?.brands};
  const c = document.getElementById('c'); const ctx = c.getContext('2d');
  ctx.fillStyle = '#e33'; ctx.fillRect(0,0,8,8);
  const tryType = t => new Promise(res => {
    try { c.toBlob(b => res(b ? {ok:true, type:b.type, size:b.size} : {ok:false}), t, 0.9); }
    catch(e){ res({ok:false, err:String(e)}); }
  });
  r.toBlob = {};
  for (const t of ['image/png','image/jpeg','image/webp','image/avif','image/gif','image/bmp']) r.toBlob[t] = await tryType(t);
  // ImageDecoder support
  r.ImageDecoder = typeof window.ImageDecoder;
  if (window.ImageDecoder?.isTypeSupported) {
    r.isTypeSupported = {};
    for (const t of ['image/webp','image/gif','image/png','image/apng','image/avif','image/jpeg']) {
      try { r.isTypeSupported[t] = await ImageDecoder.isTypeSupported(t); } catch(e){ r.isTypeSupported[t] = 'ERR '+e.message; }
    }
  }
  // createImageBitmap options
  r.createImageBitmap = typeof createImageBitmap;
  // OffscreenCanvas / convertToBlob
  r.OffscreenCanvas = typeof OffscreenCanvas;
  // structuredClone, ResizeObserver
  r.requestIdleCallback = typeof requestIdleCallback;
  return r;
});
console.log(JSON.stringify(out,null,1));
await b.close();
