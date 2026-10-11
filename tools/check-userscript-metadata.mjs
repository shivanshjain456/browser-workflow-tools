#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const SCRIPTS_DIR = path.resolve('scripts');
const REQUIRED_FIELDS = [
  'name',
  'namespace',
  'version',
  'description',
  'author',
  'license',
  'homepageURL',
  'supportURL',
  'downloadURL',
  'updateURL',
  'run-at'
];

const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;
const EXPECTED_AUTHOR = 'Shivansh Jain';
const CANONICAL_REPO_URL = 'https://github.com/shivanshjain456/browser-workflow-tools';
const CANONICAL_RAW_URL = 'https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main';

function parseMetadata(content, filePath) {
  const match = content.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/);
  if (!match) {
    throw new Error(`Missing metadata block in ${filePath}`);
  }

  const lines = match[1].split('\n');
  const metadata = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const directiveMatch = line.match(/^\/\/\s*@([a-zA-Z0-9_-]+)(?:\s+(.*))?$/);
    if (directiveMatch) {
      const key = directiveMatch[1];
      const val = (directiveMatch[2] || '').trim();
      if (!metadata[key]) {
        metadata[key] = [];
      }
      metadata[key].push(val);
    }
  }
  return metadata;
}

function validateScript(folderName) {
  const scriptPath = path.join(SCRIPTS_DIR, folderName, `${folderName}.user.js`);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script file not found: ${scriptPath}`);
  }

  const content = fs.readFileSync(scriptPath, 'utf8');

  // Check SPDX header
  if (!content.includes('SPDX-License-Identifier:')) {
    throw new Error(`Missing SPDX license identifier in ${scriptPath}`);
  }

  const meta = parseMetadata(content, scriptPath);
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (!meta[field] || meta[field].length === 0 || !meta[field][0]) {
      errors.push(`Missing required field @${field}`);
    }
  }

  if (meta.version && !SEMVER_REGEX.test(meta.version[0])) {
    errors.push(`Invalid version format '${meta.version[0]}' (expected semver X.Y.Z)`);
  }

  if (meta.author && meta.author[0] !== EXPECTED_AUTHOR) {
    errors.push(`Unexpected author '${meta.author[0]}' (expected '${EXPECTED_AUTHOR}')`);
  }

  if (meta.namespace && !meta.namespace[0].startsWith(CANONICAL_REPO_URL)) {
    errors.push(`Namespace '${meta.namespace[0]}' does not start with '${CANONICAL_REPO_URL}'`);
  }

  if (meta.downloadURL && !meta.downloadURL[0].startsWith(CANONICAL_RAW_URL)) {
    errors.push(`downloadURL '${meta.downloadURL[0]}' does not point to canonical raw release`);
  }

  if (meta.updateURL && !meta.updateURL[0].startsWith(CANONICAL_RAW_URL)) {
    errors.push(`updateURL '${meta.updateURL[0]}' does not point to canonical raw release`);
  }

  if (!meta.match && !meta.include) {
    errors.push('No @match or @include pattern specified');
  }

  if (errors.length > 0) {
    throw new Error(`Validation failed for ${folderName}:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    folderName,
    name: meta.name[0],
    namespace: meta.namespace[0],
    version: meta.version[0],
    license: meta.license[0],
    grants: meta.grant || [],
    connects: meta.connect || [],
    matches: meta.match || []
  };
}

function main() {
  const folders = fs.readdirSync(SCRIPTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  console.log(`Auditing userscript metadata for ${folders.length} scripts...`);
  const seenNamespaces = new Set();
  const results = [];

  for (const folder of folders) {
    const info = validateScript(folder);
    if (seenNamespaces.has(info.namespace)) {
      throw new Error(`Duplicate namespace detected: '${info.namespace}' in script '${folder}'`);
    }
    seenNamespaces.add(info.namespace);
    results.push(info);
    console.log(`  ✓ ${info.name} (v${info.version}) [@namespace: ${info.namespace}]`);
  }

  console.log('\nAll userscript metadata headers successfully validated!');
}

main();
