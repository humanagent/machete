import { expect, test } from 'bun:test';
import { inline, renderBody, segments } from '../../../src/products/copilot/markdown';

test('segments split on fenced code', () => {
  expect(segments('Intro\n```python\nprint(1)\n```\nOutro')).toEqual([
    { code: false, text: 'Intro' },
    { code: true, text: 'print(1)' },
    { code: false, text: 'Outro' },
  ]);
});

test('inline markdown: bold, italic, code, links, escaping', () => {
  expect(inline('**TP** and *x* and `a<b`')).toBe(
    '<strong>TP</strong> and <em>x</em> and <code>a&lt;b</code>',
  );
  expect(inline('see [docs](https://example.com)')).toBe('see <a href="https://example.com">docs</a>');
  expect(inline('[bad](javascript:alert(1))')).toBe('[bad](javascript:alert(1))');
  expect(inline('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
  expect(inline('snake_case_name stays')).toBe('snake_case_name stays');
  expect(inline('2 * 3 * 4')).toBe('2 * 3 * 4');
  expect(inline('~~old~~ ***both***')).toBe('<del>old</del> <strong><em>both</em></strong>');
});

test('renderBody wraps code and paragraphs', () => {
  expect(renderBody('Hi\n```\n<x>\n```')).toBe(
    '<div class="para">Hi</div><div class="code"><pre>&lt;x&gt;</pre></div>',
  );
});
