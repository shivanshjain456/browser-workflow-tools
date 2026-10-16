import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATE_TOKENS,
  MAX_TEMPLATE_LENGTH,
  tokensIn,
  validateTemplate,
  renderTemplate,
  uniqueFilename,
} from '../../src/core/template.js';
import { buildFilename } from '../../src/core/filename.js';

/**
 * Feature: filename templates.
 *
 * A template is user text mixed with values that come from the page (host, alt
 * text, title) — i.e. untrusted. Two properties matter most:
 *   1. rendering is total: nothing unknown survives into the name, and nothing
 *      is ever treated as markup or a path separator;
 *   2. the result is deterministic, so a test (and a user) can predict the
 *      exact file name a template produces.
 */

const NOW = new Date(2026, 9, 16, 14, 5, 9); // 2026-10-16 14:05:09 local

describe('template tokens — the documented surface', () => {
  test('every advertised token renders, and only advertised tokens do', () => {
    const context = {
      base: 'photo-0142',
      path: 'photo-0142',
      host: 'cdn.example.com',
      origin: 'example.com',
      title: 'Gallery',
      alt: 'Red fox',
      w: 1920,
      h: 1080,
      format: 'jpg',
      ext: 'jpeg',
      mime: 'jpeg',
      bytes: 284193,
    };
    for (const entry of TEMPLATE_TOKENS) {
      const rendered = renderTemplate(`{${entry.token}}`, context, { counter: 7, now: NOW, preset: 'Archive PNG' });
      assert.ok(rendered.text.length > 0, `{${entry.token}} produced a value`);
      assert.equal(rendered.warnings.length, 0, `{${entry.token}} is a known token`);
    }
    assert.equal(tokensIn('{base}-{nope}').includes('nope'), true, 'unknown tokens are still listed');
    assert.equal(validateTemplate('{nope}').ok, false, 'an unknown token fails validation');
  });

  test('the token list is what the settings panel advertises', () => {
    const names = TEMPLATE_TOKENS.map((entry) => entry.token);
    for (const expected of ['base', 'host', 'origin', 'title', 'alt', 'w', 'h', 'format', 'ext', 'date', 'time', 'index', 'index3', 'preset']) {
      assert.ok(names.includes(expected), `{${expected}} is documented`);
    }
    assert.equal(new Set(names).size, names.length, 'no token is documented twice');
    for (const entry of TEMPLATE_TOKENS) {
      assert.ok(entry.label && entry.example, `{${entry.token}} has a label and an example`);
    }
  });
});

describe('validateTemplate — before anything is stored', () => {
  test('accepts a normal template and reports its tokens', () => {
    const result = validateTemplate('{host}-{date}-{w}x{h}-{index3}.{ext}');
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.tokens, ['host', 'date', 'w', 'h', 'index3', 'ext']);
  });

  test('rejects empty, over-long and unknown-token templates', () => {
    assert.equal(validateTemplate('').ok, false, 'empty is invalid (empty means "use the classic name")');
    assert.equal(validateTemplate('   ').ok, false);
    assert.equal(validateTemplate('a'.repeat(MAX_TEMPLATE_LENGTH + 1)).ok, false, 'over the length limit');
    assert.equal(validateTemplate('{base}'.repeat(40)).ok, false, 'tokens count towards the length limit');
    const unknown = validateTemplate('{base}-{script}');
    assert.equal(unknown.ok, false);
    assert.match(unknown.errors.join(' '), /Unknown token.*\{script\}/);
  });

  test('warns about the mistakes that produce bad names but are still usable', () => {
    assert.ok(validateTemplate('{base}{host}').warnings.some((w) => /braces/.test(w)) === false, 'balanced braces do not warn');
    assert.ok(validateTemplate('{base').warnings.some((w) => /braces do not balance/.test(w)), 'unbalanced braces warn');
    assert.ok(validateTemplate('photos').warnings.some((w) => /no tokens/.test(w)), 'a token-less template warns');
    assert.ok(validateTemplate('{host}/{date}').warnings.some((w) => /not allowed in file names/.test(w)), 'path separators warn');
    assert.ok(validateTemplate('{date}-{index}').warnings.some((w) => /may collide/.test(w)), 'no name-bearing token warns');
    assert.equal(validateTemplate('{base}').warnings.length, 0, 'the obvious template is quiet');
  });

  test('validation never throws on non-string input', () => {
    for (const value of [null, undefined, 42, {}, ['{base}']]) {
      assert.equal(validateTemplate(value).ok, false, `${JSON.stringify(value)} is rejected, not thrown`);
    }
  });
});

describe('renderTemplate — deterministic and total', () => {
  test('the documented acceptance case: {host} + {w}x{h} gives the exact file name', () => {
    const rendered = renderTemplate('{host}-{w}x{h}', { host: 'cdn.example.com', w: 200, h: 140 }, { now: NOW });
    assert.equal(rendered.text, 'cdn.example.com-200x140');
    const named = buildFilename({ base: rendered.text, ext: 'png', prefix: '', subfolder: '', maxLength: 64 });
    assert.equal(named.filename, 'cdn.example.com-200x140.png');
  });

  test('date, time, index and preset render in the documented shapes', () => {
    const context = { base: 'photo' };
    assert.equal(renderTemplate('{date}', context, { now: NOW }).text, '2026-10-16');
    assert.equal(renderTemplate('{time}', context, { now: NOW }).text, '14-05-09');
    assert.equal(renderTemplate('{datetime}', context, { now: NOW }).text, '2026-10-16-14-05-09');
    assert.equal(renderTemplate('{index}', context, { counter: 7, now: NOW }).text, '7');
    assert.equal(renderTemplate('{index3}', context, { counter: 7, now: NOW }).text, '007');
    assert.equal(renderTemplate('{index3}', context, { counter: 1234, now: NOW }).text, '1234', 'padding never truncates');
    assert.equal(renderTemplate('{preset}', context, { preset: 'Archive PNG', now: NOW }).text, 'Archive PNG');
  });

  test('an unknown token is dropped with a warning, never left in the name', () => {
    const rendered = renderTemplate('{base}-{evil}', { base: 'photo' }, { now: NOW });
    assert.equal(rendered.text, 'photo');
    assert.ok(rendered.warnings.some((w) => /Removed unknown token \{evil\}/.test(w)), 'the user is told');
    assert.equal(rendered.text.includes('evil'), false);
  });

  test('page-derived values are sanitised: no path escape, no separators, no control characters', () => {
    const rendered = renderTemplate('{alt}-{title}-{host}', {
      alt: '../../etc/passwd',
      title: 'a<b>c:d"e|f?g*h\u0000i\u202ej',
      host: 'cdn.example.com/../../secret',
    }, { now: NOW });
    assert.equal(/[/\\]/.test(rendered.text), false, 'no path separator survives');
    assert.equal(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\ufeff]/.test(rendered.text), false, 'no control or bidi characters');
    assert.equal(/[<>:"|?*]/.test(rendered.text), false, 'no reserved Windows characters');
    assert.ok(rendered.text.includes('cdn.example.com'), 'the useful part of the host survives');
    // The rendered stem is a single path component: with no separator left in it,
    // an interior ".." cannot traverse anywhere, and the leading-dot form that
    // would hide a file is stripped.
    const named = buildFilename({ base: rendered.text, ext: 'png', subfolder: '', maxLength: 64 });
    assert.equal(named.path.split('/').length, 1, `one path component: ${named.path}`);
    assert.equal(named.path.split('/').some((part) => part === '..' || part === '.'), false, 'no traversal component');
    assert.equal(/^\./.test(named.filename), false, 'the name is not hidden');
  });

  test('a token that renders to nothing cannot produce an empty or dot-leading name', () => {
    const empty = renderTemplate('{alt}', { alt: '' }, { now: NOW });
    assert.ok(empty.warnings.some((w) => /empty name/.test(w)), 'the fallback is reported');
    assert.equal(empty.text, '');
    const dots = renderTemplate('{alt}', { alt: '...' }, { now: NOW });
    assert.equal(/^\./.test(dots.text), false, 'leading dots are stripped');
  });

  test('missing context values render as empty, not as "undefined"', () => {
    const rendered = renderTemplate('{base}-{alt}', { base: 'photo' }, { now: NOW });
    assert.equal(rendered.text, 'photo');
    assert.equal(rendered.text.includes('undefined'), false);
    assert.deepEqual(rendered.values.base, 'photo');
  });

  test('an invalid clock falls back to a real date instead of NaN', () => {
    const rendered = renderTemplate('{date}', { base: 'x' }, { now: new Date('nonsense') });
    assert.match(rendered.text, /^\d{4}-\d{2}-\d{2}$/, `got ${rendered.text}`);
  });

  test('long values are clamped so the name stays usable', () => {
    const rendered = renderTemplate('{alt}', { alt: 'a'.repeat(4000) }, { now: NOW });
    assert.ok(rendered.text.length <= 150, `clamped to ${rendered.text.length} characters`);
  });
});

describe('uniqueFilename — collisions inside one run', () => {
  test('an unused name is returned unchanged', () => {
    assert.equal(uniqueFilename('photo.png', new Set()), 'photo.png');
    assert.equal(uniqueFilename('photo.png', ['other.png']), 'photo.png', 'arrays are accepted too');
  });

  test('a collision gets the lowest free counter, keeping the extension', () => {
    const taken = new Set(['photo.png', 'photo-2.png']);
    assert.equal(uniqueFilename('photo.png', taken), 'photo-3.png');
    assert.equal(uniqueFilename('deep.name.tar.gz', new Set(['deep.name.tar.gz'])), 'deep.name.tar-2.gz', 'only the last dot splits');
  });

  test('a name without an extension still gets a counter', () => {
    assert.equal(uniqueFilename('README', new Set(['README'])), 'README-2');
  });

  test('a batch of identical names produces a set of distinct names', () => {
    const taken = new Set();
    const produced = [];
    for (let i = 0; i < 250; i += 1) {
      const name = uniqueFilename('photo.png', taken);
      taken.add(name);
      produced.push(name);
    }
    assert.equal(new Set(produced).size, 250, 'every name is distinct');
    assert.equal(produced[0], 'photo.png');
    assert.equal(produced[1], 'photo-2.png');
    assert.equal(produced[249], 'photo-250.png');
  });

  test('hostile input cannot escape the download folder through the counter', () => {
    assert.equal(uniqueFilename('../../evil.png', new Set(['../../evil.png'])), '../../evil-2.png', 'countering does not sanitise — buildFilename does');
    const named = buildFilename({ base: uniqueFilename('../../evil.png', new Set(['../../evil.png'])).replace(/\.png$/, ''), ext: 'png' });
    assert.equal(named.filename.includes('/'), false);
    assert.equal(named.filename.includes('..'), false);
  });
});
