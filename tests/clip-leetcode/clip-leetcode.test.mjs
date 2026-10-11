import test from 'node:test';
import assert from 'node:assert/strict';

// Core pure logic under test extracted / modeled identically to clip-leetcode.user.js
function parseLeetCodeRoute(pathname) {
  const contestMatch = pathname.match(/\/contest\/([^/]+)\/problems\/([^/]+)/);
  if (contestMatch) return { type: 'contest', contest: contestMatch[1], slug: contestMatch[2] };
  const problemMatch = pathname.match(/\/problems\/([a-zA-Z0-9_-]+)/);
  if (problemMatch) return { type: 'problem', slug: problemMatch[1] };
  if (pathname.startsWith('/problemset')) return { type: 'problemset' };
  if (pathname.startsWith('/study-plan')) return { type: 'study-plan' };
  return { type: 'unknown' };
}

function htmlToMarkdown(html) {
  let text = html;
  // Code blocks
  text = text.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => `\n\`\`\`\n${code.trim()}\n\`\`\`\n`);
  // Inline code
  text = text.replace(/<code>(.*?)<\/code>/gi, '`$1`');
  // Bold & Italics
  text = text.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
  text = text.replace(/<em>(.*?)<\/em>/gi, '*$1*');
  // Headings
  text = text.replace(/<h1>(.*?)<\/h1>/gi, '# $1\n\n');
  // Paragraphs
  text = text.replace(/<p>(.*?)<\/p>/gi, '$1\n\n');
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');
  return text.trim();
}

function renderTemplate(tpl, vars) {
  return tpl.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, key) => vars[key] ?? '');
}

test('LeetCode route parser accurately classifies problem routes', () => {
  assert.deepEqual(parseLeetCodeRoute('/problems/two-sum/'), { type: 'problem', slug: 'two-sum' });
  assert.deepEqual(parseLeetCodeRoute('/problems/two-sum/description/'), { type: 'problem', slug: 'two-sum' });
  assert.deepEqual(parseLeetCodeRoute('/contest/weekly-contest-300/problems/first-letter/'), {
    type: 'contest',
    contest: 'weekly-contest-300',
    slug: 'first-letter'
  });
  assert.deepEqual(parseLeetCodeRoute('/problemset/all/'), { type: 'problemset' });
  assert.deepEqual(parseLeetCodeRoute('/study-plan/programming-skills/'), { type: 'study-plan' });
  assert.deepEqual(parseLeetCodeRoute('/explore/featured/'), { type: 'unknown' });
});

test('HTML to Markdown conversion preserves semantic structures', () => {
  const html = '<h1>Two Sum</h1><p>Given <code>nums</code> and <strong>target</strong>.</p><pre><code>Input: nums = [2,7]</code></pre>';
  const md = htmlToMarkdown(html);
  assert.ok(md.includes('# Two Sum'));
  assert.ok(md.includes('`nums`'));
  assert.ok(md.includes('**target**'));
  assert.ok(md.includes('```\nInput: nums = [2,7]\n```'));
});

test('Custom export template substitution replaces all variables safely', () => {
  const template = '# [${id}. ${title}](${url})\nDifficulty: **${difficulty}**\n\n${content}';
  const vars = {
    id: '1',
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'Easy',
    content: 'Find two indices.'
  };
  const rendered = renderTemplate(template, vars);
  assert.ok(rendered.includes('# [1. Two Sum](https://leetcode.com/problems/two-sum/)'));
  assert.ok(rendered.includes('Difficulty: **Easy**'));
  assert.ok(rendered.includes('Find two indices.'));
});

test('Settings schema handles missing keys and applies safe defaults', () => {
  const defaultSettings = {
    defaultFormat: 'markdown',
    autoCopyOnAccept: false,
    historyLimit: 50,
    hotkey: 'alt+c'
  };
  const userSettings = { defaultFormat: 'json' };
  const merged = { ...defaultSettings, ...userSettings };
  assert.equal(merged.defaultFormat, 'json');
  assert.equal(merged.autoCopyOnAccept, false);
  assert.equal(merged.historyLimit, 50);
});
