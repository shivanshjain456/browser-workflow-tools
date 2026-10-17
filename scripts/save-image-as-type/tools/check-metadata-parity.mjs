#!/usr/bin/env node
/** Asserts that the built artifact's metadata block equals renderMetadata(META). */
import { readFileSync } from 'node:fs';
import { META, renderMetadata } from '../src/meta.js';

const artifact = readFileSync(new URL('../release/save-image-as-type.user.js', import.meta.url), 'utf8');
const expected = renderMetadata(META);
if (!artifact.startsWith(expected)) {
  console.error('FAIL: artifact metadata block differs from renderMetadata(META)');
  console.error('--- expected ---\n' + expected);
  process.exit(1);
}
console.log('PASS: artifact metadata block is exactly renderMetadata(META)');
