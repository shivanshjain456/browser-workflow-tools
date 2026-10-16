import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizePathComponent,
  sanitizeSubfolder,
  baseNameFromSource,
  buildFilename,
} from '../../src/core/filename.js';

describe('sanitizePathComponent — hostile input', () => {
  test('removes characters that are illegal in file names on major platforms', () => {
    assert.equal(sanitizePathComponent('a<b>c:d"e/f\\g|h?i*j'), 'a b c d e f g h i j');
  });

  test('removes control characters, BOM and bidi override characters', () => {
    const input = `na\u0000me\u001f\u007f\u202e\u200efak\u202a.png`;
    const out = sanitizePathComponent(input);
    assert.ok(!/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\ufeff]/.test(out), `control/bidi characters removed: ${JSON.stringify(out)}`);
    // Invisible characters become a space rather than being deleted: silently
    // joining "na"+"me" could synthesise a new, misleading word, and a space
    // keeps the visible text intact and readable.
    assert.equal(out, 'na me fak .png');
    // The bidi override becomes a space, so the visible text stays separated and
    // the real extension (.exe) is still the last component — no disguised name.
    assert.equal(sanitizePathComponent('a\u202eevil\u202c.exe'), 'a evil .exe');
    assert.ok(sanitizePathComponent('a\u202eevil\u202c.exe').endsWith('.exe'));
  });

  test('cannot be used to escape the download folder', () => {
    assert.equal(sanitizePathComponent('../../etc/passwd'), 'etc passwd');
    assert.equal(sanitizePathComponent('..\\..\\windows\\system32'), 'windows system32');
    assert.equal(sanitizePathComponent('/absolute/path'), 'absolute path');
    assert.ok(!sanitizePathComponent('a/b').includes('/'));
    assert.ok(!sanitizePathComponent('a\\b').includes('\\'));
  });

  test('strips leading and trailing dots and spaces (Windows rejects them)', () => {
    assert.equal(sanitizePathComponent('  ...hidden...  '), 'hidden');
    assert.equal(sanitizePathComponent('...'), '');
    assert.equal(sanitizePathComponent('   '), '');
  });

  test('prefixes Windows reserved device names so they stay usable', () => {
    for (const name of ['CON', 'con', 'NUL', 'PRN', 'AUX', 'COM1', 'LPT9']) {
      assert.equal(sanitizePathComponent(name), `_${name}`, name);
    }
    assert.equal(sanitizePathComponent('concert'), 'concert', 'only exact reserved names are affected');
  });

  test('decodes percent escapes but never lets them reintroduce separators', () => {
    assert.equal(sanitizePathComponent('my%20image'), 'my image');
    assert.equal(sanitizePathComponent('a%2Fb'), 'a b', '%2F decodes to a slash, which is then removed');
    assert.equal(sanitizePathComponent('caf%C3%A9'), 'café', 'multi-byte UTF-8 escapes decode as one run');
    assert.equal(sanitizePathComponent('%E6%97%A5%E6%9C%AC%E8%AA%9E'), '日本語', 'a fully encoded CJK name survives');
    // A malformed escape is left as literal text: "%" is legal in file names on
    // every platform, and deleting characters the user can see is worse than
    // keeping them. Critically, this never throws.
    assert.equal(sanitizePathComponent('bad%ZZescape'), 'bad%ZZescape');
    assert.equal(sanitizePathComponent('photo%2520name'), 'photo%20name', 'decoded exactly once, so a double-encoded separator cannot appear');
  });

  test('normalises unicode and collapses whitespace', () => {
    assert.equal(sanitizePathComponent('a\u0065\u0301b'), 'aéb', 'NFC normalisation');
    assert.equal(sanitizePathComponent('many   spaces\tand\nnewlines'), 'many spaces and newlines');
  });

  test('enforces the length cap without leaving a trailing dot or space', () => {
    const out = sanitizePathComponent('x'.repeat(500), { maxChars: 40 });
    assert.equal(out.length, 40);
    const dotted = sanitizePathComponent(`${'y'.repeat(50)}...`, { maxChars: 20 });
    assert.ok(dotted.length <= 20 && !dotted.endsWith('.'), `"${dotted}"`);
  });

  test('non-string input yields an empty string instead of throwing', () => {
    for (const value of [null, undefined, 42, {}, [], Symbol.iterator]) {
      assert.equal(sanitizePathComponent(value), '');
    }
  });
});

describe('sanitizeSubfolder', () => {
  test('keeps a sane relative path and drops traversal', () => {
    assert.equal(sanitizeSubfolder('images/references'), 'images/references');
    assert.equal(sanitizeSubfolder('images\\references'), 'images/references', 'backslashes normalised');
    assert.equal(sanitizeSubfolder('../../etc'), 'etc');
    assert.equal(sanitizeSubfolder('/absolute'), 'absolute');
    assert.equal(sanitizeSubfolder('a/b/c/d/e'), 'a/b/c', 'capped at three segments');
    assert.equal(sanitizeSubfolder('  spaced / name  '), 'spaced/name');
    assert.equal(sanitizeSubfolder(''), '');
    assert.equal(sanitizeSubfolder('///'), '');
    assert.equal(sanitizeSubfolder(null), '');
  });

  test('each segment is limited and reserved names are defused', () => {
    assert.equal(sanitizeSubfolder(`${'z'.repeat(80)}/x`).length, 40 + 2, 'segment capped at 40 chars');
    assert.equal(sanitizeSubfolder('CON/NUL'), '_CON/_NUL');
  });
});

describe('baseNameFromSource — derivation order', () => {
  test('prefers the URL basename, then alt, then title, then host', () => {
    assert.equal(baseNameFromSource({ sourceUrl: 'https://cdn.example.com/a/b/photo.jpg?x=1#f' }), 'photo');
    assert.equal(baseNameFromSource({ sourceUrl: 'https://cdn.example.com/', altText: 'A red car' }), 'A red car');
    assert.equal(baseNameFromSource({ altText: '', documentTitle: 'My Page — Site', hostName: 'example.com' }), 'My Page');
    assert.equal(baseNameFromSource({ hostName: 'example.com' }), 'example.com');
    assert.equal(baseNameFromSource({}), 'image', 'final fallback');
  });

  test('handles data: and blob: URLs, which have no basename', () => {
    assert.equal(baseNameFromSource({ sourceUrl: 'data:image/png;base64,iVBORw0K', altText: 'icon' }), 'icon', 'alt text beats a literal "image"');
    assert.equal(baseNameFromSource({ sourceUrl: 'data:image/png;base64,iVBORw0K', documentTitle: 'Spritesheet | Game', hostName: 'game.example' }), 'Spritesheet');
    assert.equal(baseNameFromSource({ sourceUrl: 'blob:https://site/8f14e45f-ceea-4b7f' }), 'image', 'a blob UUID is not a name');
    assert.equal(baseNameFromSource({ sourceUrl: 'blob:https://site/8f14e45f', altText: 'avatar' }), 'avatar');
    assert.equal(baseNameFromSource({ sourceUrl: 'filesystem:https://site/temporary/x.png' }), 'image');
  });

  test('a hostile URL cannot inject a path or an illegal name', () => {
    const name = baseNameFromSource({ sourceUrl: 'https://evil.example/a/../../etc/passwd%00.png' });
    assert.ok(!name.includes('/'), `no separator: ${name}`);
    assert.ok(!name.includes('\u0000'), 'no NUL byte');
    assert.ok(name.length > 0);
  });

  test('encoded URLs are decoded for readability', () => {
    assert.equal(baseNameFromSource({ sourceUrl: 'https://x.example/my%20holiday%20photo.jpg' }), 'my holiday photo');
  });
});

describe('buildFilename', () => {
  test('applies prefix, extension and keeps the stem intact', () => {
    const result = buildFilename({ base: 'photo', ext: 'png', prefix: 'ref' });
    assert.equal(result.filename, 'ref-photo.png');
    assert.equal(result.truncated, false);
    assert.equal(result.subfolderApplied, false);
  });

  test('forces the correct extension and sanitises a hostile one', () => {
    assert.equal(buildFilename({ base: 'photo', ext: 'PNG' }).filename, 'photo.png');
    assert.equal(buildFilename({ base: 'photo', ext: 'p/h' }).filename, 'photo.ph', 'separators removed from the extension');
    assert.equal(buildFilename({ base: 'photo', ext: '' }).filename, 'photo');
    assert.equal(buildFilename({ base: 'photo', ext: 'jpegjpegjpeg' }).filename, 'photo.jpegj', 'extension capped at 5 chars');
  });

  test('truncates the stem, never the extension, and reports it', () => {
    const result = buildFilename({ base: 'x'.repeat(200), ext: 'png', maxLength: 20 });
    assert.equal(result.filename.length, 20);
    assert.ok(result.filename.endsWith('.png'));
    assert.equal(result.truncated, true);
  });

  test('truncation is byte-aware for multi-byte characters', () => {
    const result = buildFilename({ base: '日本語のなまえ'.repeat(6), ext: 'png', maxLength: 24 });
    const bytes = new TextEncoder().encode(result.filename).length;
    assert.ok(bytes <= 24, `utf-8 byte length ${bytes} within the 24-byte budget`);
    assert.ok(result.filename.endsWith('.png'));
    assert.ok(!/[.\s\-_]$/.test(result.filename.slice(0, -4)), 'no dangling separator before the extension');
  });

  test('clamps an out-of-range maxLength instead of producing an unusable name', () => {
    assert.ok(buildFilename({ base: 'photo', ext: 'png', maxLength: 1 }).filename.length >= 5);
    assert.ok(buildFilename({ base: 'photo', ext: 'png', maxLength: 'abc' }).filename.length >= 5);
    assert.ok(buildFilename({ base: 'photo', ext: 'png', maxLength: 99999 }).filename === 'photo.png');
  });

  test('sub-folder is included only when the caller says the manager supports it', () => {
    const off = buildFilename({ base: 'photo', ext: 'png', subfolder: 'refs', includeSubfolder: false });
    assert.equal(off.path, 'photo.png');
    assert.equal(off.subfolderApplied, false);
    assert.equal(off.droppedSubfolder, true, 'the caller is told it was dropped so the UI can explain');

    const on = buildFilename({ base: 'photo', ext: 'png', subfolder: 'refs/2026', includeSubfolder: true });
    assert.equal(on.path, 'refs/2026/photo.png');
    assert.equal(on.filename, 'photo.png', 'bare name still available for the anchor fallback');
    assert.equal(on.subfolderApplied, true);
  });

  test('a prefix can never create a folder or a traversal', () => {
    for (const prefix of ['../../evil', 'a/b', '\\win', 'con']) {
      const result = buildFilename({ base: 'photo', ext: 'png', prefix });
      assert.ok(!result.filename.includes('/') && !result.filename.includes('\\'), `${prefix} -> ${result.filename}`);
    }
  });

  test('empty or hostile base falls back to "image"', () => {
    assert.equal(buildFilename({ base: '', ext: 'png' }).filename, 'image.png');
    assert.equal(buildFilename({ base: '///', ext: 'png' }).filename, 'image.png');
    assert.equal(buildFilename({ base: null, ext: 'png' }).filename, 'image.png');
    assert.equal(buildFilename({ base: 'CON', ext: 'png' }).filename, '_CON.png');
  });
});
