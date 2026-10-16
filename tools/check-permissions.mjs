#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const SCRIPTS_DIR = path.resolve('scripts');
const PERMISSIONS_FILE = path.resolve('PERMISSIONS.md');

// Canonical script metadata and architectural privacy policies
const SCRIPT_POLICIES = {
  'clip-leetcode': {
    name: 'Clip LeetCode',
    authenticated: 'No (reads public/in-session problem DOM only; no credential transmission)',
    persisted: 'localStorage / GM storage: user export template preferences, clip history buffer (up to user limit)',
    clipboard: 'Writes formatted Markdown/HTML/JSON problem description upon user button click or hotkey',
    automatic: 'Optional auto-copy on solution acceptance (disabled by default, user-configurable)',
    disclosure: 'Dedicated in-page action bar, options modal, and clipboard toast notification'
  },
  'codebase-uploader': {
    name: 'Codebase Uploader',
    authenticated: 'No (processes selected local files purely in browser memory)',
    persisted: 'GM storage: token budget thresholds, custom .gitignore rule profiles, theme preference',
    clipboard: 'Writes packaged Markdown chunks to clipboard upon user export selection',
    automatic: 'None (only executes on explicit user file selection or drag-and-drop)',
    disclosure: 'Custom shadow DOM UI panel, status indicators, and delivery ladder status'
  },
  'chatgpt-conversation-bridge': {
    name: 'ChatGPT Conversation Bridge',
    authenticated: 'Yes (same-origin session cookies/auth headers when archiving user own conversation or public share)',
    persisted: 'GM storage: export preferences, image inclusion toggle, continuation staging template',
    clipboard: 'Writes continuation prompt text or export notifications',
    automatic: 'None (archive generation and continuation staging are exclusively user-triggered)',
    disclosure: 'Floating Action Button (FAB), export modal with progress bar and error notifications'
  },
  'web-archives': {
    name: 'Web Archives',
    authenticated: 'No (public unauthenticated read probes against archive APIs only)',
    persisted: 'GM storage: active archive engine selection, search mode preference, theme settings',
    clipboard: 'Writes resolved archive/original URLs upon explicit user action',
    automatic: 'Optional automatic fallback lookup when navigation fails with network/DNS error (configurable)',
    disclosure: 'Keyboard launcher dialog, snapshot picker panel, context menu integration'
  },
  'youtube-search-command': {
    name: 'YouTube Search Command',
    authenticated: 'No (processes page search result DOM and public video metadata)',
    persisted: 'GM storage: channel ranking weights, category exclusion rules, filter profiles',
    clipboard: 'None',
    automatic: 'Live in-page result re-ordering and visual filter badges on search navigation',
    disclosure: 'Inline filter controls, control plane dialog, and per-card decision tags'
  },
  'yt-share-antitrack': {
    name: 'YTShareAntiTrack',
    authenticated: 'No (local URL query string parameter sanitization only)',
    persisted: 'GM storage: parameter allowlist/blocklist configuration, cleaning statistics',
    clipboard: 'Intercepts and sanitizes YouTube share URLs written to clipboard (stripping tracking params)',
    automatic: 'Real-time clipboard sanitization on YouTube share button clicks',
    disclosure: 'Tampermonkey menu command for settings, console diagnostics when enabled'
  },
  'save-image-as-type': {
    name: 'Save Image as Type',
    authenticated: 'No (processes images and canvas elements entirely in local memory)',
    persisted: 'GM storage: format preferences, quality, batch/ZIP options, transforms, keyboard shortcuts',
    clipboard: 'Writes converted image data URLs or image blobs to clipboard upon user export selection',
    automatic: 'None (only executes on explicit user context menu selection, shortcut, or batch action)',
    disclosure: 'Custom context menu, settings modal, batch picker dialog, toast notifications'
  }
};

function parseScriptManifest(folderName) {
  const scriptPath = path.join(SCRIPTS_DIR, folderName, `${folderName}.user.js`);
  const content = fs.readFileSync(scriptPath, 'utf8');

  const match = content.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/);
  if (!match) throw new Error(`Missing metadata block in ${scriptPath}`);

  const lines = match[1].split('\n');
  const matches = [];
  const grants = [];
  const connects = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const mMatch = line.match(/^\/\/\s*@match\s+(.*)$/);
    if (mMatch) matches.push(mMatch[1]);
    const gMatch = line.match(/^\/\/\s*@grant\s+(.*)$/);
    if (gMatch) grants.push(gMatch[1]);
    const cMatch = line.match(/^\/\/\s*@connect\s+(.*)$/);
    if (cMatch) connects.push(cMatch[1]);
  }

  // Security gate: NEVER allow wildcard @connect *
  if (connects.includes('*')) {
    throw new Error(`Security Violation: Wildcard '@connect *' found in ${folderName}!`);
  }

  const policy = SCRIPT_POLICIES[folderName];
  if (!policy) throw new Error(`No security policy defined for ${folderName}`);

  return {
    folder: folderName,
    name: policy.name,
    matches: matches.length > 0 ? matches : ['None'],
    grants: grants.length > 0 ? grants : ['none'],
    connects: connects.length > 0 ? connects : ['none (same-origin / offline)'],
    ...policy
  };
}

function generatePermissionsTable(manifests) {
  let md = '# Permissions & Data-Flow Matrix\n\n';
  md += 'This table is automatically verified in CI by `tools/check-permissions.mjs`.\n\n';
  md += '| Script | Matched Sites | Grants | Cross-Origin Hosts | Authenticated? | Data Persisted | Clipboard Behavior | Automatic Actions | User-Visible Disclosure |\n';
  md += '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n';

  for (const m of manifests) {
    const matchedSites = m.matches.map(s => `\`${s}\``).join('<br>');
    const grantList = m.grants.map(g => `\`${g}\``).join('<br>');
    const connectList = m.connects.map(c => `\`${c}\``).join('<br>');

    md += `| **[${m.name}](scripts/${m.folder})** | ${matchedSites} | ${grantList} | ${connectList} | ${m.authenticated} | ${m.persisted} | ${m.clipboard} | ${m.automatic} | ${m.disclosure} |\n`;
  }

  return md;
}

function main() {
  const folders = fs.readdirSync(SCRIPTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  console.log(`Auditing security privileges for ${folders.length} scripts...`);
  const manifests = [];

  for (const folder of folders) {
    const manifest = parseScriptManifest(folder);
    manifests.push(manifest);
    console.log(`  ✓ ${manifest.name}: ${manifest.grants.length} grants, ${manifest.connects.length} connects, 0 wildcard connect`);
  }

  const tableMd = generatePermissionsTable(manifests);
  fs.writeFileSync(PERMISSIONS_FILE, tableMd, 'utf8');
  console.log(`\nSuccessfully wrote verified permissions matrix to PERMISSIONS.md!`);
}

main();
