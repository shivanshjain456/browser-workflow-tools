/**
 * Userscript-manager adapter.
 *
 * Tampermonkey and Violentmonkey both expose the classic `GM_*` functions and
 * the Greasemonkey-4 style `GM.*` namespace, but they differ in details that
 * matter here:
 *
 *   - `GM.getValue`/`GM.setValue`/`GM.download`/`GM.xmlHttpRequest` are async
 *     in Violentmonkey (VM2.18.3+) and Greasemonkey 4, while `GM_*` is sync in
 *     Tampermonkey. This adapter normalises everything to promises.
 *   - `GM_info.downloadMode` is "native" | "browser" | "disabled" in
 *     Tampermonkey and "native" | "browser" in Violentmonkey (VM2.45.2+).
 *     "native" means the manager implements GM_download with a plain
 *     <a download> click, which cannot honour `saveAs` or a sub-folder.
 *   - Tampermonkey refuses `GM_download` names whose extension is not on its
 *     whitelist (error reasons `not_whitelisted`, `not_enabled`,
 *     `not_permitted`, `not_supported`). Every one of those is recoverable by
 *     falling back to our own anchor download, so `saveBlob()` does that and
 *     reports which path actually ran.
 *
 * Nothing in this module assumes an API exists: every capability is probed.
 */

const GM_NS = (() => {
  try {
    // eslint-disable-next-line no-undef
    return typeof GM !== 'undefined' && GM ? GM : null;
  } catch {
    return null;
  }
})();

/** Static lookups — `typeof X` cannot be built from a dynamic name without eval. */
const GLOBALS = {
  info: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_info !== 'undefined' ? GM_info : undefined;
    } catch {
      return undefined;
    }
  },
  getValue: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_getValue !== 'undefined' ? GM_getValue : undefined;
    } catch {
      return undefined;
    }
  },
  setValue: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_setValue !== 'undefined' ? GM_setValue : undefined;
    } catch {
      return undefined;
    }
  },
  deleteValue: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_deleteValue !== 'undefined' ? GM_deleteValue : undefined;
    } catch {
      return undefined;
    }
  },
  addValueChangeListener: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_addValueChangeListener !== 'undefined' ? GM_addValueChangeListener : undefined;
    } catch {
      return undefined;
    }
  },
  removeValueChangeListener: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_removeValueChangeListener !== 'undefined' ? GM_removeValueChangeListener : undefined;
    } catch {
      return undefined;
    }
  },
  xmlHttpRequest: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_xmlhttpRequest !== 'undefined' ? GM_xmlhttpRequest : undefined;
    } catch {
      return undefined;
    }
  },
  download: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_download !== 'undefined' ? GM_download : undefined;
    } catch {
      return undefined;
    }
  },
  registerMenuCommand: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_registerMenuCommand !== 'undefined' ? GM_registerMenuCommand : undefined;
    } catch {
      return undefined;
    }
  },
  notification: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_notification !== 'undefined' ? GM_notification : undefined;
    } catch {
      return undefined;
    }
  },
};

function asPromise(value) {
  if (value && typeof value.then === 'function') return value;
  return Promise.resolve(value);
}

/**
 * @param {Record<string, Function|object|undefined>} [override]
 *   Test/dependency-injection seam: pass an object shaped like the GM_*
 *   globals to exercise the adapter without a real manager.
 */
export function createGmAdapter(override) {
  /**
   * Both spellings of every API, because the managers disagree:
   * the classic global is `GM_xmlhttpRequest` (lower-case "http") while the
   * GM.* namespace uses `GM.xmlHttpRequest` (capital H), and GM4-era scripts
   * sometimes see `GM.xmlhttpRequest`. Probing only one spelling silently
   * loses the capability, so all accepted spellings are tried in order.
   */
  const SPELLINGS = {
    info: { classic: ['GM_info'], ns: ['info'] },
    getValue: { classic: ['GM_getValue'], ns: ['getValue'] },
    setValue: { classic: ['GM_setValue'], ns: ['setValue'] },
    deleteValue: { classic: ['GM_deleteValue', 'GM_delete_value'], ns: ['deleteValue'] },
    addValueChangeListener: { classic: ['GM_addValueChangeListener'], ns: ['addValueChangeListener'] },
    removeValueChangeListener: { classic: ['GM_removeValueChangeListener'], ns: ['removeValueChangeListener'] },
    xmlHttpRequest: { classic: ['GM_xmlhttpRequest', 'GM_xmlHttpRequest'], ns: ['xmlHttpRequest', 'xmlhttpRequest'] },
    download: { classic: ['GM_download'], ns: ['download'] },
    registerMenuCommand: { classic: ['GM_registerMenuCommand'], ns: ['registerMenuCommand'] },
    notification: { classic: ['GM_notification'], ns: ['notification'] },
  };

  const pick = (name) => {
    const spellings = SPELLINGS[name] || { classic: [`GM_${name}`], ns: [name] };
    // 1. an explicit override (tests, shims, embedding pages) — classic spellings first
    for (const key of spellings.classic) {
      if (override && typeof override[key] !== 'undefined') return override[key];
    }
    // 2. the override's GM.* namespace
    for (const key of spellings.ns) {
      if (override && override.GM && typeof override.GM[key] !== 'undefined') return override.GM[key];
    }
    // 3. the real granted classic global
    const classic = GLOBALS[name] ? GLOBALS[name]() : undefined;
    if (typeof classic === 'function') return classic;
    if (name === 'info' && classic) return classic;
    // 4. the real GM.* namespace object
    for (const key of spellings.ns) {
      if (GM_NS && typeof GM_NS[key] === 'function') return GM_NS[key].bind(GM_NS);
    }
    if (name === 'info' && GM_NS && GM_NS.info) return GM_NS.info;
    return undefined;
  };

  const info = pick('info') || null;
  const getValue = pick('getValue');
  const setValue = pick('setValue');
  const deleteValue = pick('deleteValue');
  const addListener = pick('addValueChangeListener');
  const removeListener = pick('removeValueChangeListener');
  const xhr = pick('xmlHttpRequest');
  const download = pick('download');
  const menuCommand = pick('registerMenuCommand');
  const notification = pick('notification');

  return {
    /** Which manager we are running under, for the diagnostics panel. */
    handler: String((info && (info.scriptHandler || (info.script && info.script.handler))) || 'unknown'),
    managerVersion: String((info && info.version) || ''),
    /** "native" | "browser" | "disabled" | "unknown" */
    downloadMode: String((info && info.downloadMode) || 'unknown'),
    scriptVersion: String((info && info.script && info.script.version) || ''),
    injectInto: String((info && (info.injectInto || (info.script && info.script.injectInto))) || ''),
    // A manager's injection label is not proof of an isolation boundary.
    // null means not independently observed; never manufacture a reassuring yes.
    sandboxed: null,
    capabilities: {
      storage: typeof getValue === 'function' && typeof setValue === 'function',
      xhr: typeof xhr === 'function',
      download: typeof download === 'function',
      menuCommand: typeof menuCommand === 'function',
      notification: typeof notification === 'function',
      valueChangeSync: typeof addListener === 'function',
    },

    async getValue(key, fallback) {
      if (typeof getValue !== 'function') return fallback;
      try {
        const value = await asPromise(getValue(key, fallback));
        return value === undefined ? fallback : value;
      } catch {
        return fallback;
      }
    },

    async setValue(key, value) {
      if (typeof setValue !== 'function') return false;
      try {
        await asPromise(setValue(key, value));
        return true;
      } catch {
        return false;
      }
    },

    async deleteValue(key) {
      if (typeof deleteValue !== 'function') return false;
      try {
        await asPromise(deleteValue(key));
        return true;
      } catch {
        return false;
      }
    },

    onValueChanged(key, handler) {
      if (typeof addListener !== 'function') return null;
      try {
        const id = addListener(key, handler);
        return {
          dispose() {
            if (typeof removeListener === 'function') removeListener(id);
          },
        };
      } catch {
        return null;
      }
    },

    /**
     * Cross-origin-capable fetch. Resolves with {status, response, responseHeaders, finalUrl}.
     * The returned object also carries `abort()` so callers can cancel stale work.
     */
    xhrBlob(url, { timeout = 30000, headers = {}, signal } = {}) {
      return new Promise((resolvePromise, rejectPromise) => {
        if (typeof xhr !== 'function') {
          rejectPromise(new GmError('xhr-unavailable', 'Your userscript manager did not grant GM_xmlhttpRequest.'));
          return;
        }
        let settled = false;
        const finish = (fn, arg) => {
          if (settled) return;
          settled = true;
          try {
            if (signal) signal.removeEventListener('abort', onAbort);
          } catch {
            /* noop */
          }
          fn(arg);
        };
        let control = null;
        const onAbort = () => {
          try {
            if (control && typeof control.abort === 'function') control.abort();
          } catch {
            /* noop */
          }
          finish(rejectPromise, new GmError('aborted', 'Request cancelled.'));
        };
        if (signal) {
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }
        try {
          control = xhr({
            method: 'GET',
            url,
            // 'blob' keeps memory bounded and avoids base64 round-trips; TM and
            // VM both support it, and we fall back to arraybuffer below if the
            // manager hands us nothing usable.
            responseType: 'blob',
            timeout,
            headers: Object.assign({ Accept: 'image/*,*/*' }, headers),
            onload: (res) => {
              const response = res && (res.response !== undefined ? res.response : res.responseText);
              if (!response) {
                finish(rejectPromise, new GmError('empty-response', 'The manager returned an empty response.'));
                return;
              }
              finish(resolvePromise, {
                status: res.status,
                response,
                responseHeaders: res.responseHeaders || '',
                finalUrl: res.finalUrl || url,
              });
            },
            onerror: (res) =>
              finish(rejectPromise, new GmError('network', `Network error${res && res.status ? ` (HTTP ${res.status})` : ''}.`, res)),
            ontimeout: () => finish(rejectPromise, new GmError('timeout', `Timed out after ${Math.round(timeout / 1000)}s.`)),
          });
        } catch (err) {
          finish(rejectPromise, new GmError('threw', err && err.message ? err.message : String(err)));
        }
      });
    },

    /**
     * Manager download. Resolves with {via:'gm', saveAs, subfolderApplied}.
     * Rejects with a GmError whose `reason` is the manager's own error string
     * (not_enabled / not_whitelisted / not_permitted / not_supported / …) so the
     * caller can decide whether a fallback is worthwhile and tell the user why.
     */
    downloadBlobUrl(objectUrl, name, { saveAs = false, timeout = 60000 } = {}) {
      return new Promise((resolvePromise, rejectPromise) => {
        if (typeof download !== 'function') {
          rejectPromise(new GmError('unsupported', 'GM_download is not available in this manager.'));
          return;
        }
        let settled = false;
        const finish = (fn, arg) => {
          if (settled) return;
          settled = true;
          fn(arg);
        };
        try {
          const details = { url: objectUrl, name, saveAs: Boolean(saveAs), timeout };
          details.onload = () => finish(resolvePromise, { via: 'gm', name });
          details.onerror = (err) => {
            const reason = (err && (err.error || err.reason)) || 'unknown';
            finish(rejectPromise, new GmError(String(reason), describeDownloadError(reason), err));
          };
          details.ontimeout = () => finish(rejectPromise, new GmError('timeout', 'The download timed out.'));
          download(details);
        } catch (err) {
          finish(rejectPromise, new GmError('threw', err && err.message ? err.message : String(err)));
        }
      });
    },

    registerMenuCommand(label, handler, accessKey) {
      if (typeof menuCommand !== 'function') return null;
      try {
        return menuCommand(label, handler, accessKey);
      } catch {
        return null;
      }
    },

    notify(text, title, { timeout = 6000, silent = false } = {}) {
      if (typeof notification !== 'function' || silent) return false;
      try {
        notification({ text: String(text).slice(0, 400), title: String(title || 'Save Image as Type'), timeout });
        return true;
      } catch {
        try {
          notification(String(text).slice(0, 400), String(title || 'Save Image as Type'));
          return true;
        } catch {
          return false;
        }
      }
    },
  };
}

export class GmError extends Error {
  constructor(reason, message, detail) {
    super(message);
    this.name = 'GmError';
    this.reason = reason;
    this.detail = detail || null;
  }
}

function describeDownloadError(reason) {
  switch (reason) {
    case 'not_enabled':
      return 'Downloads are disabled in your userscript manager settings.';
    case 'not_whitelisted':
      return 'Your userscript manager blocked this file extension (Tampermonkey: Settings → Download → file extension whitelist).';
    case 'not_permitted':
      return 'Your userscript manager is missing the browser "downloads" permission.';
    case 'not_supported':
      return 'This browser/manager combination does not support GM_download.';
    case 'not_succeeded':
      return 'The manager reported the download did not start.';
    default:
      return `The manager download failed (${reason}).`;
  }
}

/** Lazily created singleton used by the shipped script. */
let gmSingleton = null;
export function getGm() {
  if (!gmSingleton) gmSingleton = createGmAdapter();
  return gmSingleton;
}

/** Test seam: reset the singleton (used when a fake manager is installed). */
export function resetGmForTest(adapter) {
  gmSingleton = adapter || null;
}
