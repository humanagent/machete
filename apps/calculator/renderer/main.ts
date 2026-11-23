// The calculator panel: type a line, its result shows on the right as you type. Click a result to copy it.
import { Effect, Stream } from 'effect';
import { byId, fromBridge, runMain } from '../../../core/renderer/runtime';
import { evaluateSheet, type Rates } from '../evaluate';
import type { CalculatorBridge, CalculatorState } from '../ipc';

declare global {
  interface Window {
    readonly calculator: CalculatorBridge;
  }
}

const el = {
  sheet: byId<HTMLTextAreaElement>('sheet'),
  paint: byId('paint'),
  results: byId('results'),
  share: byId<HTMLButtonElement>('share'),
};
let shared = false;
let rates: Rates = { USD: 1 };
let opened = -1;

const span = (text: string, kind = '') => {
  const s = document.createElement('span');
  s.textContent = text;
  if (kind) s.className = kind;
  return s;
};

// Like Numi: headings (#) and comments (//) in their own color, variables (and prev/sum/total/avg) in blue.
const paint = (text: string) => {
  const lines = text.split('\n');
  const vars = new Set(['prev', 'sum', 'total', 'avg', 'average']);
  for (const line of lines) {
    const name = /^\s*([A-Za-z_]\w*)\s*=/.exec(line)?.[1];
    if (name) vars.add(name);
  }
  el.paint.replaceChildren(
    ...lines.flatMap((line, i) => {
      const t = line.trimStart();
      const parts: Array<Node> = t.startsWith('#')
        ? [span(line, 'h')]
        : t.startsWith('//')
          ? [span(line, 'c')]
          : line.split(/([A-Za-z_]\w*)/).map((w) => span(w, vars.has(w) ? 'v' : ''));
      return i === 0 ? parts : [document.createTextNode('\n'), ...parts];
    }),
  );
};

const EYE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.200 4.200"/><path d="M3 3l18 18"/></svg>';
const showShare = () => {
  el.share.innerHTML = shared ? EYE : EYE_OFF;
  el.share.classList.toggle('on', shared);
  el.share.title = shared
    ? 'Visible in screen sharing. Click to hide it.'
    : 'Hidden from screen sharing. Click to show it.';
};
el.share.addEventListener('mousedown', (e) => e.preventDefault()); // keeps the caret in the sheet
el.share.addEventListener('click', () => {
  shared = !shared;
  showShare();
  window.calculator.send({ _tag: 'SetShared', shared });
});

const syncScroll = () => {
  el.paint.scrollTop = el.sheet.scrollTop;
  el.paint.scrollLeft = el.sheet.scrollLeft;
  el.results.scrollTop = el.sheet.scrollTop;
};

const render = () => {
  paint(el.sheet.value);
  const lines = evaluateSheet(el.sheet.value, rates);
  el.results.replaceChildren(
    ...lines.map((r) => {
      const div = document.createElement('div');
      div.textContent = r.text;
      if (r.text !== '') div.dataset['v'] = r.text;
      return div;
    }),
  );
  syncScroll();
};

let saveTimer = 0;
el.sheet.addEventListener('input', () => {
  render();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => window.calculator.send({ _tag: 'SetText', text: el.sheet.value }), 300);
});
el.sheet.addEventListener('scroll', syncScroll);
el.results.addEventListener('click', (e) => {
  const div = e.target instanceof HTMLElement ? e.target : null;
  const v = div?.dataset['v'];
  if (!div || v === undefined) return;
  // Copies the number as typed elsewhere: no thousands separators.
  window.calculator.send({ _tag: 'Copy', text: v.replace(/,/g, '') });
  div.classList.add('copied');
  setTimeout(() => div.classList.remove('copied'), 600);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    window.calculator.send({ _tag: 'Close' });
  }
});

const onState = (state: CalculatorState) =>
  Effect.sync(() => {
    rates = state.rates;
    shared = state.shared;
    showShare();
    if (state.opened !== opened) {
      opened = state.opened;
      if (document.activeElement !== el.sheet || el.sheet.value === '') el.sheet.value = state.text;
      el.sheet.focus();
      el.sheet.setSelectionRange(el.sheet.value.length, el.sheet.value.length);
      el.sheet.scrollTop = el.sheet.scrollHeight;
    }
    render();
  });

runMain(fromBridge(window.calculator.onState).pipe(Stream.runForEach(onState)));
