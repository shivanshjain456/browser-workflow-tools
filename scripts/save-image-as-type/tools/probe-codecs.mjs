import puppeteer from 'puppeteer';
for (const mode of [true, 'shell']) {
  const b = await puppeteer.launch({headless: mode, args:['--no-sandbox','--disable-dev-shm-usage']});
  const p = await b.newPage();
  const r = await p.evaluate(() => ({
    ImageDecoder: typeof ImageDecoder, VideoDecoder: typeof VideoDecoder,
    AudioDecoder: typeof AudioDecoder, WebCodecs: typeof window.EncoderState,
    mediaSource: typeof MediaSource,
  }));
  console.log('headless=' + mode, JSON.stringify(r));
  await b.close();
}
