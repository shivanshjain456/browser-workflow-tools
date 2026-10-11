import test from 'node:test';
import assert from 'node:assert/strict';

function parseViewCount(str) {
  if (!str) return 0;
  const clean = str.replace(/[^0-9.KMkmBb]/g, '').toUpperCase();
  if (clean.endsWith('K')) return Math.round(parseFloat(clean.slice(0, -1)) * 1_000);
  if (clean.endsWith('M')) return Math.round(parseFloat(clean.slice(0, -1)) * 1_000_000);
  if (clean.endsWith('B')) return Math.round(parseFloat(clean.slice(0, -1)) * 1_000_000_000);
  return parseInt(clean, 10) || 0;
}

function parseDurationSec(str) {
  if (!str) return 0;
  const parts = str.trim().split(':').map(p => parseInt(p, 10) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function computeRankingScore(item, weights) {
  // item: { views, ageDays, verified }
  // weights: { viewWeight, freshnessWeight, verifiedBonus }
  const logViews = Math.log10(Math.max(1, item.views));
  const freshness = Math.max(0, 100 - item.ageDays);
  const verifiedScore = item.verified ? weights.verifiedBonus : 0;

  return (logViews * weights.viewWeight) + (freshness * weights.freshnessWeight) + verifiedScore;
}

function resolveChannelPrecedence(videoId, channelId, context, rules) {
  // Precedence order:
  // 1. Explicit video verdict
  if (rules.videoVerdicts?.[videoId]) return { scope: 'video', action: rules.videoVerdicts[videoId] };
  // 2. Channel policy
  if (rules.channelPolicies?.[channelId]) return { scope: 'channel', action: rules.channelPolicies[channelId] };
  // 3. Search context profile
  if (rules.contextProfiles?.[context]) return { scope: 'context', action: rules.contextProfiles[context] };
  // 4. Global default
  return { scope: 'global', action: rules.globalDefault || 'keep' };
}

test('Locale-aware view count parser correctly normalizes abbreviations', () => {
  assert.equal(parseViewCount('125K views'), 125_000);
  assert.equal(parseViewCount('1.5M views'), 1_500_000);
  assert.equal(parseViewCount('2.3B views'), 2_300_000_000);
  assert.equal(parseViewCount('450 views'), 450);
  assert.equal(parseViewCount(''), 0);
});

test('Duration parser converts HH:MM:SS strings to total seconds', () => {
  assert.equal(parseDurationSec('3:45'), 225);
  assert.equal(parseDurationSec('1:02:15'), 3735);
  assert.equal(parseDurationSec('0:59'), 59);
  assert.equal(parseDurationSec('invalid'), 0);
});

test('Multi-signal ranking algorithm scores verified and authoritative videos higher', () => {
  const weights = { viewWeight: 10, freshnessWeight: 0.5, verifiedBonus: 15 };

  const highQuality = { views: 100_000, ageDays: 10, verified: true };
  const lowQuality = { views: 500, ageDays: 120, verified: false };

  const scoreHigh = computeRankingScore(highQuality, weights);
  const scoreLow = computeRankingScore(lowQuality, weights);

  assert.ok(scoreHigh > scoreLow);
});

test('Channel policy precedence evaluates in strictly deterministic order', () => {
  const rules = {
    videoVerdicts: { 'vid_1': 'pin' },
    channelPolicies: { 'chan_1': 'hide', 'chan_2': 'boost' },
    contextProfiles: { 'coding': 'strict' },
    globalDefault: 'keep'
  };

  // Video verdict beats channel policy
  const res1 = resolveChannelPrecedence('vid_1', 'chan_1', 'coding', rules);
  assert.equal(res1.scope, 'video');
  assert.equal(res1.action, 'pin');

  // Channel policy beats context profile
  const res2 = resolveChannelPrecedence('vid_2', 'chan_1', 'coding', rules);
  assert.equal(res2.scope, 'channel');
  assert.equal(res2.action, 'hide');

  // Context profile beats global default
  const res3 = resolveChannelPrecedence('vid_3', 'chan_other', 'coding', rules);
  assert.equal(res3.scope, 'context');
  assert.equal(res3.action, 'strict');

  // Falls back to global
  const res4 = resolveChannelPrecedence('vid_4', 'chan_other', 'gaming', rules);
  assert.equal(res4.scope, 'global');
  assert.equal(res4.action, 'keep');
});
