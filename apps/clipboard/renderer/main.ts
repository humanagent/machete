// The clipboard picker: type to filter, ↑↓ or ⌘1–9 to choose, ↩ or double-click to paste, ⌥⌫ to delete, Esc to close.
import { Effect, Stream } from 'effect';
import { byId, fromBridge, runMain } from '../../../core/renderer/runtime';
import { preview, search } from '../history';
import type { ClipboardBridge, ClipboardState } from '../ipc';

declare global {
  interface Window {
    readonly clipboardHistory: ClipboardBridge;
  }
}

const el = {
  search: byId<HTMLInputElement>('search'),
  list: byId('list'),
  empty: byId('empty'),
  full: byId('full'),
  meta: byId('meta'),
};
let items: ReadonlyArray<string> = [];
let shown: ReadonlyArray<string> = [];
let selected = 0;
let opened = -1;

const render = () => {
  shown = search(items, el.search.value);
  selected = Math.min(selected, Math.max(0, shown.length - 1));
  el.empty.hidden = shown.length > 0;
  el.empty.textContent = items.length === 0 ? 'Nothing copied yet' : 'No matches';
  el.list.replaceChildren(
    ...shown.map((text, i) => {
      const li = document.createElement('li');
      li.className = i === selected ? 'selected' : '';
      const t = document.createElement('span');
      t.className = 'text';
      t.textContent = preview(text, 70);
      li.append(t);
      if (i < 9) {
        const k = document.createElement('span');
        k.className = 'key';
        k.textContent = `⌘${i + 1}`;
        li.append(k);
      }
      li.addEventListener('mousemove', () => select(i));
      li.addEventListener('click', () => select(i));
      li.addEventListener('dblclick', () => paste(i));
      return li;
    }),
  );
  showFull();
};

/** The preview pane: the whole entry, with its size. */
const showFull = () => {
  const text = shown[selected] ?? '';
  el.full.textContent = text;
  el.full.scrollTop = 0;
  const lines = text === '' ? 0 : text.split('\n').length;
  el.meta.textContent =
    text === '' ? '' : `${text.length.toLocaleString()} characters · ${lines} line${lines === 1 ? '' : 's'}`;
};

const select = (i: number) => {
  if (i === selected || i < 0 || i >= shown.length) return;
  el.list.children[selected]?.classList.remove('selected');
  selected = i;
  el.list.children[selected]?.classList.add('selected');
  el.list.children[selected]?.scrollIntoView({ block: 'nearest' });
  showFull();
};

const paste = (i: number) => {
  const text = shown[i];
  if (text !== undefined) window.clipboardHistory.send({ _tag: 'Paste', text });
};

const onState = (state: ClipboardState) =>
  Effect.sync(() => {
    items = state.items;
    if (state.opened !== opened) {
      opened = state.opened;
      el.search.value = '';
      selected = 0;
    }
    render();
    el.search.focus();
  });

// Clicking an entry leaves you typing in the search.
el.list.addEventListener('mousedown', (e) => e.preventDefault());

el.search.addEventListener('input', () => {
  selected = 0;
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.clipboardHistory.send({ _tag: 'Close' });
  else if (e.key === 'ArrowDown') select(selected + 1);
  else if (e.key === 'ArrowUp') select(selected - 1);
  else if (e.key === 'Enter') paste(selected);
  else if (e.metaKey && /^[1-9]$/.test(e.key)) paste(Number(e.key) - 1);
  else if (e.altKey && e.key === 'Backspace') {
    const text = shown[selected];
    if (text !== undefined) window.clipboardHistory.send({ _tag: 'Remove', text });
  } else return;
  e.preventDefault();
});

runMain(fromBridge(window.clipboardHistory.onState).pipe(Stream.runForEach(onState)));
