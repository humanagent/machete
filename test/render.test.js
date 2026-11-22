'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/renderer/overlay/markdown');

test('segments split on fenced code like BodyView', () => {
  const segs = M.segments('Intro\n```python\nprint(1)\n```\nOutro');
  assert.deepEqual(segs, [{ code: false, text: 'Intro' }, { code: true, text: 'print(1)' }, { code: false, text: 'Outro' }]);
});

test('inline markdown: bold, italic, code, links, escaping', () => {
  assert.equal(M.inline('**TP** and *x* and `a<b`'), '<strong>TP</strong> and <em>x</em> and <code>a&lt;b</code>');
  assert.equal(M.inline('see [docs](https://example.com)'), 'see <a href="https://example.com">docs</a>');
  assert.equal(M.inline('[bad](javascript:alert(1))'), '[bad](javascript:alert(1))');
  assert.equal(M.inline('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.equal(M.inline('snake_case_name stays'), 'snake_case_name stays');
  assert.equal(M.inline('2 * 3 * 4'), '2 * 3 * 4');
});

test('renderBody wraps code and paragraphs', () => {
  const html = M.renderBody('Hi\n```\n<x>\n```');
  assert.equal(html, '<div class="para">Hi</div><div class="code"><pre>&lt;x&gt;</pre></div>');
});
