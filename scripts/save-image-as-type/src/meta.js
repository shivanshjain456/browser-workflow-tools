/**
 * Single source of truth for the userscript metadata block.
 *
 * Both `build.mjs` (which renders the header of the distributed artifact) and
 * `test/unit/metadata.test.mjs` (which audits it) import this module, so the
 * declared permissions cannot drift away from what the code actually uses.
 */

export const SCRIPT_VERSION = '2.0.3';

export const META = {
  name: 'Save Image as Type',
  /**
   * `namespace` is an opaque identifier that managers use to tell two scripts
   * with the same name apart — it is never fetched. The `.invalid` TLD is
   * reserved by RFC 2606 and cannot resolve, which makes the intent explicit.
   * Changing it changes the manager's identity for this script and can create a
   * second installed copy, so it stays fixed across releases.
   */
  namespace: 'https://siat.invalid/save-image-as-type',
  version: SCRIPT_VERSION,
  description:
    'Convert images locally: PNG, JPG, WebP, GIF, BMP, PDF, probe-gated AVIF or original bytes. Batch, ZIP, transforms, clipboard, metadata and keyboard workflows. No servers or tracking.',
  author: 'Shivansh Jain',
  license: 'MIT',
  homepageURL: 'https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/save-image-as-type',
  supportURL: 'https://github.com/shivanshjain456/browser-workflow-tools/issues',
  /**
   * Canonical artifact. There is exactly one distributable file in the repo:
   * `release/save-image-as-type.user.js`. `@updateURL` makes the *manager*
   * re-check this URL periodically; the script itself never contacts it.
   */
  downloadURL: 'https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/save-image-as-type/release/save-image-as-type.user.js',
  updateURL: 'https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/save-image-as-type/release/save-image-as-type.user.js',
  /** Self-contained: the icon must never cost a network request at install time. */
  icon:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E" +
    "%3Crect width='64' height='64' rx='12' fill='%232563eb'/%3E" +
    "%3Cpath d='M32 14v24m0 0-9-9m9 9 9-9' stroke='white' stroke-width='5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E" +
    "%3Cpath d='M16 46h32' stroke='white' stroke-width='5' stroke-linecap='round'/%3E" +
    '%3C/svg%3E',
  /**
   * This tool is deliberately site-agnostic: its whole purpose is to act on an
   * image on whatever page the user happens to be reading. http/https only.
   */
  match: ['*://*/*'],
  exclude: [],
  /** document-start so the contextmenu listener exists before the user can right-click. */
  runAt: 'document-start',
  /** Frames are intentionally allowed: right-clicking an image inside an iframe must work. */
  noframes: false,
  /** Every grant below is used by the code; lint.mjs fails if that stops being true. */
  grant: [
    'GM_info', // manager/version detection -> diagnostics + download strategy
    'GM_getValue', // read persisted settings
    'GM_setValue', // write persisted settings
    'GM_addValueChangeListener', // sync settings between open tabs
    'GM_removeValueChangeListener', // release that listener when the page tears down
    'GM_deleteValue', // "Reset to defaults" removes the stored key entirely
    'GM_xmlhttpRequest', // fetch cross-origin image bytes the user explicitly asked for
    'GM_download', // save the converted file with the manager's download pipeline
    'GM_registerMenuCommand', // manager menu entries: settings / diagnostics / pause
    'GM_notification', // surface failures when the in-page toast is not visible
  ],
  /**
   * Images live on arbitrary CDNs, so a wildcard is inherent to a site-agnostic
   * image tool. The request only happens on an explicit user action, and users
   * can disable manager-based fetching with allowCrossOriginFetch.
   */
  connect: ['*'],
};

const KEY_ORDER = [
  'name', 'namespace', 'version', 'description', 'author', 'license',
  'homepageURL', 'supportURL', 'downloadURL', 'updateURL', 'icon',
  'match', 'exclude', 'run-at', 'noframes', 'grant', 'connect',
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
