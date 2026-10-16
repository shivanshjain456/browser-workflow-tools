/**
 * Data-only ingress for settings, imports, presets and manager change events.
 *
 * Do not merge an external object before passing this boundary. Only own data
 * descriptors cross it: inherited fields, accessors and prototype-control keys
 * are ignored. Records use a null prototype, so subsequent assignment cannot
 * invoke the legacy prototype setter. This is not an executable-object sandbox:
 * a hostile Proxy can run traps, and a hostile shared world can replace JS
 * intrinsics. Supported transport inputs are JSON and manager-stored data.
 *
 * Traversal is bounded and iterative in breadth; recursive depth is at most 16.
 * The byte/string limit applies BEFORE JSON parsing, not just to its result.
 */
import { configMessage } from './messages.js';

export const CONFIG_DATA_LIMITS = Object.freeze({
  jsonBytes: 1024 * 1024,
  nodes: 16384,
  depth: 16,
  entries: 2048,
  stringChars: 65536,
});
const CONFIG_BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function cleanConfigData(value) {
  let remaining = CONFIG_DATA_LIMITS.nodes;
  const ancestors = new WeakSet();
  const visit = (input, depth) => {
    if (--remaining < 0 || depth > CONFIG_DATA_LIMITS.depth) return null;
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    if (typeof input === 'string') return input.slice(0, CONFIG_DATA_LIMITS.stringChars);
    if (!input || typeof input !== 'object' || ancestors.has(input)) return null;
    ancestors.add(input);
    const array = Array.isArray(input);
    const output = array ? [] : Object.create(null);
    try {
      if (array) {
        // Reading array length via a descriptor avoids arbitrary index getters.
        const count = Math.min(Object.getOwnPropertyDescriptor(input, 'length').value, CONFIG_DATA_LIMITS.entries);
        for (let i = 0; i < count && remaining > 0; i += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
          output.push(descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? visit(descriptor.value, depth + 1) : null);
        }
      } else {
        let count = 0;
        for (const key in input) {
          if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
          if (++count > CONFIG_DATA_LIMITS.entries || remaining <= 0) break;
          if (CONFIG_BLOCKED_KEYS.has(key)) continue;
          const descriptor = Object.getOwnPropertyDescriptor(input, key);
          if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) output[key] = visit(descriptor.value, depth + 1);
        }
      }
    } finally {
      ancestors.delete(input);
    }
    return output;
  };
  return visit(value, 0);
}

export function parseConfigJson(text) {
  if (typeof text !== 'string' || text.length > CONFIG_DATA_LIMITS.jsonBytes || new TextEncoder().encode(text).length > CONFIG_DATA_LIMITS.jsonBytes) throw new Error(configMessage('tooLarge'));
  return cleanConfigData(JSON.parse(text));
}

/** Never invoke external valueOf/toString while validating primitive fields. */
export function configNumber(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') ? NaN : Number(value);
}
export function configString(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') ? '' : String(value);
}
