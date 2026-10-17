#!/usr/bin/env node
/**
 * Proves that two builds differ only in the metadata block and the version token.
 * Usage: node tools/prove-delta.mjs <old.user.js> <new.user.js> <oldVersion> <newVersion>
 * Exits 0 when the "runtime body" is byte-identical after normalization.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [oldPath, newPath, oldVersion, newVersion] = process.argv.slice(2);
if (!oldPath || !newPath || !oldVersion || !newVersion) {
  console.error('usage: node tools/prove-delta.mjs <old> <new> <oldVersion> <newVersion>');
  process.exit(2);
}
const strip = (text, version) => {
  const end = text.indexOf('// ==/UserScript==');
  if (end < 0) throw new Error('no metadata block');
  return text
    .slice(end + '// ==/UserScript=='.length)
    .split(` * version ${version}`).join(' * version <VERSION>')
    .split(`SCRIPT_VERSION_REPORTED = '${version}'`).join("SCRIPT_VERSION_REPORTED = '<VERSION>'");
};
const a = strip(readFileSync(oldPath, 'utf8'), oldVersion);
const b = strip(readFileSync(newPath, 'utf8'), newVersion);
const hash = (value) => createHash('sha256').update(value).digest('hex');
console.log(`old body sha256: ${hash(a)}`);
console.log(`new body sha256: ${hash(b)}`);
if (a !== b) {
  console.error('FAIL: runtime body changed; behavior must be re-verified end to end.');
  process.exit(1);
}
console.log('PASS: runtime body identical; only metadata and version differ.');
