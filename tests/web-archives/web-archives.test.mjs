import test from 'node:test';
import assert from 'node:assert/strict';

const ALLOWED_PROBE_HOSTS = new Set([
  'archive.org',
  'web.archive.org',
  'api.perma.cc',
  'archive.softwareheritage.org',
  'archive.ph',
  'archive.today',
  'archive.is',
  'archive.li',
  'archive.vn',
  'archive.fo',
  'archive.md',
  'ghostarchive.org',
  'megalodon.jp'
]);

function validateTargetUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    // Exclude localhost / private IP ranges
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.16.')) return false;
    return true;
  } catch {
    return false;
  }
}

function parseMementoTimeMap(timeMapText) {
  const entries = timeMapText.split(/,\s*(?=<)/);
  const mementos = [];
  for (const entry of entries) {
    const uriMatch = /^\s*<([^>]+)>/.exec(entry);
    if (!uriMatch) continue;
    if (!/rel\s*=\s*"[^"]*memento[^"]*"/i.test(entry)) continue;
    const dtMatch = /datetime\s*=\s*"([^"]+)"/i.exec(entry);
    mementos.push({
      url: uriMatch[1],
      time: dtMatch ? Date.parse(dtMatch[1]) : NaN
    });
  }
  return mementos;
}

function buildArchiveTarget(engineKey, targetUrl) {
  const encoded = encodeURIComponent(targetUrl);
  switch (engineKey) {
    case 'wayback':
      return `https://web.archive.org/web/${targetUrl}`;
    case 'archiveIs':
      return `https://archive.is/${targetUrl}`;
    case 'permaCc':
      return `https://api.perma.cc/v1/public/archives/?url=${encoded}`;
    default:
      return null;
  }
}

test('Target URL validation rejects private IPs, localhost, and non-http schemes', () => {
  assert.equal(validateTargetUrl('https://example.com/research/paper.pdf'), true);
  assert.equal(validateTargetUrl('http://github.com/torvalds/linux'), true);
  assert.equal(validateTargetUrl('javascript:alert(1)'), false);
  assert.equal(validateTargetUrl('data:text/html,<b>Hello</b>'), false);
  assert.equal(validateTargetUrl('file:///C:/passwords.txt'), false);
  assert.equal(validateTargetUrl('http://localhost:3000/admin'), false);
  assert.equal(validateTargetUrl('http://127.0.0.1:8080'), false);
  assert.equal(validateTargetUrl('http://192.168.1.1/router'), false);
});

test('Memento TimeMap parser extracts snapshots and timestamps accurately', () => {
  const timemap = '<https://archive.is/20210515120000/https://example.com>; rel="memento"; datetime="Sat, 15 May 2021 12:00:00 GMT",\n<https://archive.is/20220820153000/https://example.com>; rel="memento"; datetime="Sat, 20 Aug 2022 15:30:00 GMT"';
  const parsed = parseMementoTimeMap(timemap);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].url, 'https://archive.is/20210515120000/https://example.com');
  assert.ok(Number.isFinite(parsed[0].time));
  assert.equal(parsed[1].url, 'https://archive.is/20220820153000/https://example.com');
});

test('Probe hosts strictly adhere to static allowlist without wildcards', () => {
  assert.equal(ALLOWED_PROBE_HOSTS.has('web.archive.org'), true);
  assert.equal(ALLOWED_PROBE_HOSTS.has('archive.is'), true);
  assert.equal(ALLOWED_PROBE_HOSTS.has('api.perma.cc'), true);
  assert.equal(ALLOWED_PROBE_HOSTS.has('malicious-tracker.com'), false);
  assert.equal(ALLOWED_PROBE_HOSTS.has('*'), false);
});

test('Archive URL constructors build canonical search/snapshot targets', () => {
  const target = 'https://news.ycombinator.com';
  assert.equal(buildArchiveTarget('wayback', target), 'https://web.archive.org/web/https://news.ycombinator.com');
  assert.equal(buildArchiveTarget('archiveIs', target), 'https://archive.is/https://news.ycombinator.com');
});
