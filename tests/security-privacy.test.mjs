import test from 'node:test';
import assert from 'node:assert/strict';

function sanitizeLogMessage(msg, sensitiveValues = []) {
  let text = String(msg);
  // Redact common auth patterns and explicit sensitive values
  text = text.replace(/([a-zA-Z0-9_\-]{32,})/g, (token) => token.slice(0, 4) + '...' + token.slice(-4));
  text = text.replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]');
  text = text.replace(/(token|api_key|password|secret)=([^&\s]+)/gi, '$1=[REDACTED]');

  for (const s of sensitiveValues) {
    if (s && s.length > 3) {
      text = text.replaceAll(s, '[REDACTED]');
    }
  }
  return text;
}

function resolveSafeTabAttributes(userFeatures = '') {
  const defaults = ['noopener', 'noreferrer'];
  const merged = new Set(defaults);
  if (userFeatures) {
    userFeatures.split(',').forEach(f => {
      const trimmed = f.trim();
      if (trimmed) merged.add(trimmed);
    });
  }
  return Array.from(merged).join(',');
}

function isHostAllowed(host, allowlist) {
  if (allowlist.has('*')) return false; // Wildcard disallowed by policy
  return allowlist.has(host.toLowerCase());
}

test('Diagnostic logger redacts sensitive credentials, tokens and passwords', () => {
  const secretApiKey = 'sk-proj-9876543210abcdef9876543210abcdef';
  const rawLog = `Request failed to endpoint: https://api.service.com/query?token=${secretApiKey}&user=test`;

  const sanitized = sanitizeLogMessage(rawLog, [secretApiKey]);
  assert.equal(sanitized.includes(secretApiKey), false);
  assert.ok(sanitized.includes('[REDACTED]'));
});

test('Safe tab opening always includes noopener and noreferrer', () => {
  const features = resolveSafeTabAttributes('width=800,height=600');
  assert.ok(features.includes('noopener'));
  assert.ok(features.includes('noreferrer'));
});

test('Network policy asserts blocked destinations are rejected without wildcard', () => {
  const allowlist = new Set(['archive.org', 'web.archive.org', 'chatgpt.com']);

  assert.equal(isHostAllowed('web.archive.org', allowlist), true);
  assert.equal(isHostAllowed('chatgpt.com', allowlist), true);
  assert.equal(isHostAllowed('unauthorized-api.com', allowlist), false);
  assert.equal(isHostAllowed('evil-tracker.net', allowlist), false);
});
