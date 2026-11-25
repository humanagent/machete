// The rewrite panel: type to filter the list, or type any instruction. ↑↓ and ↩, or ⌘1–9; Esc closes.
import { Effect, Stream } from 'effect';
import { ghost } from '../../../core/renderer/ghost';
import { byId, fromBridge, runMain } from '../../../core/renderer/runtime';
import type { RewriteBridge, RewriteState } from '../ipc';
import { PRESETS } from '../presets';

declare global {
  interface Window {
    readonly rewrite: RewriteBridge;
  }
}

const el = { ask: byId<HTMLInputElement>('ask'), list: byId('list'), text: byId('text') };
let selected = 0;
let opened = -1;
const ghostButton = ghost();

interface Choice {
  readonly name: string;
  readonly instruction: string;
}
/** The presets that match what was typed, then the typed words themselves as an instruction. */
const choices = (): ReadonlyArray<Choice> => {
  const typed = el.ask.value.trim();
  const found = PRESETS.filter((p) => p.name.toLowerCase().includes(typed.toLowerCase()));
  return typed === '' ? found : [...found, { name: `“${typed}”`, instruction: typed }];
};

const apply = (choice: Choice | undefined) => {
  if (choice) window.rewrite.send({ _tag: 'Apply', instruction: choice.instruction });
};

const render = () => {
  const items = choices();
  selected = Math.max(0, Math.min(selected, items.length - 1));
  el.list.replaceChildren(
    ...items.map((choice, i) => {
      const li = document.createElement('li');
      li.classList.toggle('selected', i === selected);
      const name = document.createElement('span');
      name.className = 'text';
      name.textContent = choice.name;
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = i < 9 ? `⌘${i + 1}` : '';
      li.append(name, key);
      li.addEventListener('mousemove', () => {
        if (selected === i) return;
        selected = i;
        for (const [n, row] of [...el.list.children].entries()) row.classList.toggle('selected', n === i);
      });
      li.addEventListener('click', () => apply(choice));
      return li;
    }),
  );
};

el.ask.addEventListener('input', () => {
  selected = 0;
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  const items = choices();
  if (e.key === 'Escape') window.rewrite.send({ _tag: 'Close' });
  else if (e.key === 'Enter' && document.activeElement !== ghostButton) apply(items[selected]);
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    selected += e.key === 'ArrowDown' ? 1 : -1;
    render();
  } else if (e.metaKey && /^[1-9]$/.test(e.key)) apply(items[Number(e.key) - 1]);
  else return;
  e.preventDefault();
});

const onState = (state: RewriteState) =>
  Effect.sync(() => {
    if (state.opened === opened) return;
    opened = state.opened;
    el.ask.value = '';
    selected = 0;
    el.text.textContent = state.text;
    render();
    el.ask.focus();
  });

runMain(fromBridge(window.rewrite.onState).pipe(Stream.runForEach(onState)));
