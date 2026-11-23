// One design for every window: what's decided in core/design stays there.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAP, GLASS_TINT, glassCss, ON_GLASS, RADIUS, TOKENS, tokensCss } from '../../core/design/tokens';

const root = join(import.meta.dir, '../..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const components = read('core/design/machete.css');
/** The apps' pages and stylesheets. (Settings and the permissions guide are opaque windows with their own.) */
const pages = [...new Bun.Glob('apps/*/renderer/**/*.{html,css}').scanSync(root)];
const htmls = pages.filter((f) => f.endsWith('.html'));
/** What paints a page: its stylesheet, or the <style> in its html. */
const styles = (f: string) =>
  f.endsWith('.css')
    ? read(f)
    : [...read(f).matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

describe('single source', () => {
  test('every app page has the design, and none declares its own font or colors', () => {
    expect(htmls.length).toBeGreaterThanOrEqual(8);
    for (const f of htmls) expect([f, read(f).includes('href="../machete.css"')]).toEqual([f, true]);
    for (const f of pages) {
      expect([
        f,
        styles(f).match(/#[0-9a-f]{3,8}\b(?=[^{]*;)|\b(?:rgba?|hsla?)\((?!var\()[^)]*\)/gi),
      ]).toEqual([f, null]);
      expect([f, styles(f).includes('@font-face')]).toEqual([f, false]);
    }
  });

  test('the components have no colors of their own either, outside more contrast', () => {
    const usual = components.slice(0, components.indexOf('@media (prefers-contrast'));
    expect(usual.match(/#[0-9a-f]{3,8}\b|\brgba?\(/gi)).toBeNull();
  });

  test('every variable used exists, and every token is used', () => {
    const css = [components, ...pages.map(styles)].join('\n');
    const local = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
    const all = [tokensCss(), glassCss(), css].join('\n');
    const used = new Set([...all.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!));
    const known = new Set([...Object.keys(TOKENS).map((t) => `--${t}`), ...local, '--body-alpha']);
    expect([...used].filter((v) => !known.has(v))).toEqual([]);
    // surface-glass is what ON_GLASS gives to surface.
    const given = new Set<string>(['--surface-glass']);
    expect(Object.keys(TOKENS).filter((t) => !used.has(`--${t}`) && !given.has(`--${t}`))).toEqual([]);
  });

  test('what changes on glass are tokens', () => {
    for (const name of Object.keys(ON_GLASS)) expect(Object.keys(TOKENS)).toContain(name);
    expect(glassCss()).toContain(`--radius-panel: ${RADIUS.panel}px;`);
    expect(tokensCss()).toContain(`--radius-panel: ${RADIUS.system}px;`);
  });
});

test('corners are concentric', () => {
  const { panel, sheet }: Readonly<Record<'panel' | 'sheet', number>> = RADIUS;
  expect(sheet).toBe(panel - GAP);
});

/** The contrast of white-ish text on the panels, over the worst thing behind it: white. */
const luminance = (rgb: ReadonlyArray<number>) => {
  const [r, g, b] = rgb.map((c) =>
    c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const parse = (css: string) => (css.match(/[\d.]+/g) ?? []).map(Number);
const hex = (css: string) => [1, 3, 5].map((i) => Number.parseInt(css.slice(i, i + 2), 16));

test('text reads on a panel without glass, whatever is behind', () => {
  const [r, g, b, alpha] = parse(TOKENS.surface);
  const over = [r!, g!, b!].map((c) => c * alpha! + 255 * (1 - alpha!));
  expect(contrast(hex(TOKENS.text), over)).toBeGreaterThanOrEqual(7);
  expect(contrast(hex(TOKENS['text-dim']), over)).toBeGreaterThanOrEqual(4.5);
});

test('text reads on the opaque sheet and on the accent', () => {
  for (const ink of ['calc-text', 'calc-heading', 'calc-comment', 'calc-variable', 'calc-result'] as const)
    expect(contrast(hex(TOKENS[ink]), hex(TOKENS.sheet))).toBeGreaterThanOrEqual(4.5);
  expect(contrast(hex(TOKENS.text), hex(TOKENS.accent))).toBeGreaterThanOrEqual(4.5);
});

test('less transparency, more contrast and less motion win over the glass', () => {
  const part = (q: string) => components.slice(components.indexOf(`@media (${q}`)).split('\n}\n')[0]!;
  for (const q of ['prefers-reduced-transparency: reduce', 'prefers-contrast: more']) {
    expect(part(q)).toContain('--surface: var(--surface-opaque);');
    expect(part(q)).toContain('--copilot-alpha: 1;');
    // More specific than what glassCss() inserts.
    expect(part(q)).toContain(':root:root:root {');
  }
  expect(glassCss()).toStartWith(':root:root {');
  expect(part('prefers-reduced-motion: reduce')).toContain('animation: none');
});

test('one panel per page, and a single main button', () => {
  for (const f of htmls) {
    const body = read(f).slice(read(f).indexOf('<body>'));
    expect([f, (body.match(/class="panel[ "]/g) ?? []).length <= 1]).toEqual([f, true]);
    expect([f, (body.match(/class="btn primary"/g) ?? []).length <= 1]).toEqual([f, true]);
  }
  for (const f of [...pages, 'core/design/machete.css'])
    expect(styles(f.endsWith('.html') ? f : f)).not.toContain('backdrop-filter');
});

test('the panels are glass: neutral, and most of what’s behind comes through', () => {
  const neutral = (rgb: ReadonlyArray<number>) => Math.max(...rgb) - Math.min(...rgb);
  for (const t of ['surface', 'surface-glass', 'surface-opaque', 'veil'] as const)
    expect(neutral(parse(TOKENS[t]).slice(0, 3))).toBeLessThanOrEqual(6);
  for (const t of ['text-soft', 'text-dim', 'sheet', 'veil-hover'] as const)
    expect(neutral(hex(TOKENS[t]))).toBeLessThanOrEqual(10);
  expect(neutral(GLASS_TINT.slice(0, 3).map((c) => c * 255))).toBeLessThanOrEqual(6);
  const through = (1 - GLASS_TINT[3]) * (1 - parse(TOKENS['surface-glass'])[3]!);
  expect(through).toBeGreaterThanOrEqual(0.85);
  // Copilot is darker, and still glass as it comes (Settings' “Balanced”).
  expect(ON_GLASS['copilot-alpha']).toBe('max(0.2, calc(var(--body-alpha) * 2.1 - 1.06))');
  const copilot = (opacity: number) => Math.max(0.2, (0.5 + 0.5 * opacity) * 2.1 - 1.06);
  expect(copilot(0.35)).toBeLessThan(0.4);
  expect(copilot(0.55)).toBeGreaterThan(0.5);
  expect(copilot(0.55)).toBeLessThan(0.65);
  expect(copilot(0.8)).toBeGreaterThan(0.8);
  expect(read('native/glass/glass.mm')).toContain('.style = kClear');
});
