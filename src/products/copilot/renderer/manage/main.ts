// The Bots window: pick a bot, edit its name, prompt and context, and add files to the context.
// Edits are saved as you type (debounced per field) and flushed before switching bots or closing.
import { Effect, Stream } from 'effect';
import type { BotsState, Profile } from '../../domain';
import type { BotsBridge } from '../../ipc';
import { byId, fromBridge, runMain } from '../../../../core/renderer/runtime';

declare global {
  interface Window {
    readonly bots: BotsBridge;
  }
}

const bots = window.bots;
type Field = 'name' | 'instructions' | 'context';
const FIELDS: ReadonlyArray<Field> = ['name', 'instructions', 'context'];
const SAVE_DELAY_MS = 250;

const el = {
  list: byId<HTMLUListElement>('list'),
  add: byId<HTMLButtonElement>('add'),
  remove: byId<HTMLButtonElement>('remove'),
  empty: byId('empty'),
  editor: byId('editor'),
  use: byId<HTMLButtonElement>('use'),
  note: byId('note'),
  drop: byId('drop'),
  choose: byId<HTMLButtonElement>('choose'),
  fields: {
    name: byId<HTMLInputElement>('name'),
    instructions: byId<HTMLTextAreaElement>('instructions'),
    context: byId<HTMLTextAreaElement>('context'),
  },
};

const view = {
  profiles: [] as ReadonlyArray<Profile>,
  selectedProfileID: '',
  /** The bot being edited (not necessarily the one in use). */
  editing: null as string | null,
  saves: new Map<string, { readonly timer: ReturnType<typeof setTimeout>; readonly run: () => void }>(),
};

const flushSaves = () => {
  for (const { timer, run } of view.saves.values()) {
    clearTimeout(timer);
    run();
  }
  view.saves.clear();
};

const render = () => {
  el.list.replaceChildren(
    ...view.profiles.map((p) => {
      // A real button per row: rows can be picked with the keyboard and accessibility tools.
      const li = document.createElement('li');
      li.className = p.id === view.editing ? 'sel' : '';
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';
      row.setAttribute('aria-pressed', String(p.id === view.editing));
      const name = document.createElement('span');
      name.className = 'n';
      name.textContent = p.name === '' ? 'Untitled' : p.name;
      row.append(name);
      if (p.id === view.selectedProfileID) {
        const check = document.createElement('span');
        check.className = 'check';
        check.textContent = '✓';
        row.append(check);
      }
      row.addEventListener('click', () => {
        flushSaves();
        view.editing = p.id;
        render();
      });
      li.append(row);
      return li;
    }),
  );
  el.remove.disabled = view.editing == null || view.profiles.length <= 1;
  const p = view.profiles.find((x) => x.id === view.editing);
  el.empty.hidden = p !== undefined;
  el.editor.hidden = p === undefined;
  if (!p) return;
  for (const field of FIELDS) {
    const input = el.fields[field];
    if (document.activeElement !== input && input.value !== p[field]) input.value = p[field];
  }
  const inUse = p.id === view.selectedProfileID;
  el.use.textContent = inUse ? 'In use' : 'Use this bot';
  el.use.disabled = inUse;
};

const apply = (s: BotsState) =>
  Effect.sync(() => {
    view.profiles = s.profiles;
    view.selectedProfileID = s.selectedProfileID;
    if (!s.profiles.some((p) => p.id === view.editing)) {
      view.editing = s.profiles.some((p) => p.id === s.selectedProfileID)
        ? s.selectedProfileID
        : (s.profiles[0]?.id ?? null);
    }
    render();
  });

const refresh = Effect.promise(() => bots.request({ _tag: 'Get' })).pipe(Effect.flatMap(apply));

const addFiles = (files: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const id = view.editing;
    if (!id || files.length === 0) return;
    const note = yield* Effect.promise(() => bots.request({ _tag: 'AddFiles', id, files }));
    if (note) el.note.textContent = note;
    yield* refresh;
  });

const bind = Effect.gen(function* () {
  const run = (effect: Effect.Effect<void>) => Effect.runFork(effect);
  for (const field of FIELDS) {
    const input = el.fields[field];
    input.addEventListener('input', () => {
      const id = view.editing;
      if (!id) return;
      const value = input.value;
      view.profiles = view.profiles.map((p) => (p.id === id ? { ...p, [field]: value } : p));
      if (field === 'name') render();
      const key = `${id}:${field}`;
      const previous = view.saves.get(key);
      if (previous) clearTimeout(previous.timer);
      const save = () => void bots.request({ _tag: 'Update', id, fields: { [field]: value } });
      view.saves.set(key, {
        run: save,
        timer: setTimeout(() => {
          view.saves.delete(key);
          save();
        }, SAVE_DELAY_MS),
      });
    });
  }
  window.addEventListener('beforeunload', flushSaves);
  el.add.addEventListener('click', () =>
    run(
      Effect.gen(function* () {
        flushSaves();
        view.editing = yield* Effect.promise(() => bots.request({ _tag: 'Add' }));
        yield* refresh;
      }),
    ),
  );
  el.remove.addEventListener('click', () =>
    run(
      Effect.gen(function* () {
        const id = view.editing;
        if (!id) return;
        yield* Effect.promise(() => bots.request({ _tag: 'Remove', id }));
        view.editing = null;
        yield* refresh;
      }),
    ),
  );
  el.use.addEventListener('click', () => {
    if (view.editing) void bots.request({ _tag: 'Select', id: view.editing });
  });
  el.choose.addEventListener('click', () =>
    run(Effect.promise(() => bots.request({ _tag: 'Choose' })).pipe(Effect.flatMap(addFiles))),
  );
  el.drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    el.drop.classList.add('over');
  });
  el.drop.addEventListener('dragleave', () => el.drop.classList.remove('over'));
  el.drop.addEventListener('drop', (event) => {
    event.preventDefault();
    el.drop.classList.remove('over');
    const files = [...(event.dataTransfer?.files ?? [])].map((f) => bots.pathForFile(f)).filter(Boolean);
    run(addFiles(files));
  });
  // Files dropped elsewhere must not navigate the window.
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());
});

runMain(
  Effect.gen(function* () {
    yield* bind;
    yield* refresh;
    yield* fromBridge(bots.onState).pipe(Stream.runForEach(apply));
  }),
);
