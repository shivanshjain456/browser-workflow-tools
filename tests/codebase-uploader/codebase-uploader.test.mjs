import test from 'node:test';
import assert from 'node:assert/strict';

// Pure logic under test matching codebase-uploader.user.js
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'zip', 'tar', 'gz', 'wasm',
  'exe', 'dll', 'so', 'dylib', 'bin', 'iso', 'woff', 'woff2', 'ttf', 'eot', 'mp3', 'mp4'
]);

const SECRET_PATTERNS = [
  /^\.env(?:\..*)?$/i,
  /^id_rsa(?:|\.pub)$/i,
  /\.pem$/i,
  /\.key$/i,
  /^secrets?\.(?:json|ya?ml)$/i
];

function isBinaryFile(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = filename.slice(dot + 1).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function isSecretFile(filename) {
  const base = filename.split('/').pop();
  return SECRET_PATTERNS.some(pat => pat.test(base));
}

function normalizePath(rawPath) {
  // Defensive path normalization preventing traversal outside directory root
  const parts = rawPath.replace(/\\/g, '/').split('/');
  const safe = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (safe.length > 0) safe.pop();
      continue;
    }
    safe.push(part);
  }
  return safe.join('/');
}

function estimateTokens(text) {
  // Approximate conservative token estimate (~4 chars per token for code)
  return Math.ceil(text.length / 4);
}

function matchIgnore(filePath, rules) {
  const isDir = filePath.endsWith('/');
  const cleanPath = filePath.replace(/^\/+/, '');

  for (const rule of rules) {
    if (!rule || rule.startsWith('#')) continue;
    let pattern = rule.trim();
    const isNegation = pattern.startsWith('!');
    if (isNegation) pattern = pattern.slice(1);

    const dirOnly = pattern.endsWith('/');
    if (dirOnly) pattern = pattern.slice(0, -1);

    if (dirOnly && !isDir && !cleanPath.includes('/')) continue;

    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1);
      if (cleanPath.endsWith(ext)) return !isNegation;
    } else if (cleanPath === pattern || cleanPath.startsWith(pattern + '/')) {
      return !isNegation;
    }
  }
  return false;
}

test('Binary extension classification distinguishes code from binary assets', () => {
  assert.equal(isBinaryFile('index.js'), false);
  assert.equal(isBinaryFile('styles.css'), false);
  assert.equal(isBinaryFile('README.md'), false);
  assert.equal(isBinaryFile('logo.png'), true);
  assert.equal(isBinaryFile('archive.zip'), true);
  assert.equal(isBinaryFile('app.wasm'), true);
});

test('Secret file policy flags sensitive credential files', () => {
  assert.equal(isSecretFile('.env'), true);
  assert.equal(isSecretFile('.env.production'), true);
  assert.equal(isSecretFile('id_rsa'), true);
  assert.equal(isSecretFile('server.pem'), true);
  assert.equal(isSecretFile('secrets.json'), true);
  assert.equal(isSecretFile('package.json'), false);
  assert.equal(isSecretFile('main.go'), false);
});

test('Path normalization strictly strips path traversal sequences', () => {
  assert.equal(normalizePath('src/../secret.txt'), 'secret.txt');
  assert.equal(normalizePath('../../../etc/passwd'), 'etc/passwd');
  assert.equal(normalizePath('components/Button/./index.tsx'), 'components/Button/index.tsx');
  assert.equal(normalizePath('app\\views\\layout.html'), 'app/views/layout.html');
});

test('Token estimation scales predictably with codebase byte volume', () => {
  const shortSnippet = 'function add(a, b) { return a + b; }';
  assert.ok(estimateTokens(shortSnippet) > 0);
  assert.equal(estimateTokens('a'.repeat(400)), 100);
});

test('Gitignore matcher respects directory patterns, wildcards, and ignores', () => {
  const rules = [
    'node_modules/',
    '*.pyc',
    'dist/',
    '.env'
  ];
  assert.equal(matchIgnore('node_modules/express/index.js', rules), true);
  assert.equal(matchIgnore('src/app.pyc', rules), true);
  assert.equal(matchIgnore('src/index.ts', rules), false);
  assert.equal(matchIgnore('.env', rules), true);
});
