/**
 * Single source of truth for the userscript metadata block.
 *
 * Both `build.mjs` (which renders the header of the distributed artifact) and
 * `test/unit/metadata.test.mjs` (which audits it) import this module, so the
 * declared permissions cannot drift away from what the code actually uses.
 */

export const SCRIPT_VERSION = '2.0.1';

export const META = {
  name: 'Save Image as Type',
  namespace: 'https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/save-image-as-type',
  version: SCRIPT_VERSION,
  description:
    'Convert images locally: PNG, JPG, WebP, GIF, BMP, PDF, probe-gated AVIF or original bytes. Batch, ZIP, transforms, clipboard, metadata and keyboard workflows. No servers or tracking.',
  author: 'Shivansh Jain',
  license: 'MIT',
  homepageURL: 'https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/save-image-as-type',
  supportURL: 'https://github.com/shivanshjain456/browser-workflow-tools/issues',
  downloadURL: 'https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/save-image-as-type/save-image-as-type.user.js',
  updateURL: 'https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/save-image-as-type/save-image-as-type.user.js',
  icon: 'https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/assets/brand/png/browser-workflow-tools-mark-32.png',
  icon64: 'https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/assets/brand/png/browser-workflow-tools-mark-64.png',
  match: ['*://*/*'],
  exclude: [],
  runAt: 'document-start',
  noframes: false,
  grant: [
    'GM_info',
    'GM_getValue',
    'GM_setValue',
    'GM_addValueChangeListener',
    'GM_removeValueChangeListener',
    'GM_deleteValue',
    'GM_xmlhttpRequest',
    'GM_download',
    'GM_registerMenuCommand',
    'GM_notification',
  ],
  connect: [],
};

const KEY_ORDER = [
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
  'icon',
  'icon64',
  'match',
  'exclude',
  'run-at',
  'noframes',
  'grant',
  'connect',
];

function metaValue(key) {
  if (key === 'run-at') return META.runAt;
  if (key === 'noframes') return META.noframes ? '' : null;
  return META[key];
}

/** Renders the `// ==UserScript== ... // ==/UserScript==` block. */
export function renderMetadata(meta = META) {
  const lines = ['// SPDX-License-Identifier: MIT', '// ==UserScript=='];
  const push = (key, value) => {
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`// @${key.padEnd(14)}${item}`);
    } else if (value === '' || value === true) {
      lines.push(`// @${key}`);
    } else if (value != null) {
      lines.push(`// @${key.padEnd(14)}${value}`);
    }
  };
  for (const key of KEY_ORDER) push(key, metaValue(key));
  for (const key of Object.keys(meta).sort()) {
    if (KEY_ORDER.includes(key) || key === 'runAt' || key === 'noframes') continue;
    push(key, meta[key]);
  }
  lines.push('// ==/UserScript==');
  return lines.join('\n');
}

