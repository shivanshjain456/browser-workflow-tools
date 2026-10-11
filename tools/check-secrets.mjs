#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// High-risk patterns indicating real credentials or secrets
const SECRET_PATTERNS = [
  { name: 'GitHub Personal Access Token', regex: /\bghp_[a-zA-Z0-9]{36}\b/ },
  { name: 'GitHub OAuth Token', regex: /\bgho_[a-zA-Z0-9]{36}\b/ },
  { name: 'OpenAI API Key', regex: /\bsk-[a-zA-Z0-9]{20,48}\b/ },
  { name: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private Key Block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Slack Webhook', regex: /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]+\/B[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+/ },
  { name: 'Hardcoded Bearer Token', regex: /Bearer\s+[a-zA-Z0-9_\-\.]{40,}/i }
];

const IGNORE_DIRS = new Set(['.git', 'node_modules', '.gemini']);

function walkDir(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, fileList);
    } else if (entry.isFile()) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const findings = [];
  const lines = content.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    for (const pat of SECRET_PATTERNS) {
      if (pat.regex.test(line)) {
        findings.push({
          pattern: pat.name,
          line: lineIdx + 1,
          preview: line.trim().slice(0, 80)
        });
      }
    }
  }
  return findings;
}

function main() {
  console.log('Scanning repository for accidental secrets and real credentials...');
  const files = walkDir(process.cwd());
  let issuesCount = 0;

  for (const file of files) {
    const findings = scanFile(file);
    if (findings.length > 0) {
      issuesCount += findings.length;
      console.error(`\n[!] Secret detected in ${path.relative(process.cwd(), file)}:`);
      for (const f of findings) {
        console.error(`    Line ${f.line} [${f.pattern}]: ${f.preview}`);
      }
    }
  }

  if (issuesCount > 0) {
    console.error(`\nSecurity Scan FAILED: Found ${issuesCount} secret pattern(s).`);
    process.exit(1);
  } else {
    console.log(`Scanned ${files.length} files: 0 secrets detected. Clean!`);
  }
}

main();
