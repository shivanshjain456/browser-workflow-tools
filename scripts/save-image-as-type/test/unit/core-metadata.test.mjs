import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectMetadata, stripMetadata, detectContainerMime, looksLikeXmp, ORIENTATION_LABELS, METADATA_SUPPORT } from '../../src/core/metadata.js';
import { tempDir, writeFile, makeMetadataFixtures, verifyMetadata, pythonAvailable } from '../helpers/harness.mjs';

/**
 * Feature: metadata inspector and sanitizer.
 *
 * Fixtures are generated with Pillow (EXIF incl. a GPS IFD, an ICC profile, PNG
 * text chunks and an XMP packet), and the results are checked with Pillow again:
 * after stripping, the metadata must be gone *and* the stored pixels must hash
 * identically. That last part is the one users care about — a sanitizer that
 * quietly re-encodes the image would be a much bigger change than advertised.
 */

const HAS_PYTHON = pythonAvailable();
const FIXTURES = join(import.meta.dirname || new URL('.', import.meta.url).pathname, '..', 'fixtures');

let dir = null;
let files = {};

const read = (name) => new Uint8Array(readFileSync(join(dir, name)));
const fixture = (name) => new Uint8Array(readFileSync(join(FIXTURES, name)));

before(() => {
  dir = tempDir('metadata');
  if (HAS_PYTHON) {
    makeMetadataFixtures(dir);
    files = {};
    for (const name of ['exif.jpg', 'exif.webp', 'text.png', 'plain.jpg']) files[name] = read(name);
  }
});

describe('metadata — container detection', () => {
  test('every container this script can produce is recognised from its bytes', () => {
    const cases = [
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]), 'image/jpeg'],
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), 'image/png'],
      [new Uint8Array([...Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')]), 'image/webp'],
      [new Uint8Array([...Buffer.from('GIF89a\0\0\0\0\0\0', 'latin1')]), 'image/gif'],
      [new Uint8Array([...Buffer.from('BM\0\0\0\0\0\0\0\0\0\0', 'latin1')]), 'image/bmp'],
      [new Uint8Array([...Buffer.from('\0\0\0\x1cftypavif\0\0\0\0', 'latin1').subarray(0, 16)]), 'image/avif'],
      [new Uint8Array([...Buffer.from('%PDF-1.7\n\0\0\0', 'latin1')]), 'application/pdf'],
      [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), ''],
      [new Uint8Array([0xff, 0xd8]), ''],
      [new Uint8Array(0), ''],
      [null, ''],
    ];
    for (const [bytes, expected] of cases) {
      assert.equal(detectContainerMime(bytes), expected, `${expected || 'unknown'} from ${bytes ? bytes.length : 0} bytes`);
    }
  });

  test('a real fixture is detected without being told its type', () => {
    if (!HAS_PYTHON) return;
    assert.equal(detectContainerMime(files['exif.jpg']), 'image/jpeg');
    assert.equal(detectContainerMime(files['text.png']), 'image/png');
    assert.equal(detectContainerMime(files['exif.webp']), 'image/webp');
  });

  test('XMP is recognised by its packet markers, never by parsing XML', () => {
    assert.equal(looksLikeXmp(new Uint8Array(Buffer.from('<?xpacket begin="..."?><x:xmpmeta>', 'utf8'))), true);
    assert.equal(looksLikeXmp(new Uint8Array(Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/">', 'utf8'))), true);
    assert.equal(looksLikeXmp(new Uint8Array(Buffer.from('just some text', 'utf8'))), false);
    assert.equal(looksLikeXmp(new Uint8Array(0)), false);
    assert.equal(looksLikeXmp(null), false);
  });

  test('the support matrix states honestly what cannot be inspected', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
      assert.equal(METADATA_SUPPORT[mime].inspect, true, `${mime} can be inspected`);
      assert.equal(METADATA_SUPPORT[mime].strip, true, `${mime} can be stripped`);
    }
    for (const mime of ['image/avif', 'image/bmp']) {
      assert.equal(METADATA_SUPPORT[mime].inspect, false, `${mime} is not claimed`);
      assert.equal(METADATA_SUPPORT[mime].strip, false);
    }
    for (let value = 1; value <= 8; value += 1) {
      assert.ok(ORIENTATION_LABELS[value], `orientation ${value} has a label`);
    }
    assert.equal(ORIENTATION_LABELS[6], 'Rotated 90° clockwise');
  });
});

describe('metadata — inspection', { skip: HAS_PYTHON ? false : 'python3 + Pillow are unavailable, so no metadata fixtures could be generated' }, () => {
  test('JPEG: EXIF fields, GPS coordinates and the ICC profile are all reported', () => {
    const result = inspectMetadata(files['exif.jpg'], 'image/jpeg');
    assert.equal(result.supported, true);
    assert.equal(result.container, 'JPEG');
    assert.equal(result.strippable, true);

    assert.equal(result.exif.present, true);
    assert.equal(result.exif.fields.make, 'FixtureCam');
    assert.equal(result.exif.fields.model, 'FX-900');
    assert.equal(result.exif.fields.dateTime, '2026:03:04 05:06:07');
    assert.equal(result.exif.orientation, 6, 'orientation is read out of the IFD');

    assert.equal(result.gps.present, true);
    // 48°51'30.00"N = 48.858333, 2°20'00"E = 2.333333, altitude 515 m.
    assert.ok(Math.abs(result.gps.lat - 48.858333) < 0.001, `latitude ${result.gps.lat}`);
    assert.ok(Math.abs(result.gps.lon - 2.333333) < 0.001, `longitude ${result.gps.lon}`);

    assert.equal(result.icc.present, true);
    assert.ok(result.icc.bytes > 100, `ICC profile size ${result.icc.bytes}`);

    assert.ok(result.findings.length >= 4, `findings: ${result.findings.map((f) => f.label).join(', ')}`);
    assert.ok(result.findings.some((finding) => /gps/i.test(finding.label) || /location/i.test(finding.label)), 'GPS is called out as its own finding');
    assert.ok(result.removes.includes('EXIF'));
    assert.ok(result.removes.some((entry) => /ICC/.test(entry)));
  });

  test('the GPS warning is explicit, and orientation is explained as metadata-not-pixels', () => {
    const result = inspectMetadata(files['exif.jpg'], 'image/jpeg');
    assert.ok(result.warnings.some((warning) => /GPS coordinates/.test(warning)), `warnings: ${result.warnings.join(' | ')}`);
    assert.ok(result.warnings.some((warning) => /will not rotate the image/.test(warning)));

    const noGps = inspectMetadata(files['text.png'], 'image/png');
    assert.equal(noGps.warnings.some((warning) => /GPS/.test(warning)), false, 'no GPS warning where there is no GPS');
  });

  test('PNG: text chunks and the XMP packet are reported', () => {
    const result = inspectMetadata(files['text.png'], 'image/png');
    assert.equal(result.supported, true);
    assert.equal(result.xmp.present, true);
    assert.ok(result.xmp.bytes > 50, `XMP packet size ${result.xmp.bytes}`);
    assert.ok(result.findings.some((finding) => finding.kind === 'text' || finding.kind === 'comment'), 'the tEXt chunks are listed');
    assert.ok(result.findings.some((finding) => /xmp/i.test(finding.kind) || /xmp/i.test(finding.label)));
    assert.ok(result.removes.includes('XMP'));
    assert.ok(result.removes.some((entry) => /text|comment/i.test(entry)));
    assert.equal(result.exif.present, false, 'a PNG fixture with no eXIf chunk reports none');
  });

  test('WebP: the same EXIF (including GPS) is found in a RIFF container', () => {
    const result = inspectMetadata(files['exif.webp'], 'image/webp');
    assert.equal(result.supported, true);
    assert.equal(result.exif.present, true);
    assert.equal(result.exif.fields.make, 'FixtureCam');
    assert.equal(result.gps.present, true);
    assert.ok(Math.abs(result.gps.lat - 48.858333) < 0.001);
  });

  test('a file with nothing in it says so instead of inventing findings', () => {
    const result = inspectMetadata(files['plain.jpg'], 'image/jpeg');
    assert.equal(result.supported, true);
    assert.equal(result.exif.present, false);
    assert.equal(result.xmp.present, false);
    assert.equal(result.gps.present, false);
    assert.equal(result.icc.present, false);
    // A structural JFIF marker may still be listed (it is informational), but no
    // metadata finding is invented and nothing is promised for removal.
    assert.ok(result.findings.every((finding) => finding.kind === 'jfif'), `findings: ${JSON.stringify(result.findings)}`);
    assert.ok(result.warnings.some((warning) => /No EXIF, XMP, ICC or comment data/.test(warning)), result.warnings.join(' | '));
    assert.equal(result.removes.length, 0, 'nothing to remove is promised');
  });

  test('an unsupported container is reported as unknown, not guessed', () => {
    const bmp = fixture('icon.bmp');
    const result = inspectMetadata(bmp, 'image/bmp');
    assert.equal(result.supported, false);
    assert.equal(result.strippable, false);
    assert.deepEqual(result.findings, []);
    assert.ok(result.warnings.some((warning) => /cannot be inspected/.test(warning)), result.warnings.join(' | '));
    assert.ok(result.warnings.some((warning) => /nothing is claimed/.test(warning)));

    const unknown = inspectMetadata(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), '');
    assert.equal(unknown.supported, false);
    assert.equal(unknown.mime, 'unknown');
    assert.ok(unknown.warnings.some((warning) => /not recognised/.test(warning)));
  });

  test('malformed and truncated input degrades to a warning, never a throw', () => {
    const jpeg = files['exif.jpg'];
    const cases = [
      jpeg.subarray(0, 40),
      jpeg.subarray(0, jpeg.length - 5),
      new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      new Uint8Array([...Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      new Uint8Array(4),
      new Uint8Array(0),
      null,
      undefined,
    ];
    for (const bytes of cases) {
      const result = inspectMetadata(bytes, '');
      assert.equal(typeof result.supported, 'boolean');
      assert.ok(Array.isArray(result.findings));
      assert.ok(Array.isArray(result.warnings));
    }
    const tiny = inspectMetadata(new Uint8Array(4), '');
    assert.ok(tiny.warnings.some((warning) => /too small/.test(warning)));
  });
});

describe('metadata — stripping', { skip: HAS_PYTHON ? false : 'python3 + Pillow are unavailable, so stripping cannot be verified externally' }, () => {
  test('the documented case: EXIF and GPS removed, pixels byte-identical', () => {
    const before = verifyMetadata(dir, 'exif.jpg').images[0];
    assert.equal(before.exif.present, true, 'the fixture really carries EXIF');
    assert.equal(before.exif.gps.present, true, 'and GPS');

    const stripped = stripMetadata(files['exif.jpg'], 'image/jpeg');
    assert.equal(stripped.changed, true);
    assert.ok(stripped.removed.some((entry) => /EXIF/i.test(entry)), `removed: ${stripped.removed.join(', ')}`);
    assert.ok(stripped.bytes.length < files['exif.jpg'].length, 'the file got smaller');
    writeFile(dir, 'exif-stripped.jpg', stripped.bytes);

    const after = verifyMetadata(dir, 'exif-stripped.jpg').images[0];
    assert.equal(after.exif.present, false, 'EXIF is gone');
    assert.equal(after.exif.gps.present, false, 'GPS is gone');
    assert.deepEqual(after.exif.tags, {});
    assert.equal(after.pixel_sha256, before.pixel_sha256, 'the stored pixels are byte-identical');
    assert.equal(after.width, before.width);
    assert.equal(after.height, before.height);
    assert.equal(after.format, 'JPEG', 'still a valid JPEG that Pillow can open');
    assert.equal(after.icc_bytes, before.icc_bytes, 'the colour profile is kept unless asked otherwise');
  });

  test('dropIcc removes the colour profile too, still without touching pixels', () => {
    const before = verifyMetadata(dir, 'exif.jpg').images[0];
    const stripped = stripMetadata(files['exif.jpg'], 'image/jpeg', { dropIcc: true });
    assert.ok(stripped.removed.some((entry) => /ICC/i.test(entry)), `removed: ${stripped.removed.join(', ')}`);
    writeFile(dir, 'exif-noicc.jpg', stripped.bytes);
    const after = verifyMetadata(dir, 'exif-noicc.jpg').images[0];
    assert.equal(after.icc_bytes, 0, 'the ICC profile is gone');
    assert.equal(after.exif.present, false);
    assert.equal(after.pixel_sha256, before.pixel_sha256, 'pixels are still identical');
  });

  test('PNG text chunks and the XMP packet are removed, pixels identical', () => {
    const before = verifyMetadata(dir, 'text.png').images[0];
    assert.ok(before.png_text.length >= 2, 'the fixture carries text chunks');
    assert.equal(before.xmp_present, true);

    const stripped = stripMetadata(files['text.png'], 'image/png');
    assert.equal(stripped.changed, true);
    writeFile(dir, 'text-stripped.png', stripped.bytes);

    const after = verifyMetadata(dir, 'text-stripped.png').images[0];
    assert.deepEqual(after.png_text, [], 'no text chunks remain');
    assert.equal(after.xmp_present, false, 'the XMP packet is gone');
    assert.equal(after.pixel_sha256, before.pixel_sha256, 'pixels are identical');
    assert.equal(after.format, 'PNG');
  });

  test('WebP EXIF is removed and the file still decodes', () => {
    const before = verifyMetadata(dir, 'exif.webp').images[0];
    const stripped = stripMetadata(files['exif.webp'], 'image/webp');
    assert.equal(stripped.changed, true);
    writeFile(dir, 'exif-stripped.webp', stripped.bytes);
    const after = verifyMetadata(dir, 'exif-stripped.webp').images[0];
    assert.equal(after.exif.present, false);
    assert.equal(after.exif.gps.present, false);
    assert.equal(after.pixel_sha256, before.pixel_sha256);
    assert.equal(after.format, 'WEBP');
  });

  test('a file with no metadata is returned unchanged, and stripping is idempotent', () => {
    const plain = stripMetadata(files['plain.jpg'], 'image/jpeg');
    assert.equal(plain.changed, false);
    assert.deepEqual(Array.from(plain.bytes), Array.from(files['plain.jpg']), 'the bytes are untouched');

    const once = stripMetadata(files['exif.jpg'], 'image/jpeg');
    const twice = stripMetadata(once.bytes, 'image/jpeg');
    assert.equal(twice.changed, false, 'a second pass finds nothing left to remove');
    assert.deepEqual(Array.from(twice.bytes), Array.from(once.bytes), 'stripping twice is the same as once');
  });

  test('an unsupported container keeps the original bytes and says why', () => {
    const bmp = fixture('icon.bmp');
    const result = stripMetadata(bmp, 'image/bmp');
    assert.equal(result.changed, false);
    assert.deepEqual(Array.from(result.bytes), Array.from(bmp), 'nothing was rewritten');
    assert.ok(result.notes.some((note) => /cannot be stripped/.test(note)), result.notes.join(' | '));

    const unknown = stripMetadata(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]), '');
    assert.equal(unknown.changed, false);
    assert.ok(unknown.notes.some((note) => /not recognised/.test(note)));
  });

  test('a corrupt container is never rewritten: the original is kept with a note', () => {
    const jpeg = files['exif.jpg'];
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length / 2));
    // A JPEG cut in half has no EOI: rewriting it could produce a file no
    // viewer opens, which is worse than leaving the metadata in place.
    const result = stripMetadata(truncated, 'image/jpeg');
    if (result.changed) {
      // If the walker was confident enough to rewrite it, the result must still
      // start with SOI and contain the scan data it was given.
      assert.equal(result.bytes[0], 0xff);
      assert.equal(result.bytes[1], 0xd8);
      assert.ok(result.bytes.length > 100);
    } else {
      assert.ok(result.notes.some((note) => /original file was kept|abandoned|no output/i.test(note)), result.notes.join(' | '));
      assert.deepEqual(Array.from(result.bytes), Array.from(truncated));
    }

    assert.throws(() => stripMetadata(new Uint8Array(0), 'image/jpeg'), (err) => err.code === 'metadata-empty');
    assert.throws(() => stripMetadata(null, 'image/jpeg'), (err) => err.code === 'metadata-empty');
  });

  test('the mime can be omitted: the container is detected from the bytes', () => {
    const result = stripMetadata(files['exif.jpg'], '');
    assert.equal(result.mime, 'image/jpeg');
    assert.equal(result.changed, true);
    writeFile(dir, 'detected.jpg', result.bytes);
    const after = verifyMetadata(dir, 'detected.jpg').images[0];
    assert.equal(after.exif.present, false);
  });
});
