import test from 'node:test';
import assert from 'node:assert/strict';

// Pure logic extracted to match scripts/save-image-as-type/src/core/convert.js and filename.js
const MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  avif: 'image/avif',
};

function resolveFormatMime(format) {
  const norm = String(format).toLowerCase().trim();
  return MIME_TYPES[norm] || null;
}

function sanitizeFilename(name, fallback = 'image') {
  if (!name || typeof name !== 'string') return fallback;
  // Strip illegal Windows & POSIX characters, control chars, trailing dots/spaces
  let clean = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.+$/g, '')
    .trim();
  return clean || fallback;
}

function expandFilenameTemplate(template, vars = {}) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    return vars[key] !== undefined ? String(vars[key]) : `{${key}}`;
  });
}

function normalizeRotation(angle) {
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return normalized;
}

function clampQuality(quality, fallback = 0.92) {
  const num = Number(quality);
  if (Number.isNaN(num) || num < 0 || num > 1) return fallback;
  return Math.round(num * 100) / 100;
}

test('Format MIME resolver correctly maps standard image and document formats', () => {
  assert.equal(resolveFormatMime('png'), 'image/png');
  assert.equal(resolveFormatMime('jpg'), 'image/jpeg');
  assert.equal(resolveFormatMime('JPEG'), 'image/jpeg');
  assert.equal(resolveFormatMime('webp'), 'image/webp');
  assert.equal(resolveFormatMime('gif'), 'image/gif');
  assert.equal(resolveFormatMime('bmp'), 'image/bmp');
  assert.equal(resolveFormatMime('pdf'), 'application/pdf');
  assert.equal(resolveFormatMime('avif'), 'image/avif');
  assert.equal(resolveFormatMime('exe'), null);
});

test('Filename sanitizer removes path traversal and reserved characters across OS targets', () => {
  assert.equal(sanitizeFilename('normal_image'), 'normal_image');
  assert.equal(sanitizeFilename('image/../../etc/passwd'), 'image_.._.._etc_passwd');
  assert.equal(sanitizeFilename('photo:version<1>?.jpg'), 'photo_version_1__.jpg');
  assert.equal(sanitizeFilename('   trailing dots...   '), 'trailing dots');
  assert.equal(sanitizeFilename('', 'fallback_name'), 'fallback_name');
});

test('Filename template expansion replaces standard variables safely', () => {
  const tpl = '{prefix}_{origin}_{title}_{w}x{h}.{ext}';
  const vars = {
    prefix: 'capture',
    origin: 'example.com',
    title: 'hero-banner',
    w: 1920,
    h: 1080,
    ext: 'webp'
  };
  const result = expandFilenameTemplate(tpl, vars);
  assert.equal(result, 'capture_example.com_hero-banner_1920x1080.webp');
});

test('Rotation normalization snaps angles to valid 90-degree increments in [0, 270]', () => {
  assert.equal(normalizeRotation(0), 0);
  assert.equal(normalizeRotation(90), 90);
  assert.equal(normalizeRotation(180), 180);
  assert.equal(normalizeRotation(270), 270);
  assert.equal(normalizeRotation(360), 0);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(-90), 270);
});

test('Quality clamp limits values to [0.0, 1.0] with sensible fallback', () => {
  assert.equal(clampQuality(0.85), 0.85);
  assert.equal(clampQuality(1.0), 1.0);
  assert.equal(clampQuality(0.0), 0.0);
  assert.equal(clampQuality(1.5), 0.92);
  assert.equal(clampQuality(-0.2), 0.92);
  assert.equal(clampQuality('invalid'), 0.92);
});
