import test from 'node:test';
import assert from 'node:assert/strict';

const DENIED_PARAMS = new Set([
  'si',
  'feature',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'igshid'
]);

const ALLOWED_CORE_PARAMS = new Set([
  'v',
  't',
  'list',
  'index',
  'start',
  'end',
  'clip',
  'clipt'
]);

function sanitizeYouTubeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const validHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
    if (!validHosts.includes(host)) return rawUrl;

    const pairs = [];
    for (const [key, value] of url.searchParams.entries()) {
      const lowerKey = key.toLowerCase();
      if (!DENIED_PARAMS.has(lowerKey)) {
        pairs.push([key, value]);
      }
    }

    url.search = '';
    for (const [k, v] of pairs) {
      url.searchParams.append(k, v);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

test('Sanitizer removes tracking parameters while preserving media parameters', () => {
  const input = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=tracking_id&feature=shared&t=42s';
  const clean = sanitizeYouTubeUrl(input);
  const parsed = new URL(clean);

  assert.equal(parsed.searchParams.get('v'), 'dQw4w9WgXcQ');
  assert.equal(parsed.searchParams.get('t'), '42s');
  assert.equal(parsed.searchParams.has('si'), false);
  assert.equal(parsed.searchParams.has('feature'), false);
});

test('Sanitizer cleans youtu.be shortlinks', () => {
  const input = 'https://youtu.be/dQw4w9WgXcQ?si=token_xyz&utm_source=twitter';
  const clean = sanitizeYouTubeUrl(input);
  const parsed = new URL(clean);

  assert.equal(parsed.hostname, 'youtu.be');
  assert.equal(parsed.pathname, '/dQw4w9WgXcQ');
  assert.equal(parsed.search, '');
});

test('Sanitizer supports music.youtube.com and m.youtube.com', () => {
  const music = 'https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=tracker&list=RDAMVM';
  const cleanMusic = sanitizeYouTubeUrl(music);
  const parsedMusic = new URL(cleanMusic);

  assert.equal(parsedMusic.searchParams.get('v'), 'dQw4w9WgXcQ');
  assert.equal(parsedMusic.searchParams.get('list'), 'RDAMVM');
  assert.equal(parsedMusic.searchParams.has('si'), false);

  const mobile = 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&si=abc';
  const cleanMobile = sanitizeYouTubeUrl(mobile);
  assert.equal(cleanMobile, 'https://m.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('Sanitizer preserves exact case for non-tracking parameters', () => {
  const input = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&customParam=ABCDef&si=123';
  const clean = sanitizeYouTubeUrl(input);
  const parsed = new URL(clean);

  assert.equal(parsed.searchParams.get('customParam'), 'ABCDef');
  assert.equal(parsed.searchParams.has('si'), false);
});
