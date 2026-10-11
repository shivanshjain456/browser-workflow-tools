// SPDX-License-Identifier: MIT
// ==UserScript==
// @name         ChatGPT Conversation Bridge
// @namespace    https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/chatgpt-conversation-bridge
// @version      1.0.0
// @description  Archive any ChatGPT conversation into a permanent ZIP and a readable DOCX, then continue it in a new chat. Reads a Share URL or your own /c/ chat, verifies the message chain, downloads supported images, renders Markdown/tables/code into Word, and stages the CHAT CONTINUATION flow.
// @author       Shivansh Jain
// @license      MIT
// @homepageURL  https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/chatgpt-conversation-bridge
// @supportURL   https://github.com/shivanshjain456/browser-workflow-tools/issues
// @downloadURL  https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/chatgpt-conversation-bridge/chatgpt-conversation-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/chatgpt-conversation-bridge/chatgpt-conversation-bridge.user.js
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      chatgpt.com
// ==/UserScript==

/*
 * ChatGPT Conversation Bridge - userscript.
 *
 * Browser tool to archive ChatGPT conversations into a permanent ZIP archive
 * and formatted DOCX document, and stage continuation prompts into the composer.
 */
(() => {
  "use strict";

  /* ===== src/core/text.js ===== */
  /*
   * Text primitives with strict Unicode and string handling.
   *
   * Handles:
   *   1. `str` length counting exact *code points*, not UTF-16 units.
   *   2. Banker's rounding (round half to even).
   *   3. Strict HTML unescaping and URL quoting rules.
   */

  const CODE_POINT_LIMIT = 0x10ffff;

  /** Unicode code point count: number of Unicode code points, not UTF-16 code units. */
  function codePointLength(text) {
    let count = 0;
    for (const _ch of text) count += 1;
    return count;
  }

  /** Split into code points (surrogate pairs stay joined). */
  function codePoints(text) {
    return Array.from(text);
  }

  /** UTF-8 encoded byte length. */
  function utf8ByteLength(text) {
    return new TextEncoder().encode(text).length;
  }

  /** Banker's rounding: round half to even. */
  function pyRound(value) {
    const floor = Math.floor(value);
    const diff = value - floor;
    if (diff > 0.5) return floor + 1;
    if (diff < 0.5) return floor;
    return floor % 2 === 0 ? floor : floor + 1;
  }

  /**
   * HTML entity unescape for the subset ChatGPT payloads actually contain:
   * numeric references plus the named entities that appear in exported prose.
   * In a browser page the DOM decoder is used instead, which is exhaustive.
   */
  const NAMED_ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00a0",
    ensp: "\u2002",
    emsp: "\u2003",
    thinsp: "\u2009",
    zwnj: "\u200c",
    zwj: "\u200d",
    lrm: "\u200e",
    rlm: "\u200f",
    shy: "\u00ad",
    copy: "\u00a9",
    reg: "\u00ae",
    trade: "\u2122",
    hellip: "\u2026",
    mdash: "\u2014",
    ndash: "\u2013",
    lsquo: "\u2018",
    rsquo: "\u2019",
    ldquo: "\u201c",
    rdquo: "\u201d",
    laquo: "\u00ab",
    raquo: "\u00bb",
    times: "\u00d7",
    divide: "\u00f7",
    minus: "\u2212",
    middot: "\u00b7",
    bull: "\u2022",
    deg: "\u00b0",
    prime: "\u2032",
    Prime: "\u2033",
    sect: "\u00a7",
    para: "\u00b6",
    dagger: "\u2020",
    Dagger: "\u2021",
    euro: "\u20ac",
    pound: "\u00a3",
    yen: "\u00a5",
    cent: "\u00a2",
    curren: "\u00a4",
    currency: "\u00a4",
    deg0: "\u00b0",
    le: "\u2264",
    leq: "\u2264",
    ge: "\u2265",
    geq: "\u2265",
    ne: "\u2260",
    neq: "\u2260",
    approx: "\u2248",
    equiv: "\u2261",
    times_: "\u00d7",
    infin: "\u221e",
    half: "\u00bd",
    frac12: "\u00bd",
    frac14: "\u00bc",
    frac34: "\u00be",
    sup1: "\u00b9",
    sup2: "\u00b2",
    sup3: "\u00b3",
    larr: "\u2190",
    rarr: "\u2192",
    uarr: "\u2191",
    darr: "\u2193",
    harr: "\u2194",
    Alpha: "\u0391",
    Beta: "\u0392",
    Gamma: "\u0393",
    Delta: "\u0394",
    Epsilon: "\u0395",
    Zeta: "\u0396",
    Eta: "\u0397",
    Theta: "\u0398",
    Iota: "\u0399",
    Kappa: "\u039a",
    Lambda: "\u039b",
    Mu: "\u039c",
    Nu: "\u039d",
    Xi: "\u039e",
    Omicron: "\u039f",
    Pi: "\u03a0",
    Rho: "\u03a1",
    Sigma: "\u03a3",
    Tau: "\u03a4",
    Upsilon: "\u03a5",
    Phi: "\u03a6",
    Chi: "\u03a7",
    Psi: "\u03a8",
    Omega: "\u03a9",
    alpha: "\u03b1",
    beta: "\u03b2",
    gamma: "\u03b3",
    delta: "\u03b4",
    epsilon: "\u03b5",
    zeta: "\u03b6",
    eta: "\u03b7",
    theta: "\u03b8",
    iota: "\u03b9",
    kappa: "\u03ba",
    lambda: "\u03bb",
    mu: "\u03bc",
    nu: "\u03bd",
    xi: "\u03be",
    omicron: "\u03bf",
    pi: "\u03c0",
    rho: "\u03c1",
    sigma: "\u03c3",
    tau: "\u03c4",
    upsilon: "\u03c5",
    phi: "\u03c6",
    chi: "\u03c7",
    psi: "\u03c8",
    omega: "\u03c9",
  };

  let domUnescapeProbe = null;

  function domUnescape(text) {
    // Reuse the page's own HTML entity decoder when we are in a document.
    if (typeof document === "undefined" || !document.createElement) return null;
    if (!domUnescapeProbe) {
      domUnescapeProbe = document.createElement("textarea");
    }
    const probe = domUnescapeProbe;
    probe.innerHTML = text;
    const decoded = probe.value;
    probe.value = "";
    return decoded;
  }

  /** Replace numeric character references (`decodeNumericRefs`). */
  function decodeNumericRefs(text) {
    return text.replace(/&#([0-9]+);?|&#[xX]([0-9a-fA-F]+);?/g, (match, dec, hex) => {
      const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
      if (!Number.isFinite(code) || code < 0 || code > CODE_POINT_LIMIT) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    });
  }

  /**
   * Unescape HTML helper. Named references may appear with or without
   * the trailing semicolon.
   */
  function unescapeHtml(text) {
    if (typeof text !== "string" || text.length === 0) return text;
    if (text.indexOf("&") === -1) return text;

    const viaDom = domUnescape(text);
    if (viaDom !== null) return viaDom;

    let out = "";
    let i = 0;
    while (i < text.length) {
      const amp = text.indexOf("&", i);
      if (amp === -1) {
        out += text.slice(i);
        break;
      }
      out += text.slice(i, amp);

      const withSemi = /^&([a-zA-Z][a-zA-Z0-9]*);/.exec(text.slice(amp));
      if (withSemi && Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, withSemi[1])) {
        out += NAMED_ENTITIES[withSemi[1]];
        i = amp + withSemi[0].length;
        continue;
      }

      const numeric = /^&(#[0-9]+|#[xX][0-9a-fA-F]+);?/.exec(text.slice(amp));
      if (numeric) {
        out += decodeNumericRefs(numeric[0]);
        i = amp + numeric[0].length;
        continue;
      }

      // Bare named refs without a semicolon.
      const bare = /^&([a-zA-Z][a-zA-Z0-9]*)/.exec(text.slice(amp));
      if (bare && Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, bare[1])) {
        out += NAMED_ENTITIES[bare[1]];
        i = amp + bare[0].length;
        continue;
      }

      out += "&";
      i = amp + 1;
    }
    return out;
  }

  /**
   * `clean_xml_text`: XML 1.0 cannot encode most control characters, but it does
   * permit the full supplementary planes, so emoji survive and stray control
   * bytes are dropped rather than producing a file Word refuses to open.
   */
  function cleanXmlText(text) {
    let out = "";
    for (const ch of text) {
      const code = ch.codePointAt(0);
      if (code === 0x09 || code === 0x0a || code === 0x0d) {
        out += ch;
      } else if (code >= 0x20 && code <= 0xd7ff) {
        out += ch;
      } else if (code >= 0xe000 && code <= 0xfffd) {
        out += ch;
      } else if (code >= 0x10000 && code <= 0x10ffff) {
        out += ch;
      }
    }
    return out;
  }

  /** Character trim helpers: `rstripChars` / `lstripChars` / `stripChars`. */
  function rstripChars(text, chars) {
    let end = text.length;
    while (end > 0 && chars.includes(text[end - 1])) end -= 1;
    return text.slice(0, end);
  }

  function lstripChars(text, chars) {
    let start = 0;
    while (start < text.length && chars.includes(text[start])) start += 1;
    return text.slice(start);
  }

  function stripChars(text, chars) {
    return rstripChars(lstripChars(text, chars), chars);
  }

  /**
   * Percent encoder — note `~` is safe and `!*'()`
   * are encoded, keeping normalised reference URLs strictly consistent.
   */
  function pyQuote(value, safe = "") {
    const alwaysSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~";
    const bytes = new TextEncoder().encode(value);
    let out = "";
    for (const byte of bytes) {
      const char = String.fromCharCode(byte);
      if (alwaysSafe.includes(char) || safe.includes(char)) {
        out += char;
      } else {
        out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    }
    return out;
  }

  /** Percent encoder with spaces collapsed to `+`. */
  function pyQuotePlus(value, safe = "") {
    return pyQuote(value, `${safe}`).replace(/%20/g, "+");
  }

  /**
   * Parse query string — split on `&`, `+` decodes to space,
   * fields without `=` survive with an empty value, and empty fields are dropped.
   */
  function parseQsl(query) {
    if (!query) return [];
    const pairs = [];
    for (const field of query.split("&")) {
      if (!field) continue;
      const eq = field.indexOf("=");
      const rawKey = eq === -1 ? field : field.slice(0, eq);
      const rawValue = eq === -1 ? "" : field.slice(eq + 1);
      const key = decodePlus(rawKey);
      const value = decodePlus(rawValue);
      if (!key && !value) continue;
      pairs.push([key, value]);
    }
    return pairs;
  }

  function decodePlus(text) {
    try {
      return decodeURIComponent(text.replace(/\+/g, " ").replace(/%(?![0-9a-fA-F]{2})/g, "%25"));
    } catch {
      return decodeURIComponent(
        text.replace(/\+/g, " ").replace(/%/g, "%25").replace(/%25(?![0-9a-fA-F]{2})/g, "%25"),
      );
    }
  }

  /** Query string encoder: `urlEncode(pairs)`. */
  function urlEncode(pairs) {
    return pairs
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return value.map((item) => `${pyQuotePlus(key)}=${pyQuotePlus(String(item))}`).join("&");
        }
        return `${pyQuotePlus(key)}=${pyQuotePlus(String(value))}`;
      })
      .join("&");
  }

  /** Escape a string for use inside XML text content. */
  function escapeXmlText(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /** Escape a string for use inside a double-quoted XML attribute. */
  function escapeXmlAttr(text) {
    return escapeXmlText(text)
      .replace(/"/g, "&quot;")
      .replace(/\t/g, "&#9;")
      .replace(/\n/g, "&#10;")
      .replace(/\r/g, "&#13;");
  }

  /**
   * Escape &, <, >, " and ' to entities.
   * Used for `docProps/core.xml` title escaping.
   */
  function htmlEscape(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
  }

  /* ===== src/core/url.js ===== */
  /*
   * URL handling.
   *
   * Implements strict custom URL split/join semantics (handling custom schemes,
   * non-standard hosts, and raw formats without throwing on unusual inputs)
   * so that sanitised reference URLs remain consistent and deterministic.
   */



  class ExtractionError extends Error {
    constructor(message) {
      super(message);
      this.name = "ExtractionError";
    }
  }

  /**
   * Splits a URL into component parts: { scheme, netloc, path, query,
   * fragment, username, password, hostname, port }.
   */
  function urlsplit(url) {
    let rest = String(url);

    const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(rest);
    let scheme = "";
    if (schemeMatch) {
      // A leading "//" means authority follows; otherwise it is a scheme part.
      const after = rest.slice(schemeMatch[0].length);
      if (after.startsWith("//") || !after.startsWith(":")) {
        scheme = schemeMatch[1];
        rest = after;
        if (scheme.toLowerCase() === "file") {
          // file:// keeps no authority semantics we depend on.
          rest = after;
        }
      }
    }

    let netloc = "";
    let authorityEnd = -1;
    if (rest.startsWith("//")) {
      const searchFrom = 2;
      const limits = [
        rest.indexOf("/", searchFrom),
        rest.indexOf("?", searchFrom),
        rest.indexOf("#", searchFrom),
      ].filter((index) => index !== -1);
      authorityEnd = limits.length ? Math.min(...limits) : rest.length;
      netloc = rest.slice(2, authorityEnd);
      rest = rest.slice(authorityEnd);
    }

    let fragment = "";
    const hashIndex = rest.indexOf("#");
    if (hashIndex !== -1) {
      fragment = rest.slice(hashIndex + 1);
      rest = rest.slice(0, hashIndex);
    }

    let query = "";
    const questionIndex = rest.indexOf("?");
    if (questionIndex !== -1) {
      query = rest.slice(questionIndex + 1);
      rest = rest.slice(0, questionIndex);
    }

    const path = rest;

    let hostname = "";
    let port = "";
    let username = "";
    let password = "";
    if (netloc) {
      let hostPart = netloc;
      const at = hostPart.lastIndexOf("@");
      if (at !== -1) {
        const userinfo = hostPart.slice(0, at);
        hostPart = hostPart.slice(at + 1);
        const colon = userinfo.indexOf(":");
        if (colon === -1) {
          username = userinfo;
        } else {
          username = userinfo.slice(0, colon);
          password = userinfo.slice(colon + 1);
        }
      }
      if (hostPart.startsWith("[")) {
        const close = hostPart.indexOf("]");
        hostname = hostPart.slice(0, close + 1);
        const portCandidate = hostPart.slice(close + 1);
        if (portCandidate.startsWith(":")) port = portCandidate.slice(1);
      } else {
        const colon = hostPart.indexOf(":");
        if (colon === -1) {
          hostname = hostPart;
        } else {
          hostname = hostPart.slice(0, colon);
          port = hostPart.slice(colon + 1);
        }
      }
    }

    return {
      scheme,
      netloc,
      path,
      query,
      fragment,
      username,
      password,
      hostname: hostname ? hostname.toLowerCase() : "",
      port,
    };
  }

  /** Scheme catalogue — schemes that always maintain an authority. */
  const USES_NETLOC = [
    "",
    "ftp",
    "http",
    "gopher",
    "nntp",
    "telnet",
    "imap",
    "wais",
    "file",
    "mms",
    "https",
    "snews",
    "prospero",
  ];

  /** Reassembles URL components: [scheme, netloc, path, query, fragment]. */
  function urlunsplit([scheme, netloc, path, query, fragment]) {
    let url = path;
    if (netloc || url.slice(0, 2) === "//" || (scheme && USES_NETLOC.includes(scheme) && url.slice(0, 1) !== "/")) {
      if (url && url.slice(0, 1) !== "/") url = `/${url}`;
      url = `//${netloc || ""}${url}`;
    }
    if (scheme) url = `${scheme}:${url}`;
    if (query) url = `${url}?${query}`;
    if (fragment) url = `${url}#${fragment}`;
    return url;
  }

  const URL_RE = /https?:\/\/[^\s<>[\]"']+/gu;

  /**
   * Sanitizes reference URLs: drop ChatGPT's private/redirect-only
   * destinations and strip its referral parameter, keeping everything else
   * verbatim so the archived URL is the one a human can actually open.
   */
  function sanitizeReferenceUrl(url) {
    const trimmed = unescapeHtml(String(url).trim());

    let parts;
    try {
      parts = urlsplit(trimmed);
    } catch {
      return "";
    }

    const scheme = parts.scheme.toLowerCase();
    if (scheme !== "http" && scheme !== "https") return "";
    if (!parts.netloc) return "";

    const host = (parts.hostname || "").toLowerCase();
    const path = parts.path.toLowerCase();

    // Never expose ChatGPT's private/internal file and backend destinations.
    if ((host === "chatgpt.com" && path.startsWith("/backend-api/")) ||
        host.endsWith(".oaiusercontent.com") ||
        host.endsWith(".blob.core.windows.net")) {
      return "";
    }

    const pairs = parseQsl(parts.query).filter(
      ([key, value]) => !(key.toLowerCase() === "utm_source" && value.toLowerCase() === "chatgpt.com"),
    );
    const query = urlEncode(pairs);

    return urlunsplit([parts.scheme, parts.netloc, parts.path, query, parts.fragment]);
  }

  /** Strips trailing punctuation (`.,;:!?)`) applied to each URL candidate from prose. */
  function extractUrlsFromText(text) {
    const found = [];
    const re = new RegExp(URL_RE.source, URL_RE.flags);
    let match;
    while ((match = re.exec(text)) !== null) {
      found.push(sanitizeReferenceUrl(match[0].replace(/[.,;:!?)]+$/gu, "")));
    }
    return found;
  }

  /* ===== src/core/zip.js ===== */
  /*
   * ZIP writer/reader.
   *
   * Both deliverables are ZIP containers: the permanent `archive/*.zip` and the
   * DOCX itself (an OPC package is a ZIP of XML parts). The tool writes with
   * deflate compression and verifies archives with CRC-32 integrity checks on
   * read rather than trusting container metadata blindly.
   *
   * Deflate comes from the platform `CompressionStream("deflate-raw")`. Where
   * that API is missing (older Safari/Firefox) the writer degrades to `STORE`
   * entries, which are still valid ZIP/DOCX — only size changes, never content.
   */



  let CRC_TABLE = null;

  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
    return CRC_TABLE;
  }

  /** CRC-32/ISO-HDLC checksum calculation. */
  function crc32(bytes, seed = 0) {
    const table = crcTable();
    let crc = (~seed) >>> 0;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (~crc) >>> 0;
  }

  const METHOD_STORE = 0;
  const METHOD_DEFLATE = 8;
  const UTF8_FLAG = 0x0800;

  function supportsDeflate() {
    return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
  }

  async function deflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** `time.localtime()[:6]` packed the way ZIP stores it. */
  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
    return { dosDate, dosTime };
  }

  function isAscii(text) {
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) > 0x7f) return false;
    }
    return true;
  }

  /**
   * Build a ZIP archive.
   *
   * @param {Array<{name: string, data: Uint8Array}>} entries written in order
   * @param {{date?: Date, deflate?: boolean}} [options]
   * @returns {Promise<Uint8Array>}
   */
  async function createZip(entries, options = {}) {
    const date = options.date ?? new Date();
    const useDeflate = (options.deflate ?? true) && supportsDeflate();
    const { dosDate, dosTime } = dosDateTime(date);

    const chunks = [];
    const central = [];
    let offset = 0;

    const push = (bytes) => {
      chunks.push(bytes);
      offset += bytes.length;
    };

    for (const entry of entries) {
      const nameBytes = new TextEncoder().encode(entry.name);
      const flags = isAscii(entry.name) ? 0 : UTF8_FLAG;
      const uncompressed = entry.data;

      let method = METHOD_STORE;
      let payload = uncompressed;
      if (useDeflate && uncompressed.length > 0) {
        const deflated = await deflateRaw(uncompressed);
        // Keep STORE only when deflate would inflate the payload, which is what
        // a competent writer does; the entry stays readable either way.
        if (deflated.length < uncompressed.length) {
          method = METHOD_DEFLATE;
          payload = deflated;
        }
      }

      const crc = crc32(uncompressed);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(localHeader.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true); // version needed to extract (2.0)
      view.setUint16(6, flags, true);
      view.setUint16(8, method, true);
      view.setUint16(10, dosTime, true);
      view.setUint16(12, dosDate, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, payload.length, true);
      view.setUint32(22, uncompressed.length, true);
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, 0, true); // extra length
      localHeader.set(nameBytes, 30);

      const localHeaderOffset = offset;
      push(localHeader);
      push(payload);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true); // version made by (MS-DOS, 2.0)
      centralView.setUint16(6, 20, true); // version needed
      centralView.setUint16(8, flags, true);
      centralView.setUint16(10, method, true);
      centralView.setUint16(12, dosTime, true);
      centralView.setUint16(14, dosDate, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, payload.length, true);
      centralView.setUint32(24, uncompressed.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true); // extra
      centralView.setUint16(32, 0, true); // comment
      centralView.setUint16(34, 0, true); // disk number start
      centralView.setUint16(36, 0, true); // internal attributes
      centralView.setUint32(38, 0, true); // external attributes (matches zipfile.writestr)
      centralView.setUint32(42, localHeaderOffset, true);
      centralHeader.set(nameBytes, 46);
      central.push(centralHeader);
    }

    const centralStart = offset;
    for (const header of central) push(header);
    const centralSize = offset - centralStart;

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, entries.length, true);
    eocdView.setUint16(10, entries.length, true);
    eocdView.setUint32(12, centralSize, true);
    eocdView.setUint32(16, centralStart, true);
    eocdView.setUint16(20, 0, true);
    push(eocd);

    const output = new Uint8Array(offset);
    let cursor = 0;
    for (const chunk of chunks) {
      output.set(chunk, cursor);
      cursor += chunk.length;
    }
    return output;
  }

  /** Minimal read-only ZIP view: names, raw bytes, and CRC verification. */
  class ZipArchive {
    constructor(bytes) {
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.entries = this.#readCentralDirectory();
    }

    #readCentralDirectory() {
      const { bytes, view } = this;
      const min = 22;
      const max = Math.min(bytes.length, 22 + 65535);
      let eocd = -1;
      for (let i = bytes.length - min; i >= bytes.length - max && i >= 0; i -= 1) {
        if (view.getUint32(i, true) === 0x06054b50) {
          eocd = i;
          break;
        }
      }
      if (eocd === -1) throw new ExtractionError("Archive is not a valid ZIP file");

      const count = view.getUint16(eocd + 10, true);
      const centralOffset = view.getUint32(eocd + 16, true);
      if (count === 0xffff || centralOffset === 0xffffffff) {
        throw new ExtractionError("ZIP64 archives are not supported");
      }

      const entries = [];
      let cursor = centralOffset;
      for (let index = 0; index < count; index += 1) {
        if (view.getUint32(cursor, true) !== 0x02014b50) {
          throw new ExtractionError("Archive central directory is corrupt");
        }
        const method = view.getUint16(cursor + 10, true);
        const expectedCrc = view.getUint32(cursor + 16, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const uncompressedSize = view.getUint32(cursor + 24, true);
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        const localOffset = view.getUint32(cursor + 42, true);
        const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
        entries.push({ name, method, expectedCrc, compressedSize, uncompressedSize, localOffset });
        cursor += 46 + nameLength + extraLength + commentLength;
      }
      return entries;
    }

    /** `ZipFile.namelist()` */
    namelist() {
      return this.entries.map((entry) => entry.name);
    }

    has(name) {
      return this.entries.some((entry) => entry.name === name);
    }

    /** `ZipFile.read(name)` with CRC verification and inflate as required. */
    async read(name) {
      const entry = this.entries.find((item) => item.name === name);
      if (!entry) throw new ExtractionError(`Archive does not contain ${name}`);

      const { bytes, view } = this;
      if (view.getUint32(entry.localOffset, true) !== 0x04034b50) {
        throw new ExtractionError(`Archive local header for ${name} is corrupt`);
      }
      const nameLength = view.getUint16(entry.localOffset + 26, true);
      const extraLength = view.getUint16(entry.localOffset + 28, true);
      const dataStart = entry.localOffset + 30 + nameLength + extraLength;
      const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize);

      let data;
      if (entry.method === METHOD_STORE) {
        data = raw;
      } else if (entry.method === METHOD_DEFLATE) {
        if (typeof DecompressionStream !== "function") {
          throw new ExtractionError("This browser cannot decompress the archive");
        }
        data = await inflateRaw(raw);
      } else {
        throw new ExtractionError(`Unsupported ZIP compression method ${entry.method} for ${name}`);
      }

      if (data.length !== entry.uncompressedSize) {
        throw new ExtractionError(`Archive verification failed for member: ${name}`);
      }
      if (crc32(data) !== entry.expectedCrc) {
        throw new ExtractionError(`Archive verification failed for member: ${name}`);
      }
      return data;
    }

    /**
     * `testzip()`: read every member and return the first bad name.
     * Directories are skipped during CRC integrity checking.
     */
    async testzip() {
      for (const entry of this.entries) {
        if (entry.name.endsWith("/")) continue;
        try {
          await this.read(entry.name);
        } catch {
          return entry.name;
        }
      }
      return null;
    }
  }

  /* ===== src/core/images.js ===== */
  /*
   * Image format sniffing: dimensions and display sizing.
   *
   * Formats are identified by examining magic header bytes directly rather than
   * trusting filename extensions or metadata labels, preventing corrupt Word parts.
   */



  const IMAGE_FORMATS = {
    png: { extension: "png", contentType: "image/png" },
    jpeg: { extension: "jpg", contentType: "image/jpeg" },
    gif: { extension: "gif", contentType: "image/gif" },
    webp: { extension: "webp", contentType: "image/webp" },
  };

  const be16 = (data, at) => (data[at] << 8) | data[at + 1];
  const be32 = (data, at) => ((data[at] * 256 + data[at + 1]) * 256 + data[at + 2]) * 256 + data[at + 3];
  const le16 = (data, at) => data[at] | (data[at + 1] << 8);
  const le24 = (data, at) => data[at] | (data[at + 1] << 8) | (data[at + 2] << 16);

  /** PNG: validate the signature and read width/height from the IHDR chunk. */
  function pngDimensions(data) {
    if (!data || data.length < 24) return null;
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < 8; i += 1) {
      if (data[i] !== signature[i]) return null;
    }
    if (data[12] !== 0x49 || data[13] !== 0x48 || data[14] !== 0x44 || data[15] !== 0x52) return null;

    const width = be32(data, 16);
    const height = be32(data, 20);
    if (width <= 0 || height <= 0) return null;
    return [width, height];
  }

  /** JPEG: walk the marker segments until a Start-Of-Frame carries dimensions. */
  function jpegDimensions(data) {
    if (!data || data.length < 4) return null;
    if (data[0] !== 0xff || data[1] !== 0xd8) return null;

    const sofMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);
    const standalone = new Set([0x01]);
    for (let marker = 0xd0; marker <= 0xd9; marker += 1) standalone.add(marker);

    let i = 2;
    while (i < data.length) {
      // JPEG markers begin with one or more 0xFF bytes.
      if (data[i] !== 0xff) {
        i += 1;
        continue;
      }
      while (i < data.length && data[i] === 0xff) i += 1;
      if (i >= data.length) return null;

      const marker = data[i];
      i += 1;

      // Standalone markers have no length field.
      if (standalone.has(marker)) continue;
      // End Of Image or Start Of Scan before a SOF means no usable dimensions.
      if (marker === 0xd9 || marker === 0xda) return null;
      if (i + 2 > data.length) return null;

      const segmentLength = be16(data, i);
      if (segmentLength < 2 || i + segmentLength > data.length) return null;

      if (sofMarkers.has(marker)) {
        if (segmentLength < 7) return null;
        const height = be16(data, i + 3);
        const width = be16(data, i + 5);
        if (width <= 0 || height <= 0) return null;
        return [width, height];
      }
      i += segmentLength;
    }
    return null;
  }

  /** GIF: logical screen descriptor. */
  function gifDimensions(data) {
    if (!data || data.length < 10) return null;
    const head = String.fromCharCode(data[0], data[1], data[2], data[3], data[4], data[5]);
    if (head !== "GIF87a" && head !== "GIF89a") return null;
    const width = le16(data, 6);
    const height = le16(data, 8);
    if (width <= 0 || height <= 0) return null;
    return [width, height];
  }

  /** WebP: Extended, Lossless and Lossy variants all encode size differently. */
  function webpDimensions(data) {
    if (!data || data.length < 16) return null;
    const fourcc = (at) => String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]);
    if (fourcc(0) !== "RIFF" || fourcc(8) !== "WEBP") return null;

    const chunkType = fourcc(12);
    let width;
    let height;

    if (chunkType === "VP8X") {
      if (data.length < 30) return null;
      width = 1 + le24(data, 24);
      height = 1 + le24(data, 27);
    } else if (chunkType === "VP8L") {
      if (data.length < 25 || data[20] !== 0x2f) return null;
      const bits = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    } else if (chunkType === "VP8 ") {
      if (data.length < 30) return null;
      if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) return null;
      width = le16(data, 26) & 0x3fff;
      height = le16(data, 28) & 0x3fff;
    } else {
      return null;
    }

    if (width <= 0 || height <= 0) return null;
    return [width, height];
  }

  /**
   * `image_info`: identify a supported saved image from its actual bytes.
   * @returns {{format: string, extension: string, contentType: string, dimensions: [number, number]}|null}
   */
  function imageInfo(data) {
    if (!data) return null;

    let dimensions = pngDimensions(data);
    if (dimensions) return { format: "png", ...IMAGE_FORMATS.png, dimensions };

    dimensions = jpegDimensions(data);
    if (dimensions) return { format: "jpeg", ...IMAGE_FORMATS.jpeg, dimensions };

    dimensions = gifDimensions(data);
    if (dimensions) return { format: "gif", ...IMAGE_FORMATS.gif, dimensions };

    dimensions = webpDimensions(data);
    if (dimensions) return { format: "webp", ...IMAGE_FORMATS.webp, dimensions };

    return null;
  }

  /**
   * `image_display_size_emu`: 96 DPI, capped at 7 inches wide so a large
   * screenshot never runs off the page.
   */
  function imageDisplaySizeEmu(dimensions) {
    if (!dimensions) return null;
    const [widthPx, heightPx] = dimensions;
    const emuPerInch = 914400;
    const pixelsPerInch = 96;
    const maxWidthEmu = 6400800; // 7.0 inches

    let widthEmu = pyRound((widthPx * emuPerInch) / pixelsPerInch);
    let heightEmu = pyRound((heightPx * emuPerInch) / pixelsPerInch);

    if (widthEmu > maxWidthEmu) {
      const scale = maxWidthEmu / widthEmu;
      widthEmu = maxWidthEmu;
      heightEmu = pyRound(heightEmu * scale);
    }
    return [widthEmu, heightEmu];
  }

  /* ===== src/core/filenames.js ===== */
  /*
   * Filesystem-safe naming: `sanitizeFilesystemBasename` and
   * `validateOutputPath`.
   *
   * These rules exist because the generated name is reused for a `.zip` and a
   * `.docx`, on Windows as well as POSIX, and the archive is *permanent*: a name
   * that truncates differently per extension, or that collides with `CON`,
   * destroys the pairing that lets a DOCX be regenerated later.
   */




  const PATH_BUDGET = 240;

  const ILLEGAL = new Set(['<', '>', ':', '"', '/', "\\", '|', '?', '*']);

  const RESERVED_NAMES = new Set([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "CONIN$",
    "CONOUT$",
    ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
    "COM¹",
    "COM²",
    "COM³",
    "LPT¹",
    "LPT²",
    "LPT³",
  ]);

  function isReserved(value) {
    const deviceName = value.split(".", 1)[0];
    return RESERVED_NAMES.has(deviceName.toUpperCase());
  }

  function protectReservedName(value) {
    if (!isReserved(value)) return value;
    const dot = value.indexOf(".");
    const deviceName = dot === -1 ? value : value.slice(0, dot);
    const separator = dot === -1 ? "" : ".";
    const remainder = dot === -1 ? "" : value.slice(dot + 1);
    const guarded = `${deviceName} Chat`;
    return separator ? `${guarded}.${remainder}` : guarded;
  }

  /** Return a portable filesystem basename derived from a conversation title. */
  function sanitizeFilesystemBasename(title) {
    let name = String(title ?? "").normalize("NFC");

    name = Array.from(name)
      .map((char) => (ILLEGAL.has(char) || char.codePointAt(0) <= 0x1f ? " " : char))
      .join("");

    // Normalize internal whitespace runs and trim
    name = name.replace(/\s+/gu, " ").trim();
    name = name.replace(/^\.+/u, "").replace(/\.+$/u, "");

    if (!name) name = "ChatGPT Conversation";

    name = protectReservedName(name);

    // Use the longer generated extension (.docx) when enforcing the 240-byte
    // complete-filename limit so the same basename is safe for .docx and .zip.
    const maxBasenameBytes = PATH_BUDGET - utf8ByteLength(".docx");
    let codePoints = Array.from(name);
    while (codePoints.length > 120 || utf8ByteLength(name) > maxBasenameBytes) {
      codePoints.pop();
      name = codePoints.join("");
    }

    name = name.replace(/[ .]+$/u, "");

    if (!name) name = "ChatGPT Conversation";
    name = protectReservedName(name);
    return name;
  }

  /**
   * Enforce the portable path-safety limit on the output path (`docx/<name>.docx`).
   */
  function validateOutputPath(dir, basename, extension) {
    const composed = `${dir}/${basename}.${extension}`;
    if (composed.length > PATH_BUDGET) {
      throw new ExtractionError(
        "The output path is too long for ChatGPT Conversation Bridge's portable " +
          "path-safety limit.\n" +
          `Path length: ${composed.length} characters\n` +
          `Maximum: ${PATH_BUDGET} characters\n` +
          `Path: ${composed}\n` +
          "Shorten the conversation title and try again.",
      );
    }
    return composed;
  }

  /* ===== src/core/timefmt.js ===== */
  /*
   * Timestamp formatting — `format_message_timestamp`.
   *
   * Formats `%Y-%m-%d %I:%M:%S %p %Z` in the machine's local zone.
   * `Date` is evaluated against the host zone database, DST-aware per instant,
   * and `Intl` supplies the zone abbreviation for that specific instant.
   */

  const pad2 = (value) => String(value).padStart(2, "0");

  let abbreviationFormatter = null;

  function timeZoneAbbreviation(date) {
    if (!abbreviationFormatter) {
      try {
        abbreviationFormatter = new Intl.DateTimeFormat(undefined, {
          timeZoneName: "short",
          hour: "2-digit",
        });
      } catch {
        abbreviationFormatter = null;
      }
    }
    if (!abbreviationFormatter) return "";
    const parts = abbreviationFormatter.formatToParts(date);
    const found = parts.find((part) => part.type === "timeZoneName");
    return found ? found.value : "";
  }

  /** `2026-04-18 09:07:03 AM IST` style timestamp. */
  function formatMessageTimestamp(timestamp) {
    if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) return "";
    const date = new Date(timestamp * 1000);
    if (Number.isNaN(date.getTime())) return "";

    let hours = date.getHours();
    const meridiem = hours >= 12 ? "PM" : "AM";
    hours %= 12;
    if (hours === 0) hours = 12;

    const abbreviation = timeZoneAbbreviation(date);
    const stamp = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
      `${pad2(hours)}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${meridiem}`;

    return abbreviation ? `${stamp} ${abbreviation}` : stamp;
  }

  /* ===== src/core/ooxml.js ===== */
  /*
   * OOXML primitives (`wtag`/`add_run`/`_new_paragraph`/`add_inline_image`).
   *
   * Word's schema is strict about element *content*; standard element orderings
   * (for example `w:shd` before `w:sz`, and `w:tblHeader` on the first row) are
   * maintained so that both Word and LibreOffice render the document cleanly.
   */



  const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";

  /** Namespace declarations hoisted onto the document root. */
  const DOCUMENT_NAMESPACES = [
    ["xmlns:w", W_NS],
    ["xmlns:r", R_NS],
    ["xmlns:wp", WP_NS],
    ["xmlns:a", A_NS],
    ["xmlns:pic", PIC_NS],
  ];

  /**
   * Minimal XML node with ordered attributes — enough to reproduce
   * `ET.SubElement`/`Element.set`/`ET.tostring` deterministically.
   */
  class XmlNode {
    constructor(tag) {
      this.tag = tag;
      this.attributes = [];
      this.children = [];
      this.text = null;
    }

    set(name, value) {
      const existing = this.attributes.find(([key]) => key === name);
      if (existing) {
        existing[1] = String(value);
      } else {
        this.attributes.push([name, String(value)]);
      }
      return this;
    }

    append(child) {
      this.children.push(child);
      return child;
    }

    find(tag) {
      return this.children.find((child) => child.tag === tag) ?? null;
    }

    serialize() {
      const attrs = this.attributes
        .map(([name, value]) => ` ${name}="${escapeXmlAttr(value)}"`)
        .join("");

      const hasText = typeof this.text === "string" && this.text !== "";
      if (!this.children.length && !hasText) return `<${this.tag}${attrs}/>`;

      let inner = hasText ? escapeXmlText(this.text) : "";
      for (const child of this.children) inner += child.serialize();
      return `<${this.tag}${attrs}>${inner}</${this.tag}>`;
    }
  }

  function element(parent, tag) {
    const node = new XmlNode(tag);
    if (parent) parent.append(node);
    return node;
  }

  function xmlDeclaration() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  }

  function serializeDocument(root) {
    return xmlDeclaration() + root.serialize();
  }

  const XML_SPACE = "xml:space";

  /** `add_run` — a single formatted Word run; empty text emits nothing at all. */
  function addRun(p, text, options = {}) {
    const { bold = false, italic = false, size = 21, font = "Aptos", shade = null, color = null } = options;
    if (!text) return null;

    const r = element(p, "w:r");
    const rpr = element(r, "w:rPr");

    const fonts = element(rpr, "w:rFonts");
    fonts.set("w:ascii", font);
    fonts.set("w:hAnsi", font);

    if (bold) element(rpr, "w:b");
    if (italic) element(rpr, "w:i");
    if (color) element(rpr, "w:color").set("w:val", color);
    if (shade) {
      const shd = element(rpr, "w:shd");
      shd.set("w:val", "clear");
      shd.set("w:fill", shade);
    }
    for (const tag of ["w:sz", "w:szCs"]) element(rpr, tag).set("w:val", String(size));

    const t = element(r, "w:t");
    t.set(XML_SPACE, "preserve");
    t.text = cleanXmlText(text);
    return r;
  }

  /** `_new_paragraph` — paragraph with spacing/indent/shading options. */
  function newParagraph(body, options = {}) {
    const { before = 0, after = 120, left = 0, right = 0, shade = null, keepNext = false } = options;

    const p = element(body, "w:p");
    const ppr = element(p, "w:pPr");
    const spacing = element(ppr, "w:spacing");
    spacing.set("w:before", String(before));
    spacing.set("w:after", String(after));

    if (left || right) {
      const ind = element(ppr, "w:ind");
      if (left) ind.set("w:left", String(left));
      if (right) ind.set("w:right", String(right));
    }
    if (shade) {
      const shd = element(ppr, "w:shd");
      shd.set("w:val", "clear");
      shd.set("w:fill", shade);
    }
    if (keepNext) element(ppr, "w:keepNext");
    return p;
  }

  /**
   * `add_message_body_container` — the message body is a borderless one-cell
   * table, because that is the only way to get full-width background shading in
   * Word without painting the whole page.
   */
  function addMessageBodyContainer(body, shadeColor) {
    const tbl = element(body, "w:tbl");
    const tblPr = element(tbl, "w:tblPr");

    const width = element(tblPr, "w:tblW");
    width.set("w:w", "0");
    width.set("w:type", "auto");

    const borders = element(tblPr, "w:tblBorders");
    for (const edge of ["top", "left", "bottom", "right", "insideH", "insideV"]) {
      element(borders, `w:${edge}`).set("w:val", "nil");
    }

    const tr = element(tbl, "w:tr");
    const tc = element(tr, "w:tc");
    const tcPr = element(tc, "w:tcPr");

    const shade = element(tcPr, "w:shd");
    shade.set("w:val", "clear");
    shade.set("w:fill", shadeColor);

    return tc;
  }

  /** `add_paragraph` — literal line breaks become real Word `<w:br/>`. */
  function addParagraph(body, text = "", options = {}) {
    const {
      bold = false,
      italic = false,
      size = 21,
      before = 0,
      after = 120,
      left = 0,
      right = 0,
      shade = null,
      font = "Aptos",
    } = options;

    const p = newParagraph(body, { before, after, left, right, shade });
    const source = cleanXmlText(unescapeHtml(text));
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      if (index) {
        const br = element(p, "w:r");
        element(br, "w:br");
      }
      addRun(p, line, { bold, italic, size, font });
    });
    return p;
  }

  /** `add_inline_image` — one floating-free inline drawing in its own paragraph. */
  function addInlineImage(body, relationshipId, widthEmu, heightEmu, drawingId) {
    const p = newParagraph(body, { after: 120 });
    const r = element(p, "w:r");
    const drawing = element(r, "w:drawing");

    const inline = element(drawing, "wp:inline");
    inline.set("distT", "0");
    inline.set("distB", "0");
    inline.set("distL", "0");
    inline.set("distR", "0");

    const extent = element(inline, "wp:extent");
    extent.set("cx", String(widthEmu));
    extent.set("cy", String(heightEmu));

    const effectExtent = element(inline, "wp:effectExtent");
    for (const side of ["l", "t", "r", "b"]) effectExtent.set(side, "0");

    const docPr = element(inline, "wp:docPr");
    docPr.set("id", String(drawingId));
    docPr.set("name", `Picture ${drawingId}`);
    docPr.set("descr", "Uploaded image");

    const framePr = element(inline, "wp:cNvGraphicFramePr");
    element(framePr, "a:graphicFrameLocks").set("noChangeAspect", "1");

    const graphic = element(inline, "a:graphic");
    const graphicData = element(graphic, "a:graphicData");
    graphicData.set("uri", "http://schemas.openxmlformats.org/drawingml/2006/picture");

    const pic = element(graphicData, "pic:pic");

    const nvPicPr = element(pic, "pic:nvPicPr");
    const cNvPr = element(nvPicPr, "pic:cNvPr");
    cNvPr.set("id", "0");
    cNvPr.set("name", `Picture ${drawingId}`);
    element(nvPicPr, "pic:cNvPicPr");

    const blipFill = element(pic, "pic:blipFill");
    element(blipFill, "a:blip").set("r:embed", relationshipId);
    const stretch = element(blipFill, "a:stretch");
    element(stretch, "a:fillRect");

    const spPr = element(pic, "pic:spPr");
    const xfrm = element(spPr, "a:xfrm");
    const off = element(xfrm, "a:off");
    off.set("x", "0");
    off.set("y", "0");
    const ext = element(xfrm, "a:ext");
    ext.set("cx", String(widthEmu));
    ext.set("cy", String(heightEmu));

    const geometry = element(spPr, "a:prstGeom");
    geometry.set("prst", "rect");
    element(geometry, "a:avLst");
    return p;
  }

  /** `add_message_header` — the YOU / GPT badge plus a local-time stamp. */
  function addMessageHeader(body, role, timestampText) {
    const p = newParagraph(body, { before: 160, after: 60, keepNext: true });
    if (role === "user") {
      addRun(p, " YOU ", { bold: true, size: 20, color: "000000", shade: "FA7E33" });
    } else {
      addRun(p, " GPT ", { bold: true, size: 20, color: "FFFFFF", shade: "008000" });
    }
    if (timestampText) addRun(p, `  ${timestampText}`, { size: 16, color: "666666" });
    return p;
  }

  /** Rule, matching `add_rule`. */
  function addRule(body) {
    const p = newParagraph(body, { before: 80, after: 100 });
    const ppr = p.find("w:pPr");
    const borders = element(ppr, "w:pBdr");
    const bottom = element(borders, "w:bottom");
    bottom.set("w:val", "single");
    bottom.set("w:sz", "4");
    bottom.set("w:space", "1");
    bottom.set("w:color", "D9D9D9");
    return p;
  }

  /** Shaded, monospaced fenced code block, matching `add_code_block`. */
  function addCodeBlock(body, lines, language = "") {
    if (language) {
      const header = newParagraph(body, { before: 80, after: 0, left: 288, right: 288, shade: "E3E3E3", keepNext: true });
      addRun(header, language, { size: 17 });
    }
    const p = newParagraph(body, { before: language ? 0 : 80, after: 140, left: 288, right: 288, shade: "F2F2F2" });
    lines.forEach((line, index) => {
      if (index) {
        const br = element(p, "w:r");
        element(br, "w:br");
      }
      addRun(p, line || " ", { size: 18, font: "Consolas" });
    });
    return p;
  }

  /* ===== src/core/markdown.js ===== */
  /*
   * Markdown → OOXML transformation pipeline: `addMarkdown`, `addInlineMarkdown`,
   * `addMarkdownTable`, fence matching, escaping protection, and
   * private-use-token cleaners.
   *
   * Key implementation considerations:
   *
   * 1. ChatGPT embeds invisible control tokens in the shared JSON (U+E200 …
   *    U+E201 wrapping `filecite`, `memcite`, `cite`, `message_reaction`, `url`).
   *    They are transport artifacts, so they are stripped before rendering —
   *    otherwise the DOCX fills with glyph boxes.
   * 2. Backslash escapes must survive parsing. Swaps each
   *    `\punct` pair for a private-use sentinel (U+E100+n), parses Markdown, then
   *    restores literals.
   * 3. Regex boundary and newline nuances:
   *      - Character class `[^\]\n]` properly escapes `]`.
   *      - Lines can end with `\n` (from a `<br>` placeholder), so every
   *        end-anchored pattern below uses `(?=\n?$)`.
   *      - Dot matches and flags are set per-pattern for exact token boundaries.
   */





  /** Sentinel that parks an HTML <br> inside one logical Markdown line. */
  const BR_PLACEHOLDER = String.fromCodePoint(0xe000);

  /** Set of escapable markdown punctuation characters. */
  const MARKDOWN_ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
  const MARKDOWN_ESCAPE_BASE = 0xe100;

  const ESCAPE_TO_SENTINEL = new Map(
    Array.from(MARKDOWN_ESCAPABLE, (char, index) => [
      char,
      String.fromCodePoint(MARKDOWN_ESCAPE_BASE + index),
    ]),
  );
  const SENTINEL_TO_LITERAL = new Map(Array.from(ESCAPE_TO_SENTINEL, ([char, sentinel]) => [sentinel, char]));

  /** `protect_markdown_escapes` */
  function protectMarkdownEscapes(text) {
    let out = "";
    let i = 0;
    while (i < text.length) {
      if (text[i] === "`") {
        const end = text.indexOf("`", i + 1);
        if (end !== -1) {
          // Inline code spans are literal: backslash escapes are not interpreted.
          out += text.slice(i, end + 1);
          i = end + 1;
          continue;
        }
      }
      if (text[i] === "\\" && i + 1 < text.length && ESCAPE_TO_SENTINEL.has(text[i + 1])) {
        out += ESCAPE_TO_SENTINEL.get(text[i + 1]);
        i += 2;
        continue;
      }
      out += text[i];
      i += 1;
    }
    return out;
  }

  /** `restore_markdown_escapes` */
  function restoreMarkdownEscapes(text) {
    let out = "";
    for (const ch of text) out += SENTINEL_TO_LITERAL.get(ch) ?? ch;
    return out;
  }

  const PU_OPEN = "\\u{e200}";
  const PU_MID = "\\u{e202}";
  const PU_CLOSE = "\\u{e201}";

  /** ChatGPT's private-use citation/reaction/reference wrappers. */
  const INTERNAL_CITATION_RE = () =>
    new RegExp(`\\s*${PU_OPEN}(?:filecite|memcite|cite)(?:${PU_MID}[^${PU_CLOSE}]*)?${PU_CLOSE}`, "gu");
  const MESSAGE_REACTION_RE = () =>
    new RegExp(`\\s*${PU_OPEN}message_reaction${PU_MID}[^${PU_CLOSE}]*${PU_CLOSE}`, "gu");
  const URL_REFERENCE_RE = () =>
    new RegExp(`${PU_OPEN}url${PU_MID}([^${PU_MID}${PU_CLOSE}]*)${PU_MID}[^${PU_CLOSE}]*${PU_CLOSE}`, "gu");

  /** `stripInternalCitations` — removes internal citation tokens in order. */
  function stripInternalCitations(text) {
    return text
      .replace(INTERNAL_CITATION_RE(), "")
      .replace(MESSAGE_REACTION_RE(), "")
      .replace(URL_REFERENCE_RE(), "$1");
  }

  const LOOKBEHIND_SUPPORTED = (() => {
    try {
      new RegExp("(?<=a)b");
      return true;
    } catch {
      return false;
    }
  })();

  /**
   * `INLINE_RE`:
   *   autolink-ish label | code span | bold+italic | bold | italic
   * The `*`-emphasis alternative needs lookbehind. Engines without it (very old
   * Safari) keep every other construct and simply skip star emphasis, which is a
   * formatting downgrade rather than a failed export.
   */
  const INLINE_WITH_LOOKBEHIND =
    "\\[[^\\]\\n]+\\]\\([^)\\n]+\\)|" +
    "`[^`\\n]+`|" +
    "\\*\\*\\*.*?\\*\\*\\*|___.*?___|" +
    "\\*\\*.*?\\*\\*|__.*?__|" +
    "(?<!\\*)\\*(?![\\s*])[^*\\n]*?(?<!\\s)\\*(?!\\*)|" +
    "(?<![\\w_])_[^_\\n]+_(?![\\w_])";

  const INLINE_WITHOUT_LOOKBEHIND =
    "\\[[^\\]\\n]+\\]\\([^)\\n]+\\)|`[^`\\n]+`|\\*\\*\\*.*?\\*\\*\\*|___.*?___|\\*\\*.*?\\*\\*|__.*?__";

  function inlineRegex() {
    const source = LOOKBEHIND_SUPPORTED ? INLINE_WITH_LOOKBEHIND : INLINE_WITHOUT_LOOKBEHIND;
    return new RegExp(`(${source})`, "gs");
  }

  /** `_add_plain_inline` */
  function addPlainInline(p, text, { size = 21, bold = false, italic = false } = {}) {
    const parts = text.split("\n");
    parts.forEach((part, index) => {
      if (index) {
        const br = element(p, "w:r");
        element(br, "w:br");
      }
      addRun(p, restoreMarkdownEscapes(part), { bold, italic, size });
    });
  }

  /** `add_inline_markdown` */
  function addInlineMarkdown(p, text, options = {}) {
    const { size = 21, baseBold = false, baseItalic = false } = options;
    const source = protectMarkdownEscapes(unescapeHtml(stripInternalCitations(text)));

    let pos = 0;
    const re = inlineRegex();
    let match;
    while ((match = re.exec(source)) !== null) {
      if (match.index > pos) {
        addPlainInline(p, source.slice(pos, match.index), { size, bold: baseBold, italic: baseItalic });
      }
      const token = match[0];

      if (token.startsWith("[")) {
        const linkMatch = /^\[([^\]]+)\]\((.*)\)$/.exec(token);
        if (linkMatch) {
          const label = restoreMarkdownEscapes(linkMatch[1]);
          const rawUrl = restoreMarkdownEscapes(linkMatch[2]);
          const cleanUrl = sanitizeReferenceUrl(rawUrl);
          addRun(p, label, { bold: baseBold, italic: baseItalic, size });
          // URL text is deliberately an ordinary Word run, never a real
          // hyperlink: an archival record must show where a link actually goes.
          if (cleanUrl && sanitizeReferenceUrl(label) !== cleanUrl) {
            addRun(p, ` (${cleanUrl})`, { bold: baseBold, italic: baseItalic, size });
          }
        } else {
          addRun(p, restoreMarkdownEscapes(token), { bold: baseBold, italic: baseItalic, size });
        }
      } else if (token.startsWith("`")) {
        addRun(p, restoreMarkdownEscapes(token.slice(1, -1)), {
          bold: baseBold,
          italic: baseItalic,
          size: Math.max(16, size - 1),
          font: "Consolas",
          shade: "EDEDED",
        });
      } else if (token.startsWith("***") || token.startsWith("___")) {
        addInlineMarkdown(p, token.slice(3, -3), { size, baseBold: true, baseItalic: true });
      } else if (token.startsWith("**") || token.startsWith("__")) {
        // Re-parse the contents so nested inline Markdown (for example bold text
        // containing `inline code`) is preserved instead of leaking delimiters.
        addInlineMarkdown(p, token.slice(2, -2), { size, baseBold: true, baseItalic });
      } else {
        addInlineMarkdown(p, token.slice(1, -1), { size, baseBold, baseItalic: true });
      }
      pos = match.index + token.length;
    }
    if (pos < source.length) {
      addPlainInline(p, source.slice(pos), { size, bold: baseBold, italic: baseItalic });
    }
    return p;
  }

  /** `_split_markdown_table_row` */
  function splitMarkdownTableRow(line) {
    let stripped = line.trim();
    if (stripped.startsWith("|")) stripped = stripped.slice(1);
    if (stripped.endsWith("|")) stripped = stripped.slice(0, -1);

    // Split only on pipes outside inline-code spans; escaped pipes have already
    // been turned into sentinels.
    const cells = [];
    let current = "";
    let inCode = false;
    for (const ch of stripped) {
      if (ch === "`") {
        inCode = !inCode;
        current += ch;
      } else if (ch === "|" && !inCode) {
        cells.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  }

  /** `_is_markdown_table_separator` */
  function isMarkdownTableSeparator(line) {
    const cells = splitMarkdownTableRow(line);
    return cells.length >= 1 && cells.every((cell) => /^:?-+:?$/.test(cell.replace(/ /g, "")));
  }

  /** `add_markdown_table` */
  function addMarkdownTable(body, rows) {
    if (!rows.length) return;
    // Empty one-cell tables are layout debris in pasted email content; keep
    // non-empty tables but do not draw Word borders for contentless ones.
    if (rows.every((row) => row.every((cell) => !cell.trim()))) return;

    const cols = Math.max(...rows.map((row) => row.length));
    const tbl = element(body, "w:tbl");
    const tblPr = element(tbl, "w:tblPr");

    const borders = element(tblPr, "w:tblBorders");
    for (const edge of ["top", "left", "bottom", "right", "insideH", "insideV"]) {
      const border = element(borders, `w:${edge}`);
      border.set("w:val", "single");
      border.set("w:sz", "4");
      border.set("w:color", "D9D9D9");
    }
    const width = element(tblPr, "w:tblW");
    width.set("w:w", "0");
    width.set("w:type", "auto");

    rows.forEach((row, rowIndex) => {
      const tr = element(tbl, "w:tr");
      if (rowIndex === 0) {
        const trPr = element(tr, "w:trPr");
        element(trPr, "w:tblHeader");
      }
      for (let colIndex = 0; colIndex < cols; colIndex += 1) {
        const tc = element(tr, "w:tc");
        const tcPr = element(tc, "w:tcPr");
        if (rowIndex === 0) {
          const shd = element(tcPr, "w:shd");
          shd.set("w:val", "clear");
          shd.set("w:fill", "F2F2F2");
        }
        const p = newParagraph(tc, { after: 40 });
        const cellText = (row[colIndex] ?? "").split(BR_PLACEHOLDER).join("\n");
        addInlineMarkdown(p, cellText, { size: 19, baseBold: rowIndex === 0 });
      }
    });
    newParagraph(body, { after: 80 });
  }

  /** `_fence_match` — CommonMark allows up to 3 spaces of fence indentation. */
  function fenceMatch(line) {
    const match = /^ {0,3}```(.*)$/.exec(line);
    return match ? { language: match[1].trim() } : null;
  }

  const HEADING_SIZES = { 1: 30, 2: 27, 3: 24, 4: 22, 5: 21, 6: 20 };

  /** `add_markdown` — the block parser that emits Word paragraphs and tables. */
  function addMarkdown(body, text, preserveSoftBreaks = false) {
    const cleaned = stripInternalCitations(text);
    // Keep HTML break tags inside one logical Markdown line until block
    // structures (especially pipe tables) have been recognised; converting them
    // to real line breaks too early can split a table row in the middle.
    const normalised = cleanXmlText(cleaned.replace(/<br\s*\/?>/gi, BR_PLACEHOLDER));
    const lines = normalised.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const protectedLines = lines.map((line) => protectMarkdownEscapes(line));

    let i = 0;
    while (i < lines.length) {
      const structuralLine = protectedLines[i];
      const line = structuralLine.split(BR_PLACEHOLDER).join("\n");

      const fence = fenceMatch(structuralLine);
      if (fence) {
        const { language } = fence;
        const code = [];
        i += 1;
        while (i < lines.length && !fenceMatch(protectedLines[i])) {
          code.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        addCodeBlock(body, code, language);
        continue;
      }

      if (!line.trim()) {
        i += 1;
        continue;
      }

      if (i + 1 < lines.length && structuralLine.includes("|") && isMarkdownTableSeparator(protectedLines[i + 1])) {
        const rows = [splitMarkdownTableRow(structuralLine)];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
          rows.push(splitMarkdownTableRow(protectedLines[i]));
          i += 1;
        }
        addMarkdownTable(body, rows);
        continue;
      }

      if (/^\s*---+\s*$/.test(line)) {
        addRule(body);
        i += 1;
        continue;
      }

      const heading = /^(#{1,6})\s+([^\n]*)(?=\n?$)/.exec(line);
      if (heading) {
        const level = heading[1].length;
        const p = newParagraph(body, {
          before: level <= 2 ? 180 : 120,
          after: 70,
          keepNext: true,
        });
        addInlineMarkdown(p, heading[2], { size: HEADING_SIZES[level], baseBold: true });
        i += 1;
        continue;
      }

      if (/^\s*>\s?([^\n]*)(?=\n?$)/.test(line)) {
        const quoteLines = [];
        while (i < lines.length) {
          const nested = /^\s*>\s?([^\n]*)(?=\n?$)/.exec(lines[i]);
          if (!nested) break;
          quoteLines.push(nested[1]);
          i += 1;
        }
        const p = newParagraph(body, { before: 50, after: 110, left: 360, right: 180, shade: "F7F7F7" });
        quoteLines.forEach((quoteLine, index) => {
          if (index) {
            const br = element(p, "w:r");
            element(br, "w:br");
          }
          addInlineMarkdown(p, quoteLine, { size: 20, baseItalic: true });
        });
        continue;
      }

      const bullet = /^(\s*)[-*+]\s+([^\n]*)(?=\n?$)/.exec(line);
      const numbered = /^(\s*)\d+[.)]\s+([^\n]*)(?=\n?$)/.exec(line);
      if (bullet || numbered) {
        const match = bullet ?? numbered;
        const indentSpaces = match[1].length;
        const content = match[2];
        const marker = bullet ? "•" : `${/^\s*(\d+)[.)]/.exec(line)[1]}.`;
        const p = newParagraph(body, { after: 35, left: 360 + indentSpaces * 72 });
        addRun(p, `${marker}  `, { size: 21 });
        addInlineMarkdown(p, content, { size: 21 });
        i += 1;
        continue;
      }

      // Ordinary paragraph: absorb lines until a new block starts.
      const para = [line];
      i += 1;
      while (i < lines.length && lines[i].trim()) {
        const next = protectedLines[i];
        if (
          fenceMatch(next) ||
          /^#{1,6}\s+/.test(next) ||
          /^\s*>\s?/.test(next) ||
          /^(\s*)[-*+]\s+/.test(next) ||
          /^(\s*)\d+[.)]\s+/.test(next) ||
          /^\s*---+\s*$/.test(next)
        ) {
          break;
        }
        para.push(next);
        i += 1;
      }

      // Markdown hard breaks are two trailing spaces or a trailing backslash.
      let joined = "";
      para.forEach((entry, index) => {
        const trailingSpaces = entry.endsWith("  ");
        const trailingBackslash = entry.endsWith("\\") && !entry.endsWith("\\\\");
        const hard = trailingSpaces || trailingBackslash;
        let piece = entry;
        if (trailingSpaces) piece = piece.slice(0, -2);
        else if (hard && entry.endsWith("\\")) piece = piece.slice(0, -1);
        joined += preserveSoftBreaks ? piece : piece.trim();
        if (index < para.length - 1) joined += hard || preserveSoftBreaks ? "\n" : " ";
      });

      const p = newParagraph(body, { after: 120 });
      addInlineMarkdown(p, joined, { size: 21 });
    }
  }

  /* ===== src/core/chatgpt.js ===== */
  /*
   * ChatGPT share extraction — retrieval and parsing:
   *
   *   load_public_share_conversation / load_public_share_image /
   *   validate_chain / extract_text_and_uploads / reference_urls /
   *   visible_messages
   *
   * Operates directly inside the browser on chatgpt.com, so same-origin `fetch`
   * carries the user's authentic session cookies and TLS environment without
   * needing external TLS spoofing. That is why `@match https://chatgpt.com/*`
   * is required.
   */




  const CHATGPT_HOST = "chatgpt.com";

  /** A fetch wrapper managing authenticated session requests. */
  function createSession(fetchImpl) {
    const doFetch = fetchImpl ?? (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (!doFetch) throw new ExtractionError("This environment has no fetch() implementation");

    return {
      async getJson(url) {
        const response = await doFetch(url, { credentials: "include", headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        return response.json();
      },
      async getText(url) {
        const response = await doFetch(url, { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        return response.text();
      },
      async getBytes(url) {
        const response = await doFetch(url, { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        return new Uint8Array(await response.arrayBuffer());
      },
    };
  }

  /**
   * `load_public_share_conversation` — validate the URL shape, then pull the
   * public share document and its JSON payload from the same session.
   * @returns {Promise<{conversation: object, session: object, shareId: string, shareUrl: string}>}
   */
  async function loadPublicShareConversation(shareUrl, fetchImpl) {
    let parsed;
    try {
      parsed = urlsplit(shareUrl);
    } catch {
      throw new ExtractionError("The Share URL must use http:// or https://.");
    }

    const scheme = (parsed.scheme || "").toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      throw new ExtractionError("The Share URL must use http:// or https://.");
    }
    if ((parsed.netloc || "").toLowerCase() !== CHATGPT_HOST) {
      throw new ExtractionError("The Share URL must be on chatgpt.com.");
    }

    const parts = parsed.path.split("/").filter(Boolean);
    if (parts.length !== 2 || parts[0] !== "share") {
      throw new ExtractionError("Expected a ChatGPT Share URL in this form:\nhttps://chatgpt.com/share/<share-id>");
    }

    const shareId = parts[1];
    const canonicalShareUrl = `https://${CHATGPT_HOST}/share/${shareId}`;
    const apiUrl = `https://${CHATGPT_HOST}/backend-api/share/${shareId}`;
    const session = createSession(fetchImpl);

    let conversation;
    try {
      await session.getText(canonicalShareUrl); // primes cookies for share endpoint
      conversation = await session.getJson(apiUrl);
    } catch (error) {
      throw new ExtractionError(`Could not retrieve the public ChatGPT conversation: ${error.message ?? error}`);
    }

    if (!conversation || typeof conversation !== "object" || Array.isArray(conversation)) {
      throw new ExtractionError("The ChatGPT Share response is not a conversation object.");
    }

    return { conversation, session, shareId, shareUrl: canonicalShareUrl };
  }

  /**
   * Retrieve a conversation the signed-in user owns, from /c/<id>.
   *
   * Accesses private chats using the authenticated endpoint available in the
   * active session. The payload is normalised so the rest of the pipeline is
   * identical to the Share path.
   */
  async function loadLiveConversation(chatUrl, fetchImpl) {
    let parsed;
    try {
      parsed = urlsplit(chatUrl);
    } catch {
      throw new ExtractionError("Expected a ChatGPT conversation URL: https://chatgpt.com/c/<conversation-id>");
    }
    if ((parsed.netloc || "").toLowerCase() !== CHATGPT_HOST) {
      throw new ExtractionError("The conversation URL must be on chatgpt.com.");
    }
    const parts = parsed.path.split("/").filter(Boolean);
    if (parts.length < 2 || parts[0] !== "c") {
      throw new ExtractionError("Expected a ChatGPT conversation URL: https://chatgpt.com/c/<conversation-id>");
    }
    const conversationId = parts[1];
    const session = createSession(fetchImpl);

    let conversation;
    try {
      conversation = await session.getJson("https://" + CHATGPT_HOST + "/backend-api/conversation/" + conversationId);
    } catch (error) {
      throw new ExtractionError(
        "Could not retrieve the conversation (are you signed in?): " + (error.message ?? error)
      );
    }
    if (!conversation || typeof conversation !== "object") {
      throw new ExtractionError("The ChatGPT conversation response is not a conversation object.");
    }

    const payload = conversation.data && typeof conversation.data === "object" ? conversation.data : conversation;
    return { conversation: payload, session, shareId: null, conversationId };
  }

  /**
   * Image bytes for a privately owned file, via the authenticated download
   * endpoint. Returns null (which renders a placeholder in the DOCX) instead of
   * failing the whole export when one image cannot be fetched.
   */
  async function loadLiveImage(session, upload) {
    const fileId = fileIdFromAssetPointer(upload.asset_pointer);
    if (!fileId || !fileId.startsWith("file_")) return null;
    try {
      const resolver = await session.getJson("https://" + CHATGPT_HOST + "/backend-api/files/" + fileId + "/download");
      const downloadUrl = resolver && resolver.download_url;
      if (typeof downloadUrl !== "string" || !downloadUrl) return null;
      return await session.getBytes(downloadUrl);
    } catch {
      return null;
    }
  }

  /** `load_public_share_image` — retrieve one image through its stable file id. */
  async function loadPublicShareImage(session, shareId, upload) {
    const assetPointer = upload.asset_pointer;
    if (typeof assetPointer !== "string" || !assetPointer.startsWith("sediment://")) return null;

    const fileId = assetPointer.slice("sediment://".length).split("?", 1)[0];
    if (!fileId.startsWith("file_")) return null;

    const resolverUrl = `https://${CHATGPT_HOST}/backend-api/share/${shareId}/file/${fileId}`;

    let resolver;
    try {
      resolver = await session.getJson(resolverUrl);
    } catch (error) {
      throw new ExtractionError(`Could not resolve uploaded image ${fileId}: ${error.message ?? error}`);
    }
    if (!resolver || typeof resolver !== "object") return null;
    if (resolver.status !== "success") return null;

    const downloadUrl = resolver.download_url;
    if (typeof downloadUrl !== "string" || !downloadUrl) return null;

    try {
      return await session.getBytes(downloadUrl);
    } catch (error) {
      throw new ExtractionError(`Could not download uploaded image ${fileId}: ${error.message ?? error}`);
    }
  }

  /**
   * `validate_chain` — a shared conversation is a tree; the archive keeps the
   * single linear path ChatGPT actually displayed. Verifying parent/child links
   * is what stops a regenerated DOCX from silently mixing branches.
   */
  function validateChain(nodes, currentNode) {
    if (!nodes.length) throw new ExtractionError("linear_conversation is empty.");

    const ids = [];
    nodes.forEach((node, index) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        throw new ExtractionError(`Conversation node ${index} is not an object.`);
      }
      const nodeId = node.id;
      if (typeof nodeId !== "string" || !nodeId) {
        throw new ExtractionError(`Conversation node ${index} has no valid id.`);
      }
      ids.push(nodeId);
    });

    if (ids[ids.length - 1] !== currentNode) {
      throw new ExtractionError("The final linear_conversation node is not current_node.");
    }

    for (let i = 1; i < nodes.length; i += 1) {
      const expectedParent = ids[i - 1];
      const actualParent = nodes[i].parent;
      if (actualParent !== expectedParent) {
        throw new ExtractionError(`Conversation chain is broken at node ${i}: parent does not match.`);
      }
      const children = nodes[i - 1].children;
      if (Array.isArray(children) && !children.includes(ids[i])) {
        throw new ExtractionError(`Conversation chain is broken at node ${i - 1}: next node is not a child.`);
      }
    }
  }

  /** `iter_strings` — depth-first walk over every string in a JSON value. */
  function* iterStrings(value) {
    if (typeof value === "string") {
      yield value;
    } else if (Array.isArray(value)) {
      for (const item of value) yield* iterStrings(item);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) yield* iterStrings(item);
    }
  }

  /** `contains_asset_pointer` — attachments hide in more than one shape. */
  function containsAssetPointer(value) {
    for (const text of iterStrings(value)) {
      if (text.startsWith("sediment://")) return true;
    }
    if (Array.isArray(value)) return value.some((item) => containsAssetPointer(item));
    if (value && typeof value === "object") {
      if (value.content_type === "image_asset_pointer" || value.content_type === "file_asset_pointer") return true;
      if (Object.prototype.hasOwnProperty.call(value, "asset_pointer")) return true;
      return Object.values(value).some((item) => containsAssetPointer(item));
    }
    return false;
  }

  function fileIdFromAssetPointer(assetPointer) {
    if (typeof assetPointer !== "string" || !assetPointer.startsWith("sediment://")) return null;
    return assetPointer.slice("sediment://".length).split("?", 1)[0];
  }

  /** `upload_info` — match an upload part to its same-message attachment metadata. */
  function uploadInfo(part, metadata) {
    const assetPointer = part.asset_pointer;
    const fileId = fileIdFromAssetPointer(assetPointer);

    let attachment = null;
    if (metadata && typeof metadata === "object" && Array.isArray(metadata.attachments)) {
      attachment = metadata.attachments.find(
        (item) => item && typeof item === "object" && item.id === fileId,
      ) ?? null;
    }

    // Explicit container selection:
    // If an attachment record exists but lacks `size`, yield null rather than falling
    // back to the part's `size_bytes`. Matching this keeps placeholders aligned.
    const pick = (attachmentKey, partKey) =>
      attachment
        ? (attachment[attachmentKey] === undefined ? null : attachment[attachmentKey])
        : partKey === null
          ? null
          : (part[partKey] === undefined ? null : part[partKey]);

    return {
      content_type: part.content_type || part.type || null,
      asset_pointer: assetPointer === undefined ? null : assetPointer,
      filename: pick("name", null),
      mime_type: pick("mime_type", null),
      size: pick("size", "size_bytes"),
      width: pick("width", "width"),
      height: pick("height", "height"),
      file_id: fileId,
    };
  }

  /** `metadata_attachment_info` — an attachment record with no content part. */
  function metadataAttachmentInfo(attachment) {
    return {
      content_type: null,
      asset_pointer: null,
      filename: attachment.name ?? null,
      mime_type: attachment.mime_type ?? null,
      size: attachment.size ?? null,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      file_id: null,
    };
  }

  /** `unavailable_upload_text` — name the missing item, never a bare "None". */
  function unavailableUploadText(upload) {
    const isImage = upload.content_type === "image_asset_pointer";
    const label = isImage ? "Image" : "Attachment";
    const filename = upload.filename;
    if (typeof filename === "string" && filename.trim()) {
      return `[${label} unavailable: ${filename.trim()}]`;
    }
    return `[${label} unavailable]`;
  }

  /**
   * `extract_text_and_uploads` — visible text plus upload records.
   * @returns {[string, Array<object>]}
   */
  function extractTextAndUploads(content, metadata) {
    if (!content || typeof content !== "object" || Array.isArray(content)) return ["", []];

    const parts = content.parts;
    const texts = [];
    const uploads = [];

    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (typeof part === "string") {
          if (part) texts.push(part);
        } else if (part && typeof part === "object") {
          const partType = part.content_type || part.type;
          if (partType === "image_asset_pointer" || partType === "file_asset_pointer" || partType === "image" || containsAssetPointer(part)) {
            uploads.push(uploadInfo(part, metadata));
          } else {
            // Some content parts wrap their visible text in a text field.
            const partText = part.text;
            if (typeof partText === "string" && partText) texts.push(partText);
          }
        }
      }
    } else if (typeof content.text === "string" && content.text) {
      texts.push(content.text);
    }

    // A pointer can occasionally live outside parts.
    if (!uploads.length && containsAssetPointer(content)) {
      uploads.push(uploadInfo(content, metadata));
    }

    const representedFileIds = new Set();
    for (const upload of uploads) {
      const fileId = fileIdFromAssetPointer(upload.asset_pointer);
      if (fileId) representedFileIds.add(fileId);
    }

    if (metadata && typeof metadata === "object" && Array.isArray(metadata.attachments)) {
      for (const attachment of metadata.attachments) {
        if (!attachment || typeof attachment !== "object") continue;
        if (!representedFileIds.has(attachment.id)) {
          uploads.push(metadataAttachmentInfo(attachment));
        }
      }
    }

    return [texts.join("\n\n").trim(), uploads];
  }

  /** `reference_urls` — real citations, without search-result debris. */
  function referenceUrls(message, visibleText) {
    const metadata = message.metadata;
    const refs = metadata && typeof metadata === "object" ? metadata.content_references : null;
    if (!Array.isArray(refs)) return [];

    const candidates = [];
    for (const ref of refs) {
      if (!ref || typeof ref !== "object") continue;
      // grouped_webpages is the citation actually attached to visible prose.
      // Prefer safe_urls because it commonly contains the canonical URL as well
      // as ChatGPT's referral-attributed variant.
      if (ref.type === "grouped_webpages") {
        const safe = ref.safe_urls;
        if (Array.isArray(safe)) {
          candidates.push(...safe.filter((url) => typeof url === "string"));
        } else {
          candidates.push(...iterHttpUrls(ref.items));
        }
      }
    }

    const visibleClean = new Set(extractUrlsFromText(visibleText));

    const output = [];
    const seen = new Set();
    for (const raw of candidates) {
      const clean = sanitizeReferenceUrl(raw);
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      if (!visibleClean.has(clean)) output.push(clean);
    }
    return output;
  }

  function* iterHttpUrls(value) {
    if (typeof value === "string") {
      if (value.startsWith("http://") || value.startsWith("https://")) yield value;
    } else if (Array.isArray(value)) {
      for (const item of value) yield* iterHttpUrls(item);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) yield* iterHttpUrls(item);
    }
  }

  /**
   * `visible_messages` — the tuple list the DOCX renderer consumes:
   * [role, text, uploads, references, timestamp]
   */
  function visibleMessages(nodes) {
    const output = [];
    for (const node of nodes) {
      const message = node.message;
      if (!message || typeof message !== "object") continue;

      const author = message.author;
      const role = author && typeof author === "object" ? author.role : null;
      if (role !== "user" && role !== "assistant") continue;

      // Newer assistant messages can contain hidden analysis and a visible final.
      // Include final-channel messages and legacy messages that have no channel.
      if (role === "assistant") {
        const channel = message.channel;
        const recipient = message.recipient;
        // Only normal conversation output belongs in the archive. Tool calls can
        // also use channel=null/final and otherwise look like replies.
        if (recipient !== "all" || !(channel === null || channel === undefined || channel === "final")) continue;
      }

      const [text, uploads] = extractTextAndUploads(message.content, message.metadata);

      const messageId = message.id;
      if (typeof messageId === "string" && messageId) {
        for (const upload of uploads) upload.message_id = messageId;
      }

      if (text || uploads.length) {
        const refs = role === "assistant" ? referenceUrls(message, text) : [];
        const createTime = message.create_time;
        const timestamp = typeof createTime === "number" && Number.isFinite(createTime) ? createTime : null;
        output.push([role, text, uploads, refs, timestamp]);
      }
    }
    return output;
  }

  /** Attach retrieved bytes + derived geometry to every upload record. */
  function applyImageData(messages, imageBytesByFileId) {
    for (const [, , uploads] of messages) {
      for (const upload of uploads) {
        const fileId = fileIdFromAssetPointer(upload.asset_pointer);
        const data = fileId && imageBytesByFileId ? imageBytesByFileId.get(fileId) ?? null : null;
        upload.image_data = data;
        upload.image_info = imageInfo(data);
        upload.image_dimensions = upload.image_info ? upload.image_info.dimensions : null;
        upload.display_size_emu = imageDisplaySizeEmu(upload.image_dimensions);
      }
    }
  }

  /**
   * Live conversations from `/backend-api/conversation/{id}` arrive as a DAG in
   * `mapping` rather than a ready-made `linear_conversation` list. This rebuilds
   * the linear list shape — walking back from the current leaf and reversing it —
   * so every downstream validator sees one uniform shape even when archiving a chat
   * the user has not shared yet.
   */
  function ensureLinearConversation(conversation) {
    if (Array.isArray(conversation.linear_conversation)) return conversation.linear_conversation;

    const mapping = conversation.mapping;
    if (!mapping || typeof mapping !== "object") {
      throw new ExtractionError("linear_conversation is missing or invalid.");
    }

    let nodeId = conversation.current_node;
    const nodeFor = (id) => {
      const entry = mapping[id];
      return entry && typeof entry === "object" ? entry : null;
    };

    // Some payloads point current_node at a non-message anchor (for example
    // "cursor_group"); step down to a real leaf before walking back.
    let guard = 0;
    let node = nodeFor(nodeId);
    while (node && !node.message && Array.isArray(node.children) && node.children.length && guard < 10) {
      nodeId = node.children[node.children.length - 1];
      node = nodeFor(nodeId);
      guard += 1;
    }

    const chain = [];
    const seen = new Set();
    while (nodeId && nodeFor(nodeId)) {
      if (seen.has(nodeId)) throw new ExtractionError("Conversation mapping contains a cycle.");
      seen.add(nodeId);
      chain.push(nodeFor(nodeId));
      nodeId = nodeFor(nodeId).parent;
      if (nodeId && seen.has(nodeId)) break;
    }

    if (!chain.length) throw new ExtractionError("linear_conversation is missing or invalid.");
    chain.reverse();
    conversation.linear_conversation = chain;
    conversation.current_node = chain[chain.length - 1].id;
    return chain;
  }

  /** Extract and validate `linear_conversation`, as both input modes do. */
  function linearNodes(conversation) {
    const linear = ensureLinearConversation(conversation);
    if (!Array.isArray(linear)) throw new ExtractionError("linear_conversation is missing or invalid.");
    const nodes = linear.filter((node) => node && typeof node === "object" && !Array.isArray(node));
    if (nodes.length !== linear.length) throw new ExtractionError("linear_conversation contains an invalid node.");
    validateChain(nodes, conversation.current_node);
    return nodes;
  }

  function conversationTitle(conversation) {
    const title = conversation.title;
    if (typeof title === "string" && title.trim()) return title.trim();
    return "(No title)";
  }

  /* ===== src/core/docx.js ===== */
  /*
   * DOCX assembly — `create_docx`.
   *
   * A .docx is an OPC package: a ZIP of XML parts:
   *   (a) build `word/document.xml`,
   *   (b) declare the package parts, and
   *   (c) zip them together cleanly.
   *
   * Deliberate architectural choices:
   *   - Reference URLs are plain text, never `w:hyperlink` + external rel: an
   *     archival document must not silently rewrite a destination.
   *   - `word/settings.xml` carries `w:writeProtection w:recommended="true"`,
   *     which is what makes Word open the record in a read-oriented state.
   */








  /** UTF-8 bytes for an XML part. */
  const utf8 = (text) => new TextEncoder().encode(text);

  const STYLE_PART =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
    '<w:name w:val="Normal"/><w:qFormat/>' +
    '<w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>' +
    "</w:style></w:styles>";

  const CONTENT_TYPES_PART =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Default Extension="gif" ContentType="image/gif"/>' +
    '<Default Extension="webp" ContentType="image/webp"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    "</Types>";

  const ROOT_RELS_PART =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    "</Relationships>";

  const SETTINGS_PART =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:writeProtection w:recommended="true"/>' +
    "</w:settings>";

  const APP_PART =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
    "<Application>ChatGPT Conversation Bridge</Application>" +
    "</Properties>";

  function corePropertiesPart(title, isoTimestamp) {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
      'xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${htmlEscape(title)}</dc:title>` +
      "<dc:creator>ChatGPT Conversation Bridge</dc:creator>" +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${isoTimestamp}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${isoTimestamp}</dcterms:modified>` +
      "</cp:coreProperties>"
    );
  }

  /**
   * Build `word/document.xml` plus the image relationships.
   * @returns {{documentXml: string, docRelationships: string[], images: Array<{upload: object, mediaName: string}>}}
   */
  function buildDocument(title, messages) {
    const docRelationships = [
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    ];
    const images = [];
    let imageNumber = 0;

    for (const [, , uploads] of messages) {
      for (const upload of uploads) {
        if (!upload.image_info) continue;

        imageNumber += 1;
        const relationshipId = `rId${imageNumber + 2}`;
        const mediaName = `image${imageNumber}.${upload.image_info.extension}`;

        upload.docx_relationship_id = relationshipId;
        upload.docx_media_name = mediaName;

        docRelationships.push(
          `<Relationship Id="${relationshipId}" ` +
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
            `Target="media/${mediaName}"/>`,
        );
        images.push({ upload, relationshipId, mediaName });
      }
    }

    const document = element(null, "w:document");
    for (const [name, value] of DOCUMENT_NAMESPACES) document.set(name, value);
    const body = element(document, "w:body");

    addParagraph(body, title, { bold: true, size: 36, after: 80 });
    addParagraph(body, "ChatGPT Conversation Archive", { italic: true, size: 20, after: 240 });

    let drawingId = 0;
    for (const [role, text, uploads, refs, timestamp] of messages) {
      addMessageHeader(body, role, formatMessageTimestamp(timestamp));

      const messageBody = addMessageBodyContainer(body, role === "user" ? "FFFBF2" : "F7FFF5");

      for (const upload of uploads) {
        drawingId += 1;
        const relationshipId = upload.docx_relationship_id ?? null;
        const displaySize = upload.display_size_emu ?? null;

        if (relationshipId && displaySize) {
          const [widthEmu, heightEmu] = displaySize;
          addInlineImage(messageBody, relationshipId, widthEmu, heightEmu, drawingId);
        } else {
          // Note: placeholders land in `body`, not the shaded container,
          // keeping a failed image notice outside of the message's tinted block.
          addParagraph(body, unavailableUploadText(upload), {
            bold: true,
            italic: true,
            size: 20,
            after: 100,
            left: 288,
            shade: "FFF2CC",
          });
        }
      }

      if (text) addMarkdown(messageBody, text, role === "user");

      if (refs.length) {
        addParagraph(messageBody, "Reference URLs:", { bold: true, size: 19, before: 40, after: 30 });
        for (const url of refs) {
          addParagraph(messageBody, url, { size: 18, after: 25, left: 288, font: "Consolas" });
        }
      }

      // A trailing empty paragraph is required as the last child of a table cell.
      newParagraph(messageBody, { after: 0 });
    }

    const sect = element(body, "w:sectPr");
    const pgSz = element(sect, "w:pgSz");
    pgSz.set("w:w", "12240");
    pgSz.set("w:h", "15840");
    const pgMar = element(sect, "w:pgMar");
    for (const [key, value] of Object.entries({
      top: "936",
      right: "1080",
      bottom: "936",
      left: "1080",
      header: "720",
      footer: "720",
      gutter: "0",
    })) {
      pgMar.set(`w:${key}`, value);
    }

    return {
      documentXml: serializeDocument(document),
      documentRels:
        xmlDeclaration() +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        docRelationships.join("") +
        "</Relationships>",
      images,
    };
  }

  /**
   * Produce every DOCX package part in canonical ZIP archive order.
   * @returns {Promise<Array<{name: string, data: Uint8Array}>>}
   */
  async function buildDocxParts(title, messages, options = {}) {
    const { documentXml, documentRels, images } = buildDocument(title, messages);
    const date = options.date ?? new Date();
    const iso = `${date.toISOString().slice(0, 19)}Z`;

    const parts = [
      { name: "[Content_Types].xml", data: utf8(CONTENT_TYPES_PART) },
      { name: "_rels/.rels", data: utf8(ROOT_RELS_PART) },
      { name: "word/document.xml", data: utf8(documentXml) },
      { name: "word/_rels/document.xml.rels", data: utf8(documentRels) },
      { name: "word/settings.xml", data: utf8(SETTINGS_PART) },
      { name: "word/styles.xml", data: utf8(STYLE_PART) },
      { name: "docProps/core.xml", data: utf8(corePropertiesPart(title, iso)) },
      { name: "docProps/app.xml", data: utf8(APP_PART) },
    ];

    for (const { upload, mediaName } of images) {
      parts.push({ name: `word/media/${mediaName}`, data: upload.image_data });
    }
    return parts;
  }

  /** `create_docx` — write the complete DOCX into memory. */
  async function createDocx(title, messages, options = {}) {
    const parts = await buildDocxParts(title, messages, options);
    return createZip(parts, { date: options.date ?? new Date() });
  }

  /* ===== src/core/archive.js ===== */
  /*
   * Permanent archive — ports of `create_public_share_archive`,
   * `load_public_share_archive` and `prepare_messages_from_public_share_archive`.
   *
   * The archive provides full offline reproducibility: `conversation.json` plus
   * `uploads/file_*.png`. The archiving flow writes it, reads it back, verifies
   * every CRC, checks member filenames exactly, and verifies structural JSON
   * equality — ensuring integrity against silent corruption.
   */






  /** `json.dumps(..., ensure_ascii=False, indent=2)` equivalent. */
  function canonicalConversationJson(conversation) {
    return JSON.stringify(conversation, null, 2);
  }

  /** Deep structural equality check for JSON values and objects. */
  function jsonEquals(left, right) {
    if (left === right) return true;
    if (typeof left !== typeof right) return false;
    if (left === null || right === null) return false;
    if (typeof left !== "object") return Number.isNaN(left) && Number.isNaN(right) ? true : false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left)) {
      if (left.length !== right.length) return false;
      return left.every((item, index) => jsonEquals(item, right[index]));
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(right, key) && jsonEquals(left[key], right[key]),
    );
  }

  /**
   * Build and verify the permanent archive for a public Share conversation.
   * @returns {Promise<Uint8Array>} verified ZIP bytes
   */
  async function createPublicShareArchive(conversation, messages, options = {}) {
    const build = createZip;

    const expectedMembers = new Set(["conversation.json"]);
    const entries = [{ name: "conversation.json", data: new TextEncoder().encode(canonicalConversationJson(conversation)) }];

    const archivedFileIds = new Set();

    for (const [, , uploads] of messages) {
      for (const upload of uploads) {
        const imageData = upload.image_data;
        const info = upload.image_info;
        if (!imageData || !info) continue;

        const assetPointer = upload.asset_pointer;
        if (typeof assetPointer !== "string" || !assetPointer.startsWith("sediment://")) {
          throw new ExtractionError("An embedded image has no valid sediment asset pointer.");
        }
        const fileId = fileIdFromAssetPointer(assetPointer);
        if (!fileId.startsWith("file_")) {
          throw new ExtractionError("An embedded image has no valid file ID.");
        }
        if (archivedFileIds.has(fileId)) continue;

        const extension = info.extension;
        if (typeof extension !== "string" || !extension) {
          throw new ExtractionError(`Could not determine the image extension for ${fileId}.`);
        }
        const normalised = extension.startsWith(".") ? extension : `.${extension}`;
        const archiveMember = `uploads/${fileId}${normalised.toLowerCase()}`;

        entries.push({ name: archiveMember, data: imageData });
        expectedMembers.add(archiveMember);
        archivedFileIds.add(fileId);
      }
    }

    const bytes = await build(entries, options);

    // Verification pass — mirrors re-opening the file with `ZipFile(..., "r")`.
    let archive;
    try {
      archive = new ZipArchive(bytes);
    } catch (error) {
      throw new ExtractionError(`Archive is not a valid ZIP file: ${error.message ?? error}`);
    }

    const badMember = await archive.testzip();
    if (badMember !== null) {
      throw new ExtractionError(`Archive verification failed for member: ${badMember}`);
    }

    const actualMembers = new Set(archive.namelist());
    const missing = [...expectedMembers].filter((name) => !actualMembers.has(name)).sort();
    const unexpected = [...actualMembers].filter((name) => !expectedMembers.has(name)).sort();
    if (missing.length || unexpected.length) {
      const details = [];
      if (missing.length) details.push(`Missing: ${missing.join(", ")}`);
      if (unexpected.length) details.push(`Unexpected: ${unexpected.join(", ")}`);
      throw new ExtractionError(`Archive membership verification failed. ${details.join(" ")}`);
    }

    let archivedConversation;
    try {
      archivedConversation = JSON.parse(new TextDecoder().decode(await archive.read("conversation.json")));
    } catch (error) {
      throw new ExtractionError(`Archived conversation.json is invalid: ${error.message ?? error}`);
    }
    if (!jsonEquals(archivedConversation, conversation)) {
      throw new ExtractionError("Archived conversation.json does not match the retrieved conversation.");
    }

    return bytes;
  }

  /**
   * Load and validate a permanent public-share archive.
   * @returns {Promise<{conversation: object, imageBytesByFileId: Map<string, Uint8Array>}>}
   */
  async function loadPublicShareArchive(bytes, label = "archive") {
    let archive;
    try {
      archive = new ZipArchive(bytes);
    } catch (error) {
      throw new ExtractionError(`Archive is not a valid ZIP file: ${label}`);
    }

    const badMember = await archive.testzip();
    if (badMember !== null) {
      throw new ExtractionError(`Archive verification failed for member: ${badMember}`);
    }

    const members = archive.namelist();
    if (!members.includes("conversation.json")) {
      throw new ExtractionError("Archive does not contain conversation.json.");
    }

    let conversation;
    try {
      conversation = JSON.parse(new TextDecoder().decode(await archive.read("conversation.json")));
    } catch {
      throw new ExtractionError("Archive conversation.json is invalid.");
    }
    if (!conversation || typeof conversation !== "object" || Array.isArray(conversation)) {
      throw new ExtractionError("Archive conversation.json is not an object.");
    }

    const imageBytesByFileId = new Map();
    for (const member of members) {
      if (!member.startsWith("uploads/")) continue;
      if (member.endsWith("/")) continue;

      const filename = member.slice("uploads/".length);
      if (!filename || filename.includes("/")) {
        throw new ExtractionError(`Invalid archived upload path: ${member}`);
      }

      const dot = filename.lastIndexOf(".");
      const fileId = dot === -1 ? filename : filename.slice(0, dot);
      if (!fileId.startsWith("file_")) {
        throw new ExtractionError(`Invalid archived upload file ID: ${member}`);
      }
      if (imageBytesByFileId.has(fileId)) {
        throw new ExtractionError(`Archive contains more than one image for ${fileId}.`);
      }

      const data = await archive.read(member);
      if (imageInfo(data) === null) {
        throw new ExtractionError(`Archive contains an unsupported or invalid image: ${member}`);
      }
      imageBytesByFileId.set(fileId, data);
    }

    return { conversation, imageBytesByFileId };
  }

  /**
   * Validate an archived conversation and prepare its visible messages for the
   * DOCX renderer.
   */
  function prepareMessagesFromPublicShareArchive(conversation, imageBytesByFileId) {
    const nodes = linearNodes(conversation);
    const messages = visibleMessages(nodes);

    if (!messages.length) throw new ExtractionError("No visible user/assistant messages were found.");

    applyImageData(messages, imageBytesByFileId);

    const usedFileIds = new Set();
    for (const [, , uploads] of messages) {
      for (const upload of uploads) {
        const fileId = fileIdFromAssetPointer(upload.asset_pointer);
        if (upload.image_data !== null && upload.image_data !== undefined && fileId) usedFileIds.add(fileId);
      }
    }

    const unused = [...imageBytesByFileId.keys()].filter((id) => !usedFileIds.has(id)).sort();
    if (unused.length) {
      throw new ExtractionError(
        "Archive contains image data not referenced by the visible conversation: " + unused.join(", "),
      );
    }

    return { nodes, messages };
  }

  /* ===== src/core/instructions.js ===== */
  /*
   * Continuation templates.
   *
   * These fixed texts (the CHAT CONTINUATION message and the ChatGPT Conversation
   * Continuation Instructions) are staged directly into the composer to seamlessly
   * seed a new continuation chat.
   */

  /** Verbatim: "Standard Initial Chat Continuation Message". */
  const CHAT_CONTINUATION_MESSAGE = "CHAT CONTINUATION\n\nThe attached DOCX contains the previous ChatGPT conversation that this new chat\nwill continue.\n\nDo not read, analyze, summarize, or begin using the attached continuation\ndocument yet.\n\nI will provide the ChatGPT Conversation Continuation Instructions next. Those\ninstructions tell you how to use this continuation document and how to\ninitialize this new conversation.\n\nFor now, only acknowledge that the continuation document has been received and\nwait for the instruction document.";

  /** Verbatim: "Standard ChatGPT Conversation Continuation Instructions". */
  const CONTINUATION_INSTRUCTIONS = "ChatGPT Conversation Continuation Instructions\n\nGeneric instructions for continuing a previous ChatGPT conversation from a generated DOCX\n\nContinuation Document\n\nThe continuation DOCX is the document that was uploaded in the immediately preceding\nCHAT CONTINUATION message and that ChatGPT has already acknowledged receiving.\n\nUse that uploaded document as the continuation DOCX for these instructions.\n\nPurpose\n\nThese instructions tell a new ChatGPT conversation how to continue from the continuation\nDOCX with as little loss of context as practical.\n\nThe continuation DOCX is the chronological record of the previous conversation. The objective is\ncontinuation, not redesign, reinterpretation, or replacement of the earlier discussion.\n\nContinuation Declaration\n\nThis chat is a direct continuation of the ChatGPT conversation preserved in the continuation DOCX\nidentified above.\n\nTreat the continuation DOCX and the current chat as one chronological conversation when\nhistorical checking is requested.\n\nThe continuation DOCX contains the older history. The current chat contains the newer history. A\nlater explicit decision supersedes an earlier conflicting decision unless the later record\nexplicitly says otherwise.\n\nDo not silently restore an older requirement, conclusion, preference, or decision merely because\nit appears in the continuation DOCX.\n\nInitial Synchronization\n\nWhen these instructions and the continuation DOCX are first provided to a new chat,\nperform a one-time initial synchronization before resuming normal work.\n\nDuring initial synchronization, review the continuation DOCX sufficiently to understand:\n\n- the subject of the conversation;\n- the important established context;\n- the exact point where the previous conversation stopped.\n\nDo not attempt to redesign the subject matter while performing synchronization.\n\nWhen initial synchronization is complete, begin the continuation with:\n\nFULL CHECK: ON\n\nKeep FULL CHECK: ON until the user changes it.\n\nWhat Information Should Be Recovered?\n\nDuring initial synchronization, recover, when applicable:\n\n- important decisions, conclusions, requirements, preferences, and agreements;\n- completed work and results actually reported;\n- tests, checks, or validations actually performed;\n- important limitations, warnings, or known problems;\n- deferred work and unresolved questions;\n- the working method or procedure established by the user;\n- the exact point where the previous conversation stopped and the likely next step.\n\nInterpret the Historical Record Carefully\n\nDistinguish carefully among discussion, suggestion, approval, implementation, testing,\nverification, and final acceptance.\n\nDo not claim that something reached a later state unless the record actually establishes it.\n\n- A suggestion or proposed idea is not automatically an approved decision.\n- Text, code, instructions, or a solution produced by ChatGPT is not automatically something the\n  user implemented.\n- Implemented work is not automatically tested or verified.\n- A successful test does not automatically establish that the result became the final design.\n- If the record is genuinely ambiguous or incomplete, identify the uncertainty rather than\n  guessing.\n\nContinuation Synchronization Report\n\nAfter reviewing the continuation DOCX for the first time, provide a concise Continuation\nSynchronization Report before beginning substantive new work.\n\nInclude:\n\n- the name of the continuation DOCX reviewed;\n- the general subject or purpose of the continued conversation;\n- the current FULL CHECK state;\n- the most important established context needed to continue safely;\n- the latest completed work or conclusion, when applicable;\n- the exact point where the previous conversation stopped;\n- important deferred or unresolved items relevant to continuing;\n- whether any ambiguity currently prevents safe continuation.\n\nDo not automatically begin the next major task merely because synchronization is complete.\n\nAfter reporting the recovered state, wait for the user's instruction unless the user's\ncontinuation message already contains a clear task to perform.\n\nTreat the Continuation as One Chronological Conversation\n\nTreat the continuation DOCX and the current chat as one chronological conversation when\nhistorical checking is requested.\n\nThe continuation DOCX contains the older history. The current chat contains the newer history.\n\nWhen reviewing historical information, follow the conversation forward sufficiently to determine\nthe most recent applicable state rather than treating an earlier statement in isolation.\n\nCurrent Information Takes Precedence\n\nThe continuation DOCX is historical.\n\nInformation supplied or corrected by the user in the current chat is newer and takes precedence\nwhen the two conflict.\n\nDo not overwrite newer current-chat information with an older continuation-document version.\n\nLater Decisions Supersede Earlier Conflicting Decisions\n\nA later explicit decision supersedes an earlier conflicting decision unless the later record\nexplicitly says otherwise.\n\nDo not silently restore an older requirement, conclusion, preference, or decision merely because\nit appears in the continuation DOCX.\n\nWhen checking an important historical statement, review the later history sufficiently to\ndetermine whether that statement was changed, rejected, refined, implemented differently,\nsuperseded, or otherwise qualified.\n\nThen reconcile the continuation-document history with anything established later in the current\nconversation.\n\nThe most recent explicit decision governs unless the record says otherwise.\n\nHandling Uncertainty and Ambiguous History\n\nIf the historical record is genuinely ambiguous or incomplete, identify the uncertainty rather\nthan guessing.\n\nWhen an exact historical fact remains uncertain after checking the applicable sources, say that\nit is uncertain rather than filling the gap from assumption.\n\nWhat Is FULL CHECK?\n\nThis continuation uses a persistent switch named FULL CHECK.\n\nAfter initial synchronization, display the current FULL CHECK state at the top of every\nresponse, using exactly one of:\n\nFULL CHECK: ON\n\nFULL CHECK: OFF\n\nThe selected state remains in effect until the user changes it.\n\nStart a newly synchronized continuation with FULL CHECK: ON.\n\nThe user may switch between FULL CHECK: ON and FULL CHECK: OFF as often as needed. The most\nrecently selected state remains active until changed.\n\nFULL CHECK: OFF\n\nWhen FULL CHECK is OFF, answer using only the current ChatGPT conversation.\n\nDo not routinely consult, search, or reread the continuation DOCX. This keeps ordinary\ncontinuation work fast and prevents unnecessary reprocessing of a large historical document.\n\nFULL CHECK: ON\n\nWhen FULL CHECK is ON, use both the current conversation and the continuation DOCX\nwhenever prior history could materially affect the answer.\n\nBefore treating an important decision, rule, requirement, preference, unresolved question,\nimplementation issue, or historical fact as new, unanswered, or missing, check the continuation\nDOCX as necessary.\n\nDo not stop at the first matching historical statement. Check the later history sufficiently to\ndetermine whether that statement was changed, rejected, refined, implemented differently,\nsuperseded, or otherwise qualified.\n\nThen reconcile the continuation-document history with anything established later in the current\nconversation. The most recent explicit decision governs unless the record says otherwise.\n\nWhen an exact historical fact remains uncertain after checking both sources, say that it is\nuncertain rather than filling the gap from assumption.\n\nSwitching FULL CHECK Modes\n\nIf the user says FULL CHECK: ON or otherwise clearly requests FULL CHECK: ON, switch to FULL\nCHECK: ON and keep it on until changed.\n\nIf the user says FULL CHECK: OFF or otherwise clearly requests FULL CHECK: OFF, switch to FULL\nCHECK: OFF and keep it off until changed.\n\nExplicit Historical Checks While FULL CHECK Is OFF\n\nIf the user explicitly asks you to check, search, verify, or compare something against the\ncontinuation DOCX, do so for that request even while FULL CHECK is OFF.\n\nThis explicit historical check does not by itself change the persistent FULL CHECK setting.\n\nAfter completing the requested historical check, continue using FULL CHECK: OFF unless the user\nexplicitly changes the setting.\n\nDo Not Automatically Begin the Next Major Task\n\nDo not automatically begin the next major task merely because synchronization is complete.\n\nAfter reporting the recovered state, wait for the user's instruction unless the user's\ncontinuation message already contains a clear task to perform.\n\nFinal Continuation Principle\n\nThe purpose of these instructions is to make a new ChatGPT conversation behave as closely as\npractical to a continuation of the previous one.\n\nThe continuation DOCX preserves the detailed earlier history. The current chat carries the work\nforward.\n\nFULL CHECK: ON provides a deliberate mechanism for consulting both sources when historical\ncertainty matters, while FULL CHECK: OFF keeps normal work focused on the current conversation.\n\nWhen historical certainty matters, check rather than guess.\n\nWhen FULL CHECK is OFF and no historical check was requested, stay within the current\nconversation.";

  /** Stable marker used to detect that the composer already holds one of these. */
  const CONTINUATION_MARKER = "CHAT CONTINUATION";

  /* ===== src/core/pipeline.js ===== */
  /*
   * Orchestration pipeline.
   *
   * Strict ordering for artifact safety:
   *   share  : retrieve → validate chain → fetch images → build DOCX candidate →
   *            write + verify permanent archive → commit
   *   archive: read + verify ZIP → validate chain → build DOCX → commit
   *
   * Building the DOCX as a *candidate* before the archive exists, and only
   * committing it afterwards, guarantees a failed run leaves no half-written
   * output. No download is offered until every artifact has been fully verified.
   */









  /** Drop retrieved image payloads so every upload renders as a placeholder. */
  function clearImages(messages) {
    for (const [, , uploads] of messages) {
      for (const upload of uploads) {
        upload.image_data = null;
        upload.image_info = null;
        upload.image_dimensions = null;
        upload.display_size_emu = null;
      }
    }
  }

  function isShareSource(source) {
    return source.startsWith("https://") || source.startsWith("http://");
  }

  /**
   * Which input did we get?
   *   https://chatgpt.com/share/<id> -> public share
   *   https://chatgpt.com/c/<id>     -> live private chat
   *   anything else                  -> existing archive name
   * A non-chatgpt http(s) URL is still routed to the share reader so the user
   * gets the tool's real error message instead of an archive-name error.
   */
  function detectMode(source) {
    if (/^https?:\/\/chatgpt\.com\/share\//i.test(source)) return "share";
    if (/^https?:\/\/chatgpt\.com\/c\//i.test(source)) return "live";
    if (isShareSource(source)) return "share";
    return "archive";
  }

  function statusForMode(mode) {
    if (mode === "share") return "SHARE JSON + IMAGE + DOCX + ARCHIVE SUCCESS";
    if (mode === "live") return "LIVE JSON + IMAGE + DOCX + ARCHIVE SUCCESS";
    return "OFFLINE ARCHIVE + DOCX SUCCESS";
  }

  /** Archive name input validation (`validateArchiveName`). */
  function validateArchiveName(source) {
    if (!source) throw new ExtractionError("The conversation/archive name cannot be empty.");
    if (source.includes("/") || source.includes("\\")) {
      throw new ExtractionError("Supply only the conversation/archive name, not a path.");
    }
    if (source.toLowerCase().endsWith(".zip")) {
      throw new ExtractionError("Supply the conversation/archive name without the .zip extension.");
    }
    return source;
  }

  /** Terminal-style summary, returned as structured lines for the panel UI. */
  /**
   * Wall-clock stamp for Start Time / End Time lines.
   * Local time, 12-hour clock, no timezone name.
   */
  function formatReportInstant(instant) {
    const when = instant instanceof Date ? instant : new Date(instant);
    const pad = (value) => String(value).padStart(2, "0");
    const hours24 = when.getHours();
    return (
      `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ` +
      `${pad(hours24 % 12 === 0 ? 12 : hours24 % 12)}:${pad(when.getMinutes())}:${pad(when.getSeconds())} ` +
      `${hours24 < 12 ? "AM" : "PM"}`
    );
  }

  function buildReport(context) {
    const { mode, outputName, archiveName, title, nodeCount, messages, startInstant, endInstant } = context;

    const userCount = messages.filter(([role]) => role === "user").length;
    const assistantCount = messages.filter(([role]) => role === "assistant").length;
    const uploadCount = messages.reduce((total, [, , uploads]) => total + uploads.length, 0);

    const flat = messages.flatMap(([, , uploads]) => uploads);
    const embedded = flat.filter((upload) => upload.image_info).length;
    const isImageUpload = (upload) =>
      upload.content_type === "image_asset_pointer" ||
      (typeof upload.mime_type === "string" && upload.mime_type.toLowerCase().startsWith("image/"));
    const unavailableImages = flat.filter((upload) => !upload.image_info && isImageUpload(upload)).length;
    const unavailableAttachments = flat.filter((upload) => !upload.image_info && !isImageUpload(upload)).length;

    const referenceCount = messages.reduce((total, [, , , refs]) => total + refs.length, 0);
    const timestampCount = messages.filter(([, , , , timestamp]) => timestamp !== null).length;

    const seconds = Math.max(0, (endInstant - startInstant) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;

    const lines = [
      `Start Time: ${formatReportInstant(startInstant)}`,
      `Output:     ${outputName}`,
      `Archive:    ${archiveName}`,
      `Title:      ${title}`,
      `Nodes:      ${nodeCount} (chain validated)`,
      `Messages:   ${messages.length} (${userCount} user, ${assistantCount} assistant)`,
      `Uploads:    ${uploadCount} upload reference(s)`,
      `Images:     ${embedded} embedded, ${unavailableImages} unavailable`,
      // Right-aligned column formatting for report summary
      `Attachments:${String(unavailableAttachments).padStart(3)} unavailable`,
      `Timestamps: ${timestampCount} message timestamp(s) preserved`,
      `References: ${referenceCount} public reference URL(s) found`,
      `End Time:   ${formatReportInstant(endInstant)}`,
      `Duration:   ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${rest
        .toFixed(2)
        .padStart(5, "0")}`,
      `Status:     ${statusForMode(mode)}`,
    ];

    return {
      lines,
      stats: {
        userCount,
        assistantCount,
        uploadCount,
        embedded,
        unavailableImages,
        unavailableAttachments,
        referenceCount,
        timestampCount,
        messageCount: messages.length,
        nodeCount,
      },
    };
  }

  /**
   * Run the whole bridge for one input.
   *
   * @param {object} options
   * @param {string} options.source  Share URL, or an archive name for regeneration
   * @param {Function} [options.fetchImpl]                injectable fetch (tests/proxies)
   * @param {(name: string) => Promise<boolean>} [options.archiveExists] collision probe
   * @param {(name: string) => Promise<Uint8Array>} [options.readArchive] archive loader
   * @param {(progress: {done:number,total:number,percent:number}) => void} [options.onProgress]
   * @param {Date} [options.date] timestamp stamped into the outputs
   * @returns {Promise<{mode: string, basename: string, title: string, conversation: object,
   *   nodes: Array, messages: Array, docx: {name: string, bytes: Uint8Array},
   *   archive: {name: string, bytes: Uint8Array}|null, archiveName: string,
   *   report: {lines: string[], stats: object}}>}
   */
  async function runBridge(options) {
    const {
      source,
      fetchImpl,
      date = new Date(),
      archiveExists = async () => false,
      readArchive,
      embedImages = true,
      includeTimestamps = true,
      onProgress = () => {},
      startInstant = Date.now(),
    } = options;

    const trimmed = String(source ?? "").trim();
    if (!trimmed) throw new ExtractionError("Enter a ChatGPT Share URL or an archive name.");

    const mode = detectMode(trimmed);

    let conversation;
    let nodes;
    let messages;
    let basename;
    let archiveName;

    if (mode === "share" || mode === "live") {
      const retrieved =
        mode === "share"
          ? await loadPublicShareConversation(trimmed, fetchImpl)
          : await loadLiveConversation(trimmed, fetchImpl);
      const { session, shareId } = retrieved;
      conversation = retrieved.conversation;
      nodes = linearNodes(conversation);

      basename = sanitizeFilesystemBasename(conversationTitle(conversation));
      archiveName = validateOutputPath("archive", basename, "zip");

      if (await archiveExists(archiveName)) {
        // Archive collision protection: an established permanent archive is never
        // silently replaced, because it may be the only surviving copy of a chat
        // whose share link has since changed.
        throw new ExtractionError(`Archive already exists: ${archiveName}`);
      }

      messages = visibleMessages(nodes);

      // Retrieve uploads with progress updates, then verify whether the
      // conversation contains messages.
      const totalUploads = embedImages
        ? messages.reduce((total, [, , uploads]) => total + uploads.length, 0)
        : 0;
      let processed = 0;
      for (const [, , uploads] of embedImages ? messages : []) {
        for (const upload of uploads) {
          upload.image_data =
            mode === "share"
              ? await loadPublicShareImage(session, shareId, upload)
              : await loadLiveImage(session, upload);
          upload.image_info = imageInfo(upload.image_data);
          upload.image_dimensions = upload.image_info ? upload.image_info.dimensions : null;
          upload.display_size_emu = imageDisplaySizeEmu(upload.image_dimensions);

          processed += 1;
          onProgress({
            done: processed,
            total: totalUploads,
            percent: totalUploads ? pyRound((processed * 100) / totalUploads) : 100,
          });
        }
      }

      if (!embedImages) clearImages(messages);

      if (!messages.length) throw new ExtractionError("No visible user/assistant messages were found.");
    } else {
      basename = validateArchiveName(trimmed);
      archiveName = validateOutputPath("archive", basename, "zip");

      if (typeof readArchive !== "function") {
        throw new ExtractionError("No archive store is available to read from in this environment.");
      }
      const bytes = await readArchive(archiveName);
      if (!bytes) throw new ExtractionError(`Archive does not exist: ${archiveName}`);

      const loaded = await loadPublicShareArchive(bytes, archiveName);
      conversation = loaded.conversation;
      ({ nodes, messages } = prepareMessagesFromPublicShareArchive(conversation, loaded.imageBytesByFileId));
    }

    if (!embedImages && mode === "archive") clearImages(messages);

    // Timestamps are cosmetic, so switching them off must not change what the
    // archive holds — the DOCX is rendered from a copy with the stamps removed.
    const renderedMessages = includeTimestamps ? messages : messages.map(([role, text, uploads, refs]) => [role, text, uploads, refs, null]);

    const title = conversationTitle(conversation);
    const docxName = validateOutputPath("docx", basename, "docx");

    // Candidate first: the DOCX is committed only after the archive verifies.
    const docxBytes = await createDocx(title, renderedMessages, { date });

    let archiveBytes = null;
    if (mode === "share" || mode === "live") {
      archiveBytes = await createPublicShareArchive(conversation, messages, { date });
    }

    const report = buildReport({
      mode,
      outputName: docxName,
      archiveName,
      title,
      nodeCount: nodes.length,
      messages: renderedMessages,
      startInstant,
      endInstant: Date.now(),
    });

    return {
      mode,
      basename,
      title,
      conversation,
      nodes,
      messages,
      docx: { name: docxName, bytes: docxBytes },
      archive: archiveBytes ? { name: archiveName, bytes: archiveBytes } : null,
      archiveName,
      report,
    };
  }

  /* ===== src/browser/idb.js ===== */
  /*
   * Tiny IndexedDB wrapper — used for (a) the archive store when the browser has
   * no File System Access API, and (b) remembering a chosen output folder across
   * reloads (FileSystemDirectoryHandle is structured-cloneable, so the handle
   * itself can be persisted and re-authorised).
   */

  const DB_NAME = "chatgpt-conversation-bridge";
  const DB_VERSION = 1;

  const STORE_ARCHIVES = "archives";
  const STORE_SETTINGS = "settings";

  let databasePromise = null;

  function indexedDbAvailable() {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!indexedDbAvailable()) {
        reject(new Error("IndexedDB is unavailable"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_ARCHIVES)) {
          db.createObjectStore(STORE_ARCHIVES, { keyPath: "name" });
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
    });
    return databasePromise;
  }

  function withStore(storeName, mode, run) {
    return openDatabase().then(
      (db) =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, mode);
          let result;
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = () => reject(transaction.error ?? new Error("transaction failed"));
          transaction.onabort = () => reject(transaction.error ?? new Error("transaction aborted"));
          try {
            Promise.resolve(run(transaction.objectStore(storeName))).then((value) => {
              result = value;
            });
          } catch (error) {
            reject(error);
          }
        }),
    );
  }

  const asPromise = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("request failed"));
    });

  function idbGet(storeName, key) {
    return withStore(storeName, "readonly", (store) => asPromise(store.get(key)));
  }

  function idbPut(storeName, value, key) {
    return withStore(storeName, "readwrite", (store) => asPromise(key === undefined ? store.put(value) : store.put(value, key)));
  }

  function idbDelete(storeName, key) {
    return withStore(storeName, "readwrite", (store) => asPromise(store.delete(key)));
  }

  function idbAll(storeName) {
    return withStore(storeName, "readonly", (store) => asPromise(store.getAll()));
  }

  async function idbGetSetting(key, fallback = null) {
    try {
      const value = await idbGet(STORE_SETTINGS, key);
      return value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  }

  async function idbSetSetting(key, value) {
    try {
      await idbPut(STORE_SETTINGS, value, key);
      return true;
    } catch {
      return false;
    }
  }

  /* ===== src/browser/settings.js ===== */
  /*
   * Settings persistence.
   *
   * Preference storage is layered because the script has to work in
   * Tampermonkey, Violentmonkey, Userscripts and a bare browser:
   * GM storage (survives site storage clearing) -> localStorage -> IndexedDB.
   */



  const DEFAULT_SETTINGS = {
    embedImages: true,
    includeTimestamps: true,
    includeReferences: true,
    autoDownload: false,
    preferFolderStore: true,
    lastSource: "",
  };

  const KEY = "ccbr:settings";

  function gmApi(name) {
    try {
      const value = typeof globalThis !== "undefined" ? globalThis[name] : undefined;
      return typeof value === "function" ? value : null;
    } catch {
      return null;
    }
  }

  let memoryFallback = null;

  async function loadSettings() {
    let raw = null;
    const get = gmApi("GM_getValue");
    if (get) {
      try {
        raw = get(KEY, null);
      } catch {
        raw = null;
      }
    }
    if (raw === null && typeof localStorage !== "undefined") {
      try {
        raw = localStorage.getItem(KEY);
      } catch {
        raw = null;
      }
    }
    if (raw === null) {
      raw = await idbGetSetting(KEY, null);
    }
    if (!raw) return { ...DEFAULT_SETTINGS };

    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async function saveSettings(patch) {
    const merged = { ...(memoryFallback ?? (await loadSettings())), ...patch };
    memoryFallback = merged;
    const serialized = JSON.stringify(merged);

    const set = gmApi("GM_setValue");
    if (set) {
      try {
        set(KEY, serialized);
        return merged;
      } catch {
        /* fall through */
      }
    }
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(KEY, serialized);
        return merged;
      } catch {
        /* fall through */
      }
    }
    await idbSetSetting(KEY, serialized);
    return merged;
  }

  function peekSettings() {
    return memoryFallback ? { ...DEFAULT_SETTINGS, ...memoryFallback } : null;
  }

  /* ===== src/browser/store.js ===== */
  /*
   * Output backends.
   *
   * Folder layout contract: permanent archives in `archive/`,
   * generated documents in `docx/`, throwaway candidates in `temp/`, never
   * overwriting an existing archive. Two backends implement this contract:
   *
   *   FolderStore  — File System Access API (Chromium). Real directories under a
   *                  user-picked root, organizing outputs and enabling regeneration
   *                  from `archive/<name>.zip` on disk.
   *   IdbStore     — IndexedDB fallback for Firefox/Safari. The archive remains
   *                  persisted across sessions; outputs are offered as downloads.
   *
   * Both keep the candidate-then-commit write order, ensuring a DOCX is never left
   * partially written while Word holds a file lock.
   */




  const textEncode = (value) => new TextEncoder().encode(value);

  function fileSystemAccessAvailable() {
    return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
  }

  async function directoryHandleToBytes(handle) {
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  /** Real folders under a picked root: `archive/`, `docx/`, `temp/`. */
  class FolderStore {
    constructor(rootHandle) {
      this.kind = "folder";
      this.root = rootHandle;
      this.label = `Folder: ${rootHandle.name}`;
    }

    async dir(name, { create = false } = {}) {
      try {
        return await this.root.getDirectoryHandle(name, { create });
      } catch (error) {
        if (error && error.name === "NotFoundError") return null;
        throw error;
      }
    }

    async file(dirHandle, name, { create = false } = {}) {
      try {
        return await dirHandle.getFileHandle(name, { create });
      } catch (error) {
        if (error && error.name === "NotFoundError") return null;
        throw error;
      }
    }

    async permission() {
      const options = { mode: "readwrite" };
      if (this.root.queryPermission) {
        const state = await this.root.queryPermission(options);
        return state;
      }
      return "granted";
    }

    async ensurePermission() {
      if (this.root.requestPermission && (await this.permission()) !== "granted") {
        const state = await this.root.requestPermission({ mode: "readwrite" });
        if (state !== "granted") {
          throw new ExtractionError("Folder access was not granted. Re-select the ChatGPT Conversation Bridge folder.");
        }
      }
      return true;
    }

    async has(archiveName) {
      const archive = await this.dir("archive");
      if (!archive) return false;
      return (await this.file(archive, baseName(archiveName))) !== null;
    }

    async read(archiveName) {
      const archive = await this.dir("archive");
      if (!archive) return null;
      const handle = await this.file(archive, baseName(archiveName));
      return handle ? directoryHandleToBytes(handle) : null;
    }

    async write(relativePath, bytes) {
      const [dirName, ...rest] = relativePath.split("/");
      const fileName = rest.join("/");
      const directory = await this.dir(dirName, { create: true });
      const handle = await this.file(directory, fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(new Blob([bytes]));
      await writable.close();
      return { mode: "saved", path: relativePath };
    }

    /**
     * Write the DOCX as a temp candidate, then commit it to `docx/`, matching
     * `create_docx_candidate` + `commit_docx_candidate`.
     */
    async writeDocx(candidateBytes, docxName) {
      await this.ensurePermission();
      const tempName = `temp/candidate-${Date.now().toString(36)}.docx`;
      await this.write(tempName, candidateBytes);
      try {
        await this.write(docxName, candidateBytes);
      } catch (error) {
        throw new ExtractionError(
          `ERROR: Cannot overwrite output file (is it open in Word?): ${docxName}\n${error.message ?? error}`,
        );
      } finally {
        await this.remove(tempName);
      }
      return { mode: "saved", path: docxName };
    }

    async remove(relativePath) {
      const [dirName, ...rest] = relativePath.split("/");
      const directory = await this.dir(dirName);
      if (!directory) return false;
      try {
        await directory.removeEntry(rest.join("/"));
        return true;
      } catch {
        return false;
      }
    }

    async listArchives() {
      const archive = await this.dir("archive");
      if (!archive) return [];
      const entries = [];
      for await (const [name, handle] of archive.entries()) {
        if (handle.kind !== "file" || !name.toLowerCase().endsWith(".zip")) continue;
        const file = await handle.getFile();
        entries.push({
          name: `archive/${name}`,
          basename: name.replace(/\.zip$/i, ""),
          size: file.size,
          modifiedAt: file.lastModified,
        });
      }
      return entries.sort((a, b) => a.basename.localeCompare(b.basename));
    }
  }

  function baseName(relativePath) {
    const parts = relativePath.split("/");
    return parts[parts.length - 1];
  }

  /**
   * IndexedDB fallback: archives are permanent, outputs are downloaded.
   *
   * Every storage call is best-effort. Hardened browsers (private mode, Brave
   * shields, enterprise policy) can deny IndexedDB outright, and a user in that
   * situation still deserves the DOCX - losing the archive silently is bad, but
   * refusing to produce anything is worse. Failures are therefore reported as a
   * warning line instead of throwing.
   */
  class IdbStore {
    constructor() {
      this.kind = "indexeddb";
      this.label = "Browser storage (IndexedDB)";
      this.warnings = [];
    }

    async guard(action, fallback) {
      try {
        return await action();
      } catch (error) {
        const message = String(error && error.message ? error.message : error);
        if (!this.warnings.includes(message)) this.warnings.push(message);
        return fallback;
      }
    }

    async has(archiveName) {
      if (!indexedDbAvailable()) return false;
      return (await this.guard(() => idbGet(STORE_ARCHIVES, archiveName), undefined)) !== undefined;
    }

    async read(archiveName) {
      const record = await this.guard(() => idbGet(STORE_ARCHIVES, archiveName), null);
      if (!record) return null;
      if (record.bytes) return record.bytes;
      if (record.blob) return new Uint8Array(await record.blob.arrayBuffer());
      return null;
    }

    async write(relativePath, bytes) {
      // IndexedDB has no folders; the archive is what must survive, so only the
      // permanent archive is written here and documents are downloaded instead.
      if (relativePath.startsWith("archive/")) {
        await this.guard(
          () =>
            idbPut(STORE_ARCHIVES, {
              name: relativePath,
              basename: baseName(relativePath).replace(/\.zip$/i, ""),
              bytes,
              size: bytes.length,
              createdAt: Date.now(),
            }),
          null
        );
        return { mode: "saved", path: relativePath, warnings: this.warnings };
      }
      return { mode: "memory", path: relativePath, warnings: this.warnings };
    }

    async writeDocx(candidateBytes, docxName) {
      return { mode: "memory", path: docxName, bytes: candidateBytes, warnings: this.warnings };
    }

    async remove(archiveName) {
      if (!indexedDbAvailable()) return false;
      await this.guard(() => idbDelete(STORE_ARCHIVES, archiveName), null);
      return true;
    }

    async listArchives() {
      if (!indexedDbAvailable()) return [];
      const records = (await this.guard(() => idbAll(STORE_ARCHIVES), [])) ?? [];
      return records
        .map((record) => ({
          name: record.name,
          basename: record.basename,
          size: record.size ?? 0,
          createdAt: record.createdAt ?? 0,
        }))
        .sort((a, b) => a.basename.localeCompare(b.basename));
    }
  }

  /** Trigger a browser download for a generated file. */
  function downloadBytes(fileName, bytes, mime) {
    const blob = new Blob([bytes.slice().buffer], { type: mime ?? "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = baseName(fileName);
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return baseName(fileName);
  }

  function bytesForStorage(bytes) {
    // Copy out of the shared buffer so a stored Blob/record cannot be mutated by
    // a later view over the same ArrayBuffer.
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy;
  }

  /* ===== src/browser/composer.js ===== */
  /*
   * Composer integration.
   *
   * Automating the continuation workflow avoids manual drag-and-drop and multi-stage
   * manual pasting, providing a direct write path into ChatGPT's editor that stages
   * content cleanly without prematurely submitting the message.
   *
   * Order of attempts, most trusted first:
   *   1. synthetic `paste` event with a DataTransfer — the editor's own paste
   *      handler runs, so multi-paragraph text becomes real paragraphs and the
   *      "Enter submits" path is never touched;
   *   2. `document.execCommand("insertText")` — still tracked by the editor;
   *   3. direct DOM write + `input` event, the noisy last resort.
   */

  const COMPOSER_SELECTORS = [
    "#prompt-textarea",
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][data-testid="composer-input"]',
    'textarea[aria-label*="prompt" i]',
  ];

  function findComposer() {
    for (const selector of COMPOSER_SELECTORS) {
      const found = document.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  function findFileInput() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.find((input) => !input.disabled) ?? null;
  }

  function composerHasText(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return Boolean(el.value.trim());
    return Boolean(el.textContent.trim());
  }

  function focusEditor(el) {
    el.focus({ preventScroll: true });
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      /* selection APIs can throw in a detached node; text insertion still works */
    }
  }

  function clearEditor(el) {
    el.focus({ preventScroll: true });
    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Insert `text` into the composer without submitting.
   * @returns {Promise<{ok: boolean, method: string}>}
   */
  async function insertIntoComposer(text, { replace = false } = {}) {
    const el = findComposer();
    if (!el) return { ok: false, method: "none", reason: "composer-not-found" };

    focusEditor(el);
    if (replace) clearEditor(el);

    if (typeof DataTransfer === "function" && typeof ClipboardEvent === "function") {
      try {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData("text/plain", text);
        const pasteEvent = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        });
        el.dispatchEvent(pasteEvent);
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (composerHasText(el)) return { ok: true, method: "paste" };
      } catch {
        /* fall through to execCommand */
      }
    }

    try {
      document.execCommand("insertText", false, text);
      await new Promise((resolve) => setTimeout(resolve, 60));
      if (composerHasText(el)) return { ok: true, method: "execCommand" };
    } catch {
      /* fall through */
    }

    try {
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
        if (setter) setter.call(el, text);
        else el.value = text;
      } else {
        el.textContent = text;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return { ok: composerHasText(el), method: "direct" };
    } catch {
      return { ok: false, method: "none", reason: "insert-failed" };
    }
  }

  /**
   * Best-effort file attachment for the continuation DOCX.
   *
   * Setting `input.files` from a synthetic DataTransfer is the only way to feed a
   * React file uploader without a real user gesture, and it works in Chromium but
   * not universally. Callers must treat failure as "please drag the file in".
   */
  async function attachFileToComposer(file) {
    const input = findFileInput();
    if (!input) return { ok: false, reason: "file-input-not-found" };

    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
      if (descriptor && descriptor.set) {
        descriptor.set.call(input, dataTransfer.files);
      } else {
        input.files = dataTransfer.files;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: String(error && error.message ? error.message : error) };
    }
  }

  /** Submit the composer the way a user pressing Enter does. */
  function submitComposer() {
    const button =
      document.querySelector('[data-testid="send-button"]') ||
      document.querySelector('button[aria-label*="Send" i]') ||
      null;
    if (button && !button.disabled) {
      button.click();
      return true;
    }
    const el = findComposer();
    if (!el) return false;
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }),
    );
    return true;
  }

  function openNewChat() {
    if (location.pathname !== "/" && !/^\/g\/?$/.test(location.pathname)) {
      window.open("https://chatgpt.com/", "_blank", "noopener");
      return true;
    }
    const newChat =
      document.querySelector('[data-testid="sidebar-new-chat"]') ||
      document.querySelector('a[href="https://chatgpt.com/"]') ||
      null;
    if (newChat) {
      newChat.click();
      return true;
    }
    window.open("https://chatgpt.com/", "_blank", "noopener");
    return true;
  }

  /* ===== src/browser/ui.js ===== */
  /*
   * Panel UI, rendered inside a shadow root so ChatGPT's own stylesheet cannot
   * reach it (and so that a page-wide CSS reset cannot make the tool invisible).
   *
   * Everything here is presentation: the behaviour lives in the core modules and
   * is reached through the `actions` object handed in by main.js.
   */

  const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .wrap {
    --bg: #ffffff; --fg: #17181c; --muted: #6b7280; --line: #e5e7eb;
    --accent: #fa7e33; --accent-ink: #ffffff; --ok: #0a7d33; --bad: #b42318;
    --field: #f7f8fa;
    position: fixed; z-index: 2147483000; font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    color: var(--fg); background: var(--bg);
    right: 20px; bottom: 20px; width: 456px; max-width: calc(100vw - 24px);
    border: 1px solid var(--line); border-radius: 14px;
    box-shadow: 0 18px 48px rgba(16, 24, 40, .18);
    display: flex; flex-direction: column; overflow: hidden;
    font-size: 13px; line-height: 1.45;
  }
  .wrap.dark { --bg:#1c1d21; --fg:#e8eaed; --muted:#9aa0a6; --line:#33353b; --field:#232428; }
  .head { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line); }
  .title { font-weight:650; letter-spacing:.1px; }
  .ver { color: var(--muted); font-size:11px; }
  .spacer { flex:1; }
  .iconbtn { appearance:none; border:1px solid var(--line); background:transparent; color:var(--muted);
    width:26px; height:26px; border-radius:8px; cursor:pointer; font-size:14px; line-height:1; }
  .iconbtn:hover { color: var(--fg); }
  .tabs { display:flex; gap:2px; padding:8px 10px 0; border-bottom:1px solid var(--line); }
  .tab { appearance:none; border:1px solid transparent; border-bottom:none; background:transparent; color:var(--muted);
    padding:6px 10px; border-radius:8px 8px 0 0; cursor:pointer; font:inherit; font-size:12px; }
  .tab[aria-selected="true"] { color:var(--fg); background:var(--field); border-color:var(--line); }
  .body { padding:12px; display:grid; gap:10px; max-height:min(66vh,620px); overflow:auto; }
  .row { display:grid; gap:6px; }
  label.f { font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:.4px; }
  input[type=text], textarea {
    width:100%; padding:8px 9px; border:1px solid var(--line); border-radius:9px; background:var(--field);
    color:var(--fg); font:inherit; font-size:12.5px;
  }
  textarea { resize:vertical; min-height:56px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
  .btns { display:flex; flex-wrap:wrap; gap:6px; }
  button.b { appearance:none; border:1px solid var(--line); background:var(--field); color:var(--fg);
    padding:7px 11px; border-radius:9px; cursor:pointer; font:inherit; font-size:12.5px; font-weight:600; }
  button.b:hover { border-color: var(--accent); }
  button.b.primary { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
  button.b:disabled { opacity:.55; cursor:progress; }
  .opts { display:flex; flex-wrap:wrap; gap:10px 14px; }
  .chk { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--fg); cursor:pointer; }
  .chk input { accent-color: var(--accent); }
  pre.report { margin:0; padding:10px; border:1px solid var(--line); border-radius:9px; background:var(--field);
    font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11.5px; white-space:pre-wrap; color:var(--fg); }
  .ok { color: var(--ok); font-weight:700; }
  .bad { color: var(--bad); font-weight:700; }
  .note { color: var(--muted); font-size:11.5px; }
  ul.arch { list-style:none; margin:0; padding:0; display:grid; gap:6px; }
  ul.arch li { display:flex; align-items:center; gap:8px; padding:8px; border:1px solid var(--line); border-radius:9px; }
  .arch .nm { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:190px; }
  .arch .meta { color:var(--muted); font-size:11px; }
  .mini { appearance:none; border:1px solid var(--line); background:transparent; color:var(--fg);
    border-radius:7px; padding:3px 7px; font:inherit; font-size:11px; cursor:pointer; }
  .mini:hover { border-color: var(--accent); }
  .bar { height:6px; border-radius:99px; background:var(--field); overflow:hidden; border:1px solid var(--line); }
  .bar > i { display:block; height:100%; width:0; background:var(--accent); transition:width .18s ease; }
  h4 { margin:4px 0 0; font-size:12px; }
  p { margin:0; }
  .fab { position:fixed; right:20px; bottom:20px; z-index:2147483000; appearance:none; cursor:pointer;
    border:1px solid var(--line); background:#fff; color:#17181c; border-radius:999px; padding:9px 13px;
    font:600 12.5px ui-sans-serif, system-ui, sans-serif; box-shadow:0 8px 22px rgba(16,24,40,.16); }
  .fab:hover { border-color: var(--accent); }
  .fab .dot { display:inline-block; width:7px; height:7px; border-radius:99px; background:var(--accent); margin-right:6px; }
  code { font-family:ui-monospace, Menlo, monospace; background:var(--field); padding:1px 4px; border-radius:5px; font-size:11.5px; }
  .progress { display:none; gap:6px; }
  .progress[data-on="1"] { display:block; }
  `;

  const TABS = [
    ["export", "Export"],
    ["archives", "Archives"],
    ["continue", "Continue"],
    ["help", "Help"],
  ];

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "html") node.innerHTML = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
    }
    for (const child of [].concat(children)) {
      if (child) node.append(child);
    }
    return node;
  }

  function mountUi({ actions, settings, initialSource, version }) {
    const host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;z-index:2147483000;";
    const shadow = host.attachShadow({ mode: "open" });

    const style = el("style", { text: STYLE });
    shadow.append(style);

    const isDark =
      typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

    const fab = el("button", { class: "fab", type: "button", title: "ChatGPT Conversation Bridge (Alt+B)" });
    fab.innerHTML = '<span class="dot"></span>Bridge';

    const body = el("div", { class: "body" });
    const panel = el("div", { class: `wrap${isDark ? " dark" : ""}` }, [
      el("div", { class: "head" }, [
        el("span", { class: "title", text: "ChatGPT Conversation Bridge" }),
        el("span", { class: "ver", text: `v${version}` }),
        el("span", { class: "spacer" }),
        el("button", {
          class: "iconbtn",
          type: "button",
          title: "Minimise",
          onclick: () => toggle(false),
          text: "–",
        }),
      ]),
      el("div", { class: "tabs" }, TABS.map(([id, label]) =>
        el("button", {
          class: "tab",
          type: "button",
          role: "tab",
          "data-tab": id,
          "aria-selected": id === "export" ? "true" : "false",
          text: label,
          onclick: () => selectTab(id),
        })
      )),
      body,
      el("div", { class: "progress", "data-role": "progress", "data-on": "0" }, [
        el("div", { class: "note", text: "", "data-role": "progress-text" }),
        el("div", { class: "bar" }, [el("i", { "data-role": "progress-fill" })]),
      ]),
    ]);

    shadow.append(fab, panel);
    (document.body || document.documentElement).append(host);

    const tabs = Object.fromEntries(
      TABS.map(([id]) => [id, el("section", { class: "tabpanel", "data-panel": id, hidden: id !== "export" })])
    );
    for (const node of Object.values(tabs)) body.append(node);

    function selectTab(id) {
      for (const [key, node] of Object.entries(tabs)) node.hidden = key !== id;
      for (const button of panel.querySelectorAll(".tab")) {
        button.setAttribute("aria-selected", button.dataset.tab === id ? "true" : "false");
      }
      if (id === "archives") actions.refreshArchives?.();
    }

    let visible = false;
    function toggle(next) {
      visible = next ?? !visible;
      panel.style.display = visible ? "flex" : "none";
      fab.style.display = visible ? "none" : "block";
      if (visible) selectTab(currentTab);
    }
    let currentTab = "export";
    const baseSelectTab = selectTab;
    selectTab = (id) => {
      currentTab = id;
      baseSelectTab(id);
    };
    fab.addEventListener("click", () => toggle(true));
    panel.querySelector(".iconbtn").addEventListener("click", () => toggle(false));
    toggle(true);
    selectTab("export");

    // ---------------------------------------------------------------- export --
    const sourceInput = el("input", {
      type: "text",
      "data-role": "source",
      placeholder: "https://chatgpt.com/share/<id>  ·  https://chatgpt.com/c/<id>  ·  Archive name",
      value: initialSource ?? "",
    });

    const checkboxes = {};
    const optionDefs = [
      ["embedImages", "Download & embed supported images"],
      ["includeTimestamps", "Show message timestamps"],
      ["includeReferences", "Keep public reference URLs"],
      ["autoDownload", "Offer downloads as well as saving"],
    ];
    const optionsRow = el("div", { class: "opts" }, optionDefs.map(([key, label]) => {
      const input = el("input", { type: "checkbox", id: `opt-${key}` });
      input.checked = Boolean(settings[key]);
      input.addEventListener("change", () => {
        checkboxes[key].checked = input.checked;
        actions.saveSetting(key, input.checked);
      });
      checkboxes[key] = input;
      return el("label", { class: "chk" }, [input, el("span", { text: label })]);
    }));

    const report = el("pre", { class: "report", "data-role": "report", text: "Idle. Paste a Share URL (or a /c/ chat URL) and run the bridge." });
    const runButton = el("button", { class: "b primary", type: "button", text: "Run bridge", onclick: () => actions.run(sourceInput.value.trim()) });
    const docxButton = el("button", { class: "b", type: "button", text: "Download DOCX", disabled: "1", onclick: () => actions.downloadDocx() });
    const zipButton = el("button", { class: "b", type: "button", text: "Download ZIP", disabled: "1", onclick: () => actions.downloadArchive() });
    const storeLine = el("div", { class: "note", "data-role": "store" });
    const folderButton = el("button", { class: "b", type: "button", text: "Choose output folder…", onclick: () => actions.chooseFolder() });

    tabs.export.append(
      el("div", { class: "row" }, [el("label", { class: "f", text: "Source" }), sourceInput]),
      el("div", { class: "btns" }, [runButton, docxButton, zipButton]),
      optionsRow,
      el("div", { class: "row" }, [el("span", { class: "f", text: "Output target" }), storeLine, folderButton]),
      report
    );

    // -------------------------------------------------------------- archives --
    const archiveList = el("ul", { class: "arch" });
    const refreshButton = el("button", { class: "b", type: "button", text: "Refresh", onclick: () => actions.refreshArchives() });
    const importInput = el("input", { type: "file", accept: ".zip,application/zip" });
    importInput.addEventListener("change", () => {
      const file = importInput.files?.[0];
      if (file) actions.importArchive(file);
      importInput.value = "";
    });

    tabs.archives.append(
      el("div", { class: "row" }, [
        el("span", { class: "f", text: "Permanent archives" }),
        el("p", { class: "note", text: "Regenerate a DOCX from any stored archive — offline, no share link needed. Archives are never overwritten." }),
      ]),
      el("div", { class: "btns" }, [refreshButton, el("label", { class: "b" }, [el("span", { text: "Import .zip" }), importInput])]),
      archiveList
    );

    // -------------------------------------------------------------- continue --
    tabs.continue.append(
      el("div", { class: "row" }, [
        el("h4", { text: "Continue this conversation in a new chat" }),
        el("p", {
          class: "note",
          text: "The documented flow is: send the DOCX with the CHAT CONTINUATION note, wait for the acknowledgement, then send the continuation instructions. These buttons stage each step in the composer for you.",
        }),
      ]),
      el("div", { class: "btns" }, [
        el("button", { class: "b", type: "button", text: "New chat", onclick: () => actions.newChat() }),
        el("button", { class: "b", type: "button", text: "Attach last DOCX", onclick: () => actions.attachDocx() }),
        el("button", { class: "b primary", type: "button", text: "Stage CHAT CONTINUATION", onclick: () => actions.stageContinuationMessage() }),
        el("button", { class: "b", type: "button", text: "Insert instructions", onclick: () => actions.stageInstructions() }),
        el("button", { class: "b", type: "button", text: "Copy instructions", onclick: () => actions.copyInstructions() }),
      ]),
      el("p", { class: "note", "data-role": "continue-status", text: "No DOCX staged yet — run the bridge first." })
    );

    // ------------------------------------------------------------------ help --
    tabs.help.append(
      el("div", { class: "row", html: HELP_HTML }),
      el("div", { class: "btns" }, [
        el("button", { class: "iconbtn", type: "button", text: "×", title: "Close", onclick: () => toggle(false) }),
      ])
    );

    // ------------------------------------------------------------ controller --
    const api = {
      host,
      show(next = true) {
        toggle(next);
      },
      toggle() {
        toggle();
      },
      setSource(value) {
        sourceInput.value = value;
      },
      setRunning(running) {
        runButton.disabled = running;
        runButton.textContent = running ? "Running…" : "Run bridge";
      },
      setProgress({ done, total }) {
        const wrap = panel.querySelector('[data-role="progress"]');
        if (!wrap) return;
        if (!total) {
          wrap.dataset.on = "0";
          return;
        }
        wrap.dataset.on = "1";
        wrap.querySelector('[data-role="progress-text"]').textContent = `Processing uploads: ${done}/${total}`;
        wrap.querySelector('[data-role="progress-fill"]').style.width = `${Math.round((done / total) * 100)}%`;
      },
      report(lines, { ok = true } = {}) {
        report.textContent = lines.join("\n");
        report.classList.toggle("ok", ok);
        report.classList.toggle("bad", !ok);
      },
      status(message) {
        const node = panel.querySelector('[data-role="continue-status"]');
        if (node) node.textContent = message;
      },
      storeLine(text) {
        storeLine.textContent = text;
      },
      enableDownloads({ docx = false, archive = false }) {
        docxButton.disabled = !docx;
        zipButton.disabled = !archive;
      },
      renderArchives(items, actionsFor) {
        archiveList.replaceChildren();
        if (!items.length) {
          archiveList.append(el("li", { class: "note", text: "No archives stored yet." }));
          return;
        }
        for (const item of items) {
          const row = el("li", {}, [
            el("span", { class: "nm", title: item.basename, text: item.basename }),
            el("span", { class: "meta", text: `${(item.size / 1024).toFixed(0)} KB` }),
            el("span", { class: "spacer" }),
            el("button", { class: "mini", type: "button", text: "DOCX", onclick: () => actionsFor(item).regenerate() }),
            el("button", { class: "mini", type: "button", text: "ZIP", onclick: () => actionsFor(item).download() }),
            el("button", { class: "mini", type: "button", text: "Delete", onclick: () => actionsFor(item).remove() }),
          ]);
          archiveList.append(row);
        }
      },
    };

    return api;
  }

  const HELP_HTML = `
  <h4>What this does</h4>
  <p>Retrieves a shared ChatGPT conversation, verifies the message chain, downloads supported
  images, writes a <strong>permanent ZIP archive</strong> and renders a <strong>DOCX record</strong>
  that can seed a new chat directly in the browser.</p>
  <h4>Inputs</h4>
  <p><code>https://chatgpt.com/share/&lt;id&gt;</code> — public share, the canonical flow.<br>
  <code>https://chatgpt.com/c/&lt;id&gt;</code> — your own live chat, read through the authenticated
  API (nothing needs to be publicly shared).<br>
  <code>Conversation Name</code> — regenerate a DOCX from a stored archive, fully offline.</p>
  <h4>Guarantees</h4>
  <p>Archives are never overwritten. Every archive is read back and CRC-checked before you are told
  it succeeded. A DOCX is only offered once both artifacts are valid. Reference URLs are written as
  plain text and ChatGPT's private <code>oaiusercontent.com</code> / <code>backend-api</code> links
  are dropped, so the document stays openable years later.</p>
  <h4>Shortcuts</h4>
  <p><code>Alt+B</code> toggles this panel.</p>
  `;

  /* ===== src/browser/main.js ===== */
  /*
   * Boot + wiring. Everything user-visible is assembled here: which storage
   * backend is live, running the bridge, persisting outputs, and the continuation
   * helpers. Core logic never touches the DOM, so it stays testable in Node.
   */












  const ROOT_HANDLE_KEY = "ccbr:outputRoot";

  function currentShareCandidate() {
    const path = location.pathname;
    if (/^\/share\//.test(path) || /^\/c\//.test(path)) return `${location.origin}${path}`;
    return "";
  }

  function isChatGptOrigin() {
    return /(^|\.)chatgpt\.com$/i.test(location.hostname);
  }

  function conversationIdFromUrl(url) {
    try {
      const parsed = new URL(url, location.origin);
      const match = /\/c\/([a-zA-Z0-9-]+)/.exec(parsed.pathname);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  async function boot({ version = "0.0.0", fetchAdapter = null } = {}) {
    let settings = await loadSettings();
    let store = null;
    let lastResult = null;

    const ui = mountUi({
      version,
      settings,
      initialSource: settings.lastSource || currentShareCandidate(),
      actions: {
        run: (source) => run(source),
        refreshArchives: () => refreshArchives(),
        chooseFolder: () => chooseFolder(),
        downloadDocx: () => downloadLast("docx"),
        downloadArchive: () => downloadLast("archive"),
        importArchive: (file) => importArchive(file),
        newChat: () => openNewChat(),
        attachDocx: () => attachLastDocx(),
        stageContinuationMessage: () => stage(CHAT_CONTINUATION_MESSAGE),
        stageInstructions: () => stage(CONTINUATION_INSTRUCTIONS),
        copyInstructions: () => copyInstructions(),
        saveSetting: async (key, value) => {
          settings = await saveSettings({ [key]: value });
        },
      },
    });

    const fail = (error) => {
      const message = error instanceof ExtractionError ? error.message : String(error?.message ?? error);
      ui.report([`ERROR: ${message}`], { ok: false });
      ui.setRunning(false);
      ui.setProgress({ done: 0, total: 0 });
    };

    // ------------------------------------------------------------- storage ----
    async function initStore() {
      if (settings.preferFolderStore && fileSystemAccessAvailable()) {
        const handle = await idbGetSetting(ROOT_HANDLE_KEY, null);
        if (handle) {
          try {
            const candidate = new FolderStore(handle);
            const permission = await candidate.permission();
            if (permission === "granted") {
              store = candidate;
              ui.storeLine(`${candidate.label} — archive/, docx/, temp/`);
              return;
            }
            ui.storeLine("Selected folder needs re-authorisation — open the panel and click “Choose output folder”.");
          } catch {
            /* handle no longer valid; fall through */
          }
        }
      }
      store = new IdbStore();
      ui.storeLine(
        fileSystemAccessAvailable()
          ? `${store.label} — archives persist in this browser; DOCX/ZIP are offered as downloads`
          : `${store.label} — this browser has no File System Access API, so outputs are downloaded`,
      );
    }

    async function chooseFolder() {
      if (!fileSystemAccessAvailable()) {
        ui.report(["ERROR: This browser has no File System Access API. Archives stay in IndexedDB and files are downloaded."], { ok: false });
        return;
      }
      try {
        const handle = await window.showDirectoryPicker({
          id: "ccbr-output-root",
          mode: "readwrite",
          startIn: "downloads",
        });
        await idbSetSetting(ROOT_HANDLE_KEY, handle);
        settings = await saveSettings({ preferFolderStore: true });
        store = new FolderStore(handle);
        await store.ensurePermission();
        // Initialize the directory layout for archives, documents, and scratch files.
        await store.dir("archive", { create: true });
        await store.dir("docx", { create: true });
        await store.dir("temp", { create: true });
        ui.storeLine(`${store.label} — archive/, docx/, temp/`);
        await refreshArchives();
        ui.report(["Output folder connected (archive/, docx/, temp/)."], { ok: true });
      } catch (error) {
        if (error?.name === "AbortError") return;
        fail(error);
      }
    }

    async function refreshArchives() {
      if (!store) return;
      try {
        const items = await store.listArchives();
        ui.renderArchives(items, (item) => ({
          regenerate: () => run(item.basename),
          download: () => downloadArchiveItem(item),
          remove: () => removeArchive(item),
        }));
      } catch (error) {
        fail(error);
      }
    }

    async function downloadArchiveItem(item) {
      try {
        const bytes = await store.read(item.name);
        if (!bytes) throw new ExtractionError(`Archive does not exist: ${item.name}`);
        downloadBytes(item.name, bytes, "application/zip");
      } catch (error) {
        fail(error);
      }
    }

    async function removeArchive(item) {
      // Deleting a permanent archive is the one irreversible action in this tool,
      // so it asks instead of trusting a click.
      const ok = window.confirm(
        `Delete the permanent archive "${item.basename}"?\n\n` +
          "If its DOCX is lost, this ZIP is the only way to regenerate it. The share link may no longer contain the same conversation.",
      );
      if (!ok) return;
      await store.remove(item.name);
      await refreshArchives();
    }

    async function importArchive(file) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // Validate before storing: an archive is permanent here, so a bad import
        // is worse than a rejected one.
        const label = file.name.replace(/\.zip$/i, "");
        await loadPublicShareArchive(bytes, label);
        const basename = sanitizeFilesystemBasename(label);
        await store.write(`archive/${basename}.zip`, bytesForStorage(bytes));
        await refreshArchives();
        ui.report([`Imported and verified: archive/${basename}.zip`, "Status:     IMPORT + VERIFY SUCCESS"], { ok: true });
      } catch (error) {
        fail(error);
      }
    }

    // ------------------------------------------------------------------ run ----
    async function run(source) {
      if (!store) await initStore();
      ui.setRunning(true);
      // Start clock immediately so duration covers fetches and image processing.
      const startedAt = Date.now();
      ui.report(["Start Time: " + formatReportInstant(startedAt), "Working…"]);
      ui.enableDownloads({ docx: false, archive: false });
      await saveSettings({ lastSource: source });

      try {
        const mode = detectMode(String(source ?? "").trim());
        if ((mode === "share" || mode === "live") && !isChatGptOrigin()) {
          // Same-origin is a functional requirement, not a policy preference:
          // the share endpoint is only reachable with the page session.
          throw new ExtractionError(
            "Share and live-chat retrieval must run on https://chatgpt.com (same-origin request). " +
              "Open a ChatGPT tab and run it there, or regenerate from a stored archive.",
          );
        }
        const result = await runBridge({
          source,
          startInstant: startedAt,
          archiveExists: (name) => store.has(name),
          readArchive: (name) => store.read(name),
          embedImages: settings.embedImages,
          includeTimestamps: settings.includeTimestamps,
          onProgress: (progress) => ui.setProgress(progress),
          fetchImpl: fetchAdapter ?? undefined,
        });
        lastResult = result;

        // Commit order: archive first, then the DOCX.
        if (result.archive) await store.write(result.archive.name, bytesForStorage(result.archive.bytes));
        const docxCommit = await store.writeDocx(bytesForStorage(result.docx.bytes), result.docx.name);

        if (docxCommit.mode === "memory" || settings.autoDownload) {
          downloadBytes(result.docx.name, result.docx.bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
          if (result.archive && (settings.autoDownload || docxCommit.mode === "memory")) {
            downloadBytes(result.archive.name, result.archive.bytes, "application/zip");
          }
        }

        ui.setProgress({ done: 0, total: 0 });
        ui.report(result.report.lines, { ok: true });
        ui.enableDownloads({ docx: true, archive: Boolean(result.archive) });
        ui.status(`Ready to continue: ${result.docx.name.split("/").pop()} ${docxCommit.mode === "saved" ? "saved" : "downloaded"}.`);
        await refreshArchives();
      } catch (error) {
        fail(error);
      } finally {
        ui.setRunning(false);
      }
    }

    function downloadLast(kind) {
      if (!lastResult) return;
      if (kind === "docx") downloadBytes(lastResult.docx.name, lastResult.docx.bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      else if (lastResult.archive) downloadBytes(lastResult.archive.name, lastResult.archive.bytes, "application/zip");
    }

    // --------------------------------------------------------- continuation ---
    async function stage(text) {
      if (!findComposer()) {
        ui.status("No composer on this page — open a ChatGPT chat first (New chat).");
        return;
      }
      const result = await insertIntoComposer(text, { replace: !composerHasText(findComposer()) });
      ui.status(
        result.ok
          ? `Staged in the composer via ${result.method}. Press send when you are ready.`
          : "Could not write to the composer — copy the text from the Help tab instead.",
      );
    }

    async function copyInstructions() {
      try {
        await navigator.clipboard.writeText(CONTINUATION_INSTRUCTIONS);
        ui.status("Continuation instructions copied to the clipboard.");
      } catch {
        ui.status("Clipboard blocked by the browser — use “Insert instructions” instead.");
      }
    }

    async function attachLastDocx() {
      if (!lastResult) {
        ui.status("Run the bridge first: there is no DOCX to attach yet.");
        return;
      }
      const name = lastResult.docx.name.split("/").pop();
      const file = new File([lastResult.docx.bytes.slice().buffer], name, {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const result = await attachFileToComposer(file);
      ui.status(
        result.ok
          ? `Attached ${name}. Send the CHAT CONTINUATION note, then insert the instructions.`
          : `ChatGPT did not accept a programmatic attach (${result.reason}). Drag ${name} into the composer instead.`,
      );
    }

    // ------------------------------------------------------------ shortcuts ---
    document.addEventListener("keydown", (event) => {
      if (event.altKey && (event.key === "b" || event.key === "B")) {
        event.preventDefault();
        event.stopPropagation();
        ui.toggle();
      }
    }, true);

    // Submit-on-demand is deliberately not automatic; only an explicit click of
    // the user's own send button sends a staged continuation.
    ui.report([
      "Ready.",
      isChatGptOrigin()
        ? "Paste a Share URL, or a /c/ chat URL for your own conversation."
        : "Not on chatgpt.com — share/live retrieval needs that origin; archive regeneration still works.",
    ]);
    await initStore();
    await refreshArchives();

    return { ui, run, store: () => store, conversationIdFromUrl, submitComposer };
  }


  // ---------------------------------------------------------------- boot ----
  const VERSION = "1.0.0";

  function startBridge() {
    Promise.resolve(boot({ version: VERSION, fetchAdapter: buildCrossOriginFetch() })).catch((error) => {
      console.error("[ChatGPT Conversation Bridge] failed to start:", error);
    });
  }

  /**
   * When the script runs on chatgpt.com the pipeline uses plain fetch, which is
   * same-origin and therefore already carries the session. From any other page
   * the public share endpoint is still reachable through the manager's request
   * bridge, so archive-only and share-only use keeps working.
   */
  function buildCrossOriginFetch() {
    if (/^chatgpt\.com$/i.test(location.hostname)) return null;
    const gmRequest = typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : null;
    if (!gmRequest) return null;
    return function gmFetch(url, init = {}) {
      return new Promise((resolve, reject) => {
        gmRequest({
          method: init.method || "GET",
          url,
          headers: init.headers || {},
          credentials: "include",
          responseType: "arraybuffer",
          onload(response) {
            const bytes = response.response
              ? new Uint8Array(response.response)
              : new TextEncoder().encode(response.responseText || "");
            const body = bytes;
            resolve({
              ok: response.status >= 200 && response.status < 300,
              status: response.status,
              async text() {
                return new TextDecoder().decode(body);
              },
              async json() {
                return JSON.parse(new TextDecoder().decode(body));
              },
              async arrayBuffer() {
                return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
              },
            });
          },
          onerror(detail) {
            reject(new Error("network error: " + (detail && detail.error ? detail.error : "blocked")));
          },
          ontimeout() {
            reject(new Error("request timed out"));
          },
        });
      });
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startBridge, { once: true });
  } else {
    startBridge();
  }
})();
