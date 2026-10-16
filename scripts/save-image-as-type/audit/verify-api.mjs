/**
 * Offline verification API, contract version 1 (NOT an installed-page API).
 *
 * import { verificationApi } from './audit/verify-api.mjs';
 *
 * No DOM, manager or network is required for the writer/schema calls. Inputs
 * must obey the signatures below; malformed input can return validation warnings
 * or throw an Error. No compatibility is promised for other module bindings.
 *
 * encodeBmp({width,height,data:Uint8ClampedArray}, options?) -> Uint8Array
 * encodeGif([{imageData:{width,height,data},delayMs}], options?) -> Uint8Array
 * encodePdf({jpegBytes:Uint8Array,width,height,pageFit?,margin?,title?,now?}) -> Uint8Array
 * encodeZip([{name,bytes,mtime?}], {comment?,now?,dedupe?}?) -> {bytes,entries,notes}
 * normalizeSettings(raw) -> {settings,warnings,recovered}
 * validateImportedSettings(text) -> {ok,errors,settings,warnings?,migratedFrom?}
 *
 * Clocks are injected for PDF/ZIP. See audit/golden-inputs.mjs for runnable calls.
 * This file is distributed with source, not imported by src/entry.js, and cannot
 * be activated by an HTML attribute, a page global or a production option.
 */
import {encodeBmp} from '../src/encoders/bmp.js';
import {encodeGif} from '../src/encoders/gif.js';
import {encodePdf} from '../src/encoders/pdf.js';
import {encodeZip} from '../src/encoders/zip.js';
import {normalizeSettings,validateImportedSettings} from '../src/core/settings.js';
export const verificationApi=Object.freeze({version:1,encodeBmp,encodeGif,encodePdf,encodeZip,normalizeSettings,validateImportedSettings});
