// ==UserScript==
// @name Manager execution control (offline audit fixture)
// @namespace https://siat.invalid/audit
// @version 1.0.0
// @match http://127.0.0.1/*
// @run-at document-start
// @grant GM_info
// @grant GM_registerMenuCommand
// ==/UserScript==
(function () {
  'use strict';
  function ready() {
    const marker = document.createElement('span');
    marker.id = 'manager-execution-control';
    marker.textContent = GM_info.scriptHandler + '/' + GM_info.version;
    document.documentElement.appendChild(marker);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
  GM_registerMenuCommand('Offline manager execution control', ready);
})();
