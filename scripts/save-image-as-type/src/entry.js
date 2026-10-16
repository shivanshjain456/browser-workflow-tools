/**
 * Production entry. No page-writable flags, test hooks or privileged exports.
 * Verification: import src/main.js and core/encoder ES modules offline; see
 * audit/README.md in the accompanying source capsule. The installed IIFE never
 * exposes its internals. No isolation claim is inferred from GM_info metadata.
 *
 * Privacy/security invariants: manager-only persistence; zero boot network;
 * image-only user-initiated fetches, no telemetry/uploads/executable downloads;
 * no dynamic code/HTML sinks; no capability handles on DOM/window. lint.mjs
 * checks forbidden sinks and scope, tests pin deterministic encoder bytes.
 * Frame policy: document-local interaction including subframes; eight manager
 * commands in the top frame only. This is not cross-manager arbitration.
 */
import { startProduction } from './main.js';
startProduction();
