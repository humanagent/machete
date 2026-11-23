// The bots panel: type to filter, ↑↓ to choose, ↩ to use it, ⌘N to add; the right side edits the open one (saved as
// you type), and files dropped there are added to what it knows.
import { Effect, Stream } from 'effect';
import { byId, fromBridge, runMain } from '../../../../core/renderer/runtime';
import { type BotField, BotsEditor, searchBots } from '../../botsEditor';
import type { BotsBridge } from '../../ipc';

declare global {
  interface Window {
    readonly bots: BotsBridge;
  }
}

const el = {
  search: byId<HTMLInputElement>('search'),
  add: byId('add'),
  list: byId('list'),
  empty: byId('empty'),
  count: byId('count'),
  edit: byId('edit'),
  use: byId<HTMLButtonElement>('use'),
  close: byId('close'),
  choose: byId('choose'),
  remove: byId<HTMLButtonElement>('remove'),
  note: byId('note'),
};
const fields: Readonly<Record<BotField, HTMLInputElement | HTMLTextAreaElement>> = {
  name: byId<HTMLInputElement>('name'),
  instructions: byId<HTMLTextAreaElement>('instructions'),
  context: byId<HTMLTextAreaElement>('context'),
};
const FIELDS = Object.keys(fields) as ReadonlyArray<BotField>;
const NOTE = 'Drop PDF, Word, text or Markdown files here.';

const bots = new BotsEditor(
  (request) => window.bots.request(request),
  () => render(),
);
const shown = () => searchBots(bots.view.profiles, el.search.value);

const render = () => {
  const { profiles, inUse, editing, removing, note } = bots.view;
  const list = shown();
  el.empty.hidden = list.length > 0;
  el.count.textContent = `${profiles.length} bot${profiles.length === 1 ? '' : 's'}`;
  el.list.replaceChildren(
    ...list.map((p) => {
      const li = document.createElement('li');
      li.className = p.id === editing?.id ? 'selected' : '';
      const name = document.createElement('span');
      name.className = p.name === '' ? 'text blank' : 'text';
      name.textContent = p.name || 'Untitled';
      li.append(name);
      if (p.id === inUse) {
        const key = document.createElement('span');
        key.className = 'key';
        key.textContent = 'In use';
        li.append(key);
      }
      li.addEventListener('click', () => bots.open(p.id));
      return li;
    }),
  );
  el.list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  for (const field of FIELDS) {
    const input = fields[field];
    input.disabled = editing === undefined;
    // What's typed is already there: it only differs when it changed somewhere else.
    const value = editing?.[field] ?? '';
    if (input.value !== value) input.value = value;
  }
  el.use.hidden = editing === undefined || editing.id === inUse;
  el.remove.textContent = removing ? 'Delete it?' : 'Delete';
  el.remove.disabled = profiles.length <= 1;
  el.note.textContent = note === '' ? NOTE : note;
};

const close = () => void bots.flush().then(() => window.bots.request({ _tag: 'Close' }));
const step = (by: number) => {
  const list = shown();
  const at = list.findIndex((p) => p.id === bots.view.editing?.id);
  const next = list[at === -1 ? 0 : at + by];
  if (next) bots.open(next.id);
};
const add = () => {
  el.search.value = '';
  void bots.add().then(() => {
    fields.name.focus();
    (fields.name as HTMLInputElement).select();
  });
};

el.search.addEventListener('input', () => {
  const list = shown();
  const first = list[0];
  if (first && !list.some((p) => p.id === bots.view.editing?.id)) bots.open(first.id);
  else render();
});
for (const field of FIELDS)
  fields[field].addEventListener('input', () => bots.edit(field, fields[field].value));
el.add.addEventListener('click', add);
el.use.addEventListener('click', () => void bots.use());
el.remove.addEventListener('click', () => void bots.remove());
el.choose.addEventListener('click', () => void bots.choose());
el.close.addEventListener('click', close);
window.addEventListener('beforeunload', () => void bots.flush());

// Files dropped elsewhere must not navigate the window.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
el.edit.addEventListener('dragover', () => el.edit.classList.add('over'));
el.edit.addEventListener('dragleave', () => el.edit.classList.remove('over'));
el.edit.addEventListener('drop', (e) => {
  el.edit.classList.remove('over');
  void bots.addFiles([...(e.dataTransfer?.files ?? [])].map(window.bots.pathForFile).filter(Boolean));
});

document.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  const inList = document.activeElement === el.search;
  if (e.key === 'Escape' || (e.metaKey && e.key === 'w')) close();
  else if (e.metaKey && e.key === 'n') add();
  else if (inList && e.key === 'ArrowDown') step(1);
  else if (inList && e.key === 'ArrowUp') step(-1);
  else if (inList && e.key === 'Enter' && shown().length > 0) void bots.use();
  else return;
  e.preventDefault();
});

let opened = -1;
runMain(
  fromBridge(window.bots.onState).pipe(
    Stream.runForEach((state) =>
      Effect.sync(() => {
        if (state.opened !== opened) {
          opened = state.opened;
          el.search.value = '';
          bots.showInUse();
          el.search.focus();
        }
        void bots.refresh();
      }),
    ),
  ),
);
