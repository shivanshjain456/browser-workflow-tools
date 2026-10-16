import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeZip, estimateZipSize, crc32, dosDateTime, sanitizeEntryName, ZIP_LIMITS } from '../../src/encoders/zip.js';
import { tempDir, writeFile, verifyZip, verifyMetadata, pythonAvailable } from '../helpers/harness.mjs';

/**
 * Feature: ZIP export.
 *
 * The archive is written by hand (store method), so the acceptance criterion is
 * external: Python's `zipfile` must open it, every member's CRC and size must
 * match, and Pillow must decode each member back to the pixels we put in. A
 * bug in our writer cannot be confirmed by a matching bug in our own reader.
 */

const FIXTURES = join(import.meta.dirname || new URL('.', import.meta.url).pathname, '..', 'fixtures');
const HAS_PYTHON = pythonAvailable();

const bytesOf = (name) => new Uint8Array(readFileSync(join(FIXTURES, name)));
const text = (value) => new Uint8Array(Buffer.from(value, 'utf8'));

let dir = null;
let sourceFacts = null;

before(() => {
  dir = tempDir('zip');
  if (HAS_PYTHON) {
    sourceFacts = verifyMetadata(FIXTURES, 'opaque.png');
  }
});

describe('zip — structure and primitives', () => {
  test('CRC-32 matches the published check values', () => {
    // The canonical CRC-32 (IEEE 802.3) check value for "123456789" is 0xCBF43926.
    assert.equal(crc32(text('123456789')), 0xcbf43926);
    assert.equal(crc32(text('')), 0);
    assert.equal(crc32(new Uint8Array([0, 0, 0, 0])), 0x2144df1c);
    assert.equal(crc32(text('a')), 0xe8b7be43);
  });

  test('DOS date/time encodes the documented fields and clamps impossible years', () => {
    const stamp = dosDateTime(new Date(2026, 9, 16, 14, 5, 8));
    assert.equal(stamp.date, ((2026 - 1980) << 9) | (10 << 5) | 16);
    assert.equal(stamp.time, (14 << 11) | (5 << 5) | 4, 'seconds are stored in 2-second units');

    const old = dosDateTime(new Date(1970, 0, 1, 0, 0, 0));
    assert.equal((old.date >> 9) + 1980, 1980, 'ZIP cannot represent 1970; the year is clamped, not wrapped');
    const future = dosDateTime(new Date(2500, 0, 1));
    assert.equal((future.date >> 9) + 1980, 2107, 'and clamped at the top of the field');
    const junk = dosDateTime(new Date('nonsense'));
    assert.ok(junk.date > 0 && junk.time >= 0, 'an invalid date still produces a usable stamp');
    assert.ok(dosDateTime(null).date > 0);
  });

  test('entry names cannot escape the extraction directory (zip-slip)', () => {
    const cases = [
      ['../../etc/passwd', 'etc/passwd'],
      ['/absolute/path.png', 'absolute/path.png'],
      ['C:\\Windows\\system.png', 'Windows/system.png'],
      ['..\\..\\evil.png', 'evil.png'],
      ['a/./b.png', 'a/b.png'],
      ['a//b.png', 'a/b.png'],
      ['  spaced  .png', 'spaced .png'],
    ];
    for (const [input, expected] of cases) {
      const result = sanitizeEntryName(input);
      assert.equal(result.name, expected, `${input} → ${result.name}`);
      assert.equal(result.name.split('/').some((part) => part === '..' || part === '.' || part === ''), false, 'no traversal segment');
      assert.equal(result.name.startsWith('/'), false, 'never absolute');
    }
    assert.equal(sanitizeEntryName('').name, 'image', 'an empty name still produces something');
    assert.equal(sanitizeEntryName(null).name, 'image');
    assert.equal(sanitizeEntryName('...').name, 'image');
    assert.equal(sanitizeEntryName('photo.png').changed, false, 'an ordinary name is left alone');
    assert.equal(sanitizeEntryName('../../x.png').changed, true, 'a repaired name is reported as changed');
  });

  test('a long name is truncated on a byte boundary, not mid-character', () => {
    const long = `${'n'.repeat(300)}.png`;
    const result = sanitizeEntryName(long);
    assert.ok(Buffer.byteLength(result.name, 'utf8') <= ZIP_LIMITS.maxNameBytes, `byte length ${Buffer.byteLength(result.name, 'utf8')}`);
    const utf8 = sanitizeEntryName(`${'я'.repeat(200)}.png`);
    assert.ok(Buffer.byteLength(utf8.name, 'utf8') <= ZIP_LIMITS.maxNameBytes);
    assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(text(utf8.name)).length > 0, true, 'still valid UTF-8');
  });

  test('the size estimate is close to the archive that is actually built', () => {
    const entries = [
      { name: 'a.png', bytes: new Uint8Array(1000) },
      { name: 'folder/b.png', bytes: new Uint8Array(2500) },
    ];
    const estimate = estimateZipSize(entries);
    const built = encodeZip(entries);
    const drift = Math.abs(estimate - built.bytes.length) / built.bytes.length;
    assert.ok(drift < 0.05, `estimate ${estimate} vs actual ${built.bytes.length} (${(drift * 100).toFixed(1)}% off)`);
    assert.equal(estimateZipSize([]), 22, 'an empty list estimates just the EOCD');
    assert.equal(estimateZipSize(null), 22);
  });

  test('junk input is refused with a code, not a corrupt archive', () => {
    assert.throws(() => encodeZip([]), (err) => err.code === 'zip-empty');
    assert.throws(() => encodeZip(null), (err) => err.code === 'zip-empty');
    const duplicates = encodeZip([
      { name: 'same.png', bytes: text('one') },
      { name: 'same.png', bytes: text('two') },
    ]);
    assert.equal(duplicates.entries.length, 2, 'by default a collision is renamed, not lost');
    assert.ok(duplicates.notes.some((note) => /renamed/i.test(note)), `notes: ${duplicates.notes.join(' | ')}`);
    assert.throws(
      () => encodeZip([{ name: 'same.png', bytes: text('one') }, { name: 'same.png', bytes: text('two') }], { dedupe: false }),
      (err) => err.code === 'zip-duplicate',
      'the caller can insist on uniqueness instead',
    );
  });

  test('an entry with no bytes is skipped with a note rather than archived empty', () => {
    const built = encodeZip([
      { name: 'good.png', bytes: text('data') },
      { name: 'empty.png', bytes: new Uint8Array(0) },
      null,
      { name: 'null.png' },
    ]);
    assert.equal(built.entries.length, 1);
    assert.ok(built.notes.some((note) => /no bytes/.test(note)), built.notes.join(' | '));
  });

  test('byte-ish inputs (ArrayBuffer, plain array) are all accepted', () => {
    const built = encodeZip([
      { name: 'u8.png', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'ab.png', bytes: new Uint8Array([4, 5, 6]).buffer },
      { name: 'arr.png', bytes: [7, 8, 9] },
    ]);
    assert.deepEqual(built.entries.map((entry) => entry.size), [3, 3, 3]);
  });

  test('the entry cap is enforced and reported', () => {
    const many = Array.from({ length: ZIP_LIMITS.maxEntries + 5 }, (_, i) => ({ name: `img-${i}.png`, bytes: new Uint8Array(4) }));
    const built = encodeZip(many);
    assert.equal(built.entries.length, ZIP_LIMITS.maxEntries, 'the archive stops at the cap');
    assert.ok(built.notes.some((note) => /Stopped at/.test(note)), 'and says so');
  });
});

describe('zip — verified by Python zipfile and Pillow', { skip: HAS_PYTHON ? false : 'python3 + Pillow are unavailable in this environment' }, () => {
  test('a real archive opens, and every member decodes to the pixels we stored', () => {
    const png = bytesOf('opaque.png');
    const photo = bytesOf('photo.jpg');
    const webp = bytesOf('still.webp');
    const built = encodeZip(
      [
        { name: 'opaque.png', bytes: png },
        { name: 'sub folder/photo.jpg', bytes: photo },
        { name: 'still.webp', bytes: webp, mtime: new Date(2026, 4, 1, 12, 0, 0) },
      ],
      { comment: 'Created by Save Image as Type 2.0.0' },
    );
    writeFile(dir, 'batch.zip', built.bytes);

    const report = verifyZip(dir, 'batch.zip');
    assert.deepEqual(report.errors, []);
    const archive = report.archives[0];
    assert.equal(archive.testzip, null, 'zipfile.testzip() found no CRC error');
    assert.equal(archive.comment, 'Created by Save Image as Type 2.0.0');
    assert.equal(archive.member_count, 3);
    assert.deepEqual(archive.members.map((member) => member.name), ['opaque.png', 'sub folder/photo.jpg', 'still.webp']);

    for (const member of archive.members) {
      assert.equal(member.crc_matches, true, `${member.name}: CRC matches an independent zlib.crc32`);
      assert.equal(member.compress_type, 0, `${member.name}: stored, not deflated (the payloads are already compressed)`);
      assert.ok(member.decoded, `${member.name}: Pillow decoded the member`);
    }
    const pngMember = archive.members[0];
    assert.equal(pngMember.size, png.length, 'the member size is the payload size');
    assert.equal(pngMember.bytes_read, png.length);
    assert.equal(pngMember.decoded.format, 'PNG');
    const jpgMember = archive.members[1];
    assert.equal(jpgMember.decoded.format, 'JPEG');
    assert.equal(archive.members[2].decoded.format, 'WEBP');

    // The pixels inside the archive are the pixels of the source fixture.
    const original = sourceFacts.images.find((image) => image.name === 'opaque.png');
    assert.ok(original, 'the source fixture was measured too');
    assert.equal(pngMember.decoded.pixel_sha256, original.pixel_sha256, 'the archived PNG decodes to the same pixels');
  });

  test('non-ASCII names survive the round-trip', () => {
    const built = encodeZip([
      { name: 'фото-赤い狐.png', bytes: bytesOf('tiny.png') },
      { name: 'naïve café.png', bytes: bytesOf('tiny.png') },
    ]);
    writeFile(dir, 'utf8.zip', built.bytes);
    const archive = verifyZip(dir, 'utf8.zip').archives[0];
    assert.equal(archive.testzip, null);
    assert.deepEqual(archive.members.map((member) => member.name), ['фото-赤い狐.png', 'naïve café.png'], 'the UTF-8 flag made the names readable');
    assert.ok(archive.members.every((member) => member.decoded && member.decoded.format === 'PNG'));
  });

  test('duplicate names are both kept, under distinct names', () => {
    const first = bytesOf('opaque.png');
    const second = bytesOf('transparent.png');
    const built = encodeZip([
      { name: 'image.png', bytes: first },
      { name: 'image.png', bytes: second },
    ]);
    writeFile(dir, 'dupes.zip', built.bytes);
    const archive = verifyZip(dir, 'dupes.zip').archives[0];
    assert.equal(archive.member_count, 2);
    assert.equal(new Set(archive.members.map((member) => member.name)).size, 2, 'no member overwrote another');
    assert.equal(archive.testzip, null);
    const sizes = archive.members.map((member) => member.size).sort((a, b) => a - b);
    assert.deepEqual(sizes, [first.length, second.length].sort((a, b) => a - b), 'both payloads are intact');
  });

  test('a hostile name is repaired before it reaches the archive', () => {
    const built = encodeZip([{ name: '../../escape.png', bytes: bytesOf('tiny.png') }]);
    writeFile(dir, 'hostile.zip', built.bytes);
    const archive = verifyZip(dir, 'hostile.zip').archives[0];
    assert.equal(archive.member_count, 1);
    const name = archive.members[0].name;
    assert.equal(name.includes('..'), false, `the stored name is "${name}"`);
    assert.equal(name.startsWith('/'), false);
    assert.ok(built.notes.some((note) => /Renamed/.test(note)), 'the rename is reported');
  });

  test('an archive of 300 members (a realistic batch) is valid', () => {
    const payload = bytesOf('tiny.png');
    const entries = Array.from({ length: 300 }, (_, i) => ({ name: `page-image-${String(i + 1).padStart(3, '0')}.png`, bytes: payload }));
    const built = encodeZip(entries, { comment: 'batch of 300' });
    writeFile(dir, 'big.zip', built.bytes);
    const archive = verifyZip(dir, 'big.zip').archives[0];
    assert.equal(archive.testzip, null);
    assert.equal(archive.member_count, 300);
    assert.equal(new Set(archive.members.map((member) => member.name)).size, 300, 'every name is distinct');
    assert.ok(archive.members.every((member) => member.crc_matches), 'every CRC checks out');
    assert.ok(archive.size < payload.length * 300 + 300 * 120, 'store-method overhead stays small');
  });
});
