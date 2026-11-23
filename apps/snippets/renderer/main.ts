// The snippets panel: type to filter, ↑↓ to choose, ↩ or click to paste, ⌘N to add; the right side edits the
// selected snippet (saved as you type).
import { Effect, Stream } from 'effect';
import { byId, fromBridge, runMain } from '../../../core/renderer/runtime';
import type { SnippetsBridge, SnippetsState } from '../ipc';
import { type Snippet, search } from '../snippets';

declare global {
  interface Window {
    readonly snippets: SnippetsBridge;
  }
}

const el = {
  search: byId<HTMLInputElement>('search'),
  add: byId('add'),
  list: byId('list'),
  empty: byId('empty'),
  count: byId('count'),
  warn: byId('warn'),
  allow: byId('allow'),
  abbr: byId<HTMLInputElement>('abbr'),
  content: byId<HTMLTextAreaElement>('content'),
  importMac: byId('importMac'),
  remove: byId('remove'),
};
const send = (command: Parameters<SnippetsBridge['send']>[0]) => window.snippets.send(command);

let items: ReadonlyArray<Snippet> = [];
let shown: ReadonlyArray<Snippet> = [];
let selected = 0;
let editing: string | null = null;
let opened = -1;

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

const render = () => {
  shown = search(items, el.search.value);
  selected = Math.min(selected, Math.max(0, shown.length - 1));
  el.empty.hidden = shown.length > 0;
  el.empty.textContent = items.length === 0 ? 'No snippets yet' : 'No matches';
  el.count.textContent = `${items.length} snippet${items.length === 1 ? '' : 's'}`;
  el.list.replaceChildren(
    ...shown.map((s, i) => {
      const li = document.createElement('li');
      li.className = i === selected ? 'selected' : '';
      const t = document.createElement('span');
      t.className = s.content.trim() === '' ? 'text blank' : 'text';
      t.textContent = oneLine(s.content) || 'Empty snippet';
      li.append(t);
      if (s.abbreviation !== '') {
        const a = document.createElement('span');
        a.className = 'abbr';
        a.textContent = s.abbreviation;
        li.append(a);
      }
      li.addEventListener('click', () => select(i));
      li.addEventListener('dblclick', () => paste(i));
      return li;
    }),
  );
  showEditor();
};

/** The editor shows the selected snippet; fields being typed in are left alone. */
const showEditor = () => {
  const s = shown[selected];
  const changed = (s?.id ?? null) !== editing;
  editing = s?.id ?? null;
  for (const f of [el.abbr, el.content]) f.disabled = s === undefined;
  if (changed || document.activeElement !== el.abbr) el.abbr.value = s?.abbreviation ?? '';
  if (changed || document.activeElement !== el.content) el.content.value = s?.content ?? '';
};

const select = (i: number) => {
  if (i < 0 || i >= shown.length) return;
  el.list.children[selected]?.classList.remove('selected');
  selected = i;
  el.list.children[selected]?.classList.add('selected');
  el.list.children[selected]?.scrollIntoView({ block: 'nearest' });
  showEditor();
};

const paste = (i: number) => {
  const s = shown[i];
  if (s !== undefined) send({ _tag: 'Paste', id: s.id });
};

let saveTimer = 0;
const save = () => {
  clearTimeout(saveTimer);
  const id = editing;
  if (id === null) return;
  saveTimer = window.setTimeout(
    () => send({ _tag: 'Update', id, abbreviation: el.abbr.value.trim(), content: el.content.value }),
    250,
  );
};

const onState = (state: SnippetsState) =>
  Effect.sync(() => {
    items = state.items;
    el.warn.hidden = !state.needsPermission;
    if (state.opened !== opened) {
      opened = state.opened;
      el.search.value = '';
      selected = 0;
      el.search.focus();
    }
    if (state.created !== null) {
      el.search.value = '';
      shown = search(items, '');
      selected = Math.max(
        0,
        shown.findIndex((s) => s.id === state.created),
      );
      render();
      el.abbr.focus();
      return;
    }
    render();
  });

el.search.addEventListener('input', () => {
  selected = 0;
  render();
});
el.abbr.addEventListener('input', save);
el.content.addEventListener('input', save);
el.add.addEventListener('click', () => send({ _tag: 'Add' }));
el.allow.addEventListener('click', () => send({ _tag: 'Permissions' }));
el.importMac.addEventListener('click', () => send({ _tag: 'ImportMac' }));
el.remove.addEventListener('click', () => {
  if (editing !== null) send({ _tag: 'Remove', id: editing });
});

document.addEventListener('keydown', (e) => {
  const inList = document.activeElement === el.search;
  if (e.key === 'Escape') send({ _tag: 'Close' });
  else if (e.metaKey && e.key === 'n') send({ _tag: 'Add' });
  else if (inList && e.key === 'ArrowDown') select(selected + 1);
  else if (inList && e.key === 'ArrowUp') select(selected - 1);
  else if (inList && e.key === 'Enter') paste(selected);
  else return;
  e.preventDefault();
});

runMain(fromBridge(window.snippets.onState).pipe(Stream.runForEach(onState)));
