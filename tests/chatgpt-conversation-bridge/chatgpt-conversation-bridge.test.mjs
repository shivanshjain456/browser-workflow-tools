import test from 'node:test';
import assert from 'node:assert/strict';

function validateChatGPTUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const validHosts = ['chatgpt.com', 'chat.openai.com'];
    if (!validHosts.includes(url.hostname)) return false;
    if (url.pathname.startsWith('/share/') || url.pathname.startsWith('/c/')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeBasename(title) {
  return title
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'conversation';
}

function reconstructMessageChain(mapping, currentNodeId) {
  const chain = [];
  let curr = mapping[currentNodeId];
  while (curr) {
    if (curr.message && curr.message.content) {
      chain.unshift({
        id: curr.message.id,
        role: curr.message.author?.role || 'unknown',
        parts: curr.message.content.parts || []
      });
    }
    curr = curr.parent ? mapping[curr.parent] : null;
  }
  return chain;
}

function crc32(bytes) {
  let crc = 0 ^ -1;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ TABLE_CRC[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

const TABLE_CRC = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  TABLE_CRC[i] = c;
}

test('ChatGPT URL validator only allows verified share and conversation endpoints', () => {
  assert.equal(validateChatGPTUrl('https://chatgpt.com/share/658b1234-abcd-1234'), true);
  assert.equal(validateChatGPTUrl('https://chatgpt.com/c/658b1234-abcd-1234'), true);
  assert.equal(validateChatGPTUrl('https://chat.openai.com/share/658b1234-abcd-1234'), true);
  assert.equal(validateChatGPTUrl('https://chatgpt.com/settings'), false);
  assert.equal(validateChatGPTUrl('https://attacker.com/share/fake'), false);
  assert.equal(validateChatGPTUrl('javascript:alert(1)'), false);
});

test('XML escaping prevents markup corruption in OOXML DOCX generation', () => {
  assert.equal(escapeXml('A & B < C > "quotes" \'apostrophe\''), 'A &amp; B &lt; C &gt; &quot;quotes&quot; &apos;apostrophe&apos;');
  assert.equal(escapeXml('<w:p>Injected XML</w:p>'), '&lt;w:p&gt;Injected XML&lt;/w:p&gt;');
});

test('Filename sanitizer strips illegal Windows/POSIX characters', () => {
  assert.equal(sanitizeBasename('My: Great "Project"? / Yes <No> | *'), 'My_ Great _Project__ _ Yes _No_ _ _');
  assert.equal(sanitizeBasename('   Clean Title   '), 'Clean Title');
  assert.equal(sanitizeBasename(''), 'conversation');
});

test('Conversation DAG reconstruction recovers chronological message sequence', () => {
  const mapping = {
    root: { id: 'root', parent: null, message: null },
    msg1: {
      id: 'msg1',
      parent: 'root',
      message: { id: 'm1', author: { role: 'user' }, content: { parts: ['Hello'] } }
    },
    msg2: {
      id: 'msg2',
      parent: 'msg1',
      message: { id: 'm2', author: { role: 'assistant' }, content: { parts: ['World'] } }
    }
  };

  const chain = reconstructMessageChain(mapping, 'msg2');
  assert.equal(chain.length, 2);
  assert.equal(chain[0].role, 'user');
  assert.equal(chain[0].parts[0], 'Hello');
  assert.equal(chain[1].role, 'assistant');
  assert.equal(chain[1].parts[0], 'World');
});

test('CRC32 checksum produces deterministic standard ZIP checksums', () => {
  const text = new TextEncoder().encode('123456789');
  assert.equal(crc32(text), 0xCBF43926);
});
