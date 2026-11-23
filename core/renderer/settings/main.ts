// The Settings window, drawn from the apps' manifests: General, and a tab per app with its settings and shortcuts.
// Click a shortcut to record another.
import { Effect, Stream } from 'effect';
import { APPS } from '../../../apps';
import type { Setting } from '../../app';
import type { HotkeyInfo } from '../../hotkeys';
import { IDLE, press, type Recorder, release, startRecording, type Step } from '../../recorder';
import type { SettingsBridge, SettingsCommand, SettingsState } from '../../settings';
import { pageOf, type Row } from '../../settingsPage';
import { byId, fromBridge, runMain } from '../runtime';

declare global {
  interface Window {
    readonly settings: SettingsBridge;
  }
}

const send = (command: SettingsCommand) => window.settings.send(command);
const page = byId('page');
const tabs = byId('tabs');
const mac = navigator.platform.startsWith('Mac');
/** Each control redraws itself from the state. */
const draws: Array<(s: SettingsState) => void> = [];
let state: SettingsState | undefined;
let recorder: Recorder = IDLE;

const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  ...children: ReadonlyArray<Node | string>
) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.append(...children);
  return el;
};
const button = (text: string, click: () => void, cls = '') => {
  const b = h('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', click);
  return b;
};
const svg = (paths: string) => {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  return t.content.firstElementChild!;
};
const BACK = '<path d="M5 12a7 7 0 1 0 2.2-5.1L5 9M5 4.5V9h4.5"/>';

const row = (title: string, hint: string, ...controls: ReadonlyArray<Node>) => {
  const small = h('small', '', hint);
  const head = h('div', 'title', title);
  const say = (text: string) => {
    small.textContent = text;
    small.hidden = text === '';
  };
  say(hint);
  return { el: h('div', 'row', h('div', 'what', head, small), ...controls), head, small, say };
};

// MARK: Settings

const toggle = (
  title: string,
  hint: string,
  get: (s: SettingsState) => boolean,
  set: (on: boolean) => void,
) => {
  const box = h('input');
  box.type = 'checkbox';
  box.setAttribute('aria-label', title);
  box.addEventListener('change', () => set(box.checked));
  draws.push((s) => (box.checked = get(s)));
  return row(title, hint, box).el;
};
const setting = (field: string, it: Setting): Node => {
  const now = (s: SettingsState) => s.fields[field] ?? {};
  switch (it.kind) {
    case 'toggle':
      return toggle(
        it.title,
        it.hint ?? '',
        (s) => now(s).value === true,
        (value) => send({ _tag: 'Set', field, value }),
      );
    case 'choice': {
      const select = h('select');
      select.setAttribute('aria-label', it.title);
      select.addEventListener('change', () => send({ _tag: 'Set', field, value: select.value }));
      let drawn = '';
      draws.push((s) => {
        const options = now(s).options ?? it.options ?? [];
        const key = JSON.stringify(options);
        if (key !== drawn)
          select.replaceChildren(
            ...options.map(([value, name]) => {
              const o = h('option', '', name);
              o.value = value;
              return o;
            }),
          );
        drawn = key;
        select.value = String(now(s).value ?? '');
      });
      return row(it.title, it.hint ?? '', select).el;
    }
    case 'action': {
      let asking = false;
      const b = button(
        it.button,
        () => {
          // What can't be undone asks first.
          if (it.confirm !== undefined && !asking) asking = true;
          else {
            asking = false;
            send({ _tag: 'Run', field });
          }
          draw();
        },
        'box',
      );
      const r = row(it.title, it.hint ?? '', b);
      draws.push((s) => {
        b.textContent = asking && it.confirm !== undefined ? it.confirm : (now(s).button ?? it.button);
        r.say(now(s).hint ?? it.hint ?? '');
      });
      return r.el;
    }
  }
};

// MARK: Shortcuts

/** Where recording is now; the shortcuts rest meanwhile. */
const step = ({ next, keys }: Step) => {
  const was = recorder.id;
  recorder = next;
  if (was !== next.id && (was === undefined || next.id === undefined))
    send({ _tag: 'Recording', on: next.id !== undefined });
  if (keys !== undefined && was !== undefined) send({ _tag: 'SetHotkey', id: was, keys });
  draw();
};
const stopRecording = () => recorder.id !== undefined && step({ next: IDLE });
window.addEventListener(
  'keydown',
  (e) => {
    if (recorder.id === undefined) {
      if (e.key === 'Escape' || (e.metaKey && e.key === 'w')) send({ _tag: 'Close' });
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) step(press(recorder, e, mac));
  },
  true,
);
window.addEventListener('keyup', (e) => recorder.id !== undefined && step(release(recorder, e.code)), true);
window.addEventListener('blur', stopRecording);

const shortcut = ({ id, title }: HotkeyInfo, icon: string) => {
  const keys = button('', () => step({ next: recorder.id === id ? IDLE : startRecording(id) }), 'box keys');
  const reset = button('', () => send({ _tag: 'ResetHotkey', id }), 'mini');
  reset.append(svg(BACK));
  reset.title = 'Back to the default';
  reset.setAttribute('aria-label', `Reset ${title}`);
  const r = row(title, '', reset, keys);
  r.head.prepend(svg(icon));
  draws.push((s) => {
    const k = s.hotkeys.find((x) => x.id === id);
    if (!k) return;
    const on = recorder.id === id;
    const none = k.labels.length === 0;
    keys.textContent = on ? 'Press the keys' : none ? 'Record' : k.labels.join('  or  ');
    keys.className = `box keys${on ? ' recording' : none ? ' off' : ''}`;
    keys.setAttribute('aria-label', `${title}: ${keys.textContent}`);
    reset.classList.toggle('gone', !k.changed);
    const bad =
      s.problem?.id === id ? s.problem.text : k.failed ? 'Another app, or macOS, has these keys' : '';
    r.say(on ? recorder.problem || 'A combination, or right ⌥ ⌘ ⌃ ⇧ on its own. Esc cancels' : bad);
    r.small.classList.toggle('bad', !on && bad !== '');
  });
  return r.el;
};

// MARK: Tabs

const rowOf = (it: Row): Node => {
  switch (it.row) {
    case 'setting':
      return setting(it.field, it.setting);
    case 'switch':
      return toggle(
        'Use its shortcuts',
        'Off gives their keys back to the other apps.',
        (s) => !s.off.includes(it.app),
        (on) => send({ _tag: 'Shortcuts', app: it.app, on }),
      );
    case 'heading':
      return h('h2', '', it.text);
    case 'shortcut':
      return shortcut(it.info, it.icon);
    case 'dock':
      return toggle(
        'Hide the Dock icon',
        'macOS can still list Machete among recent apps: System Settings, Desktop & Dock.',
        (s) => s.hideDock,
        (on) => send({ _tag: 'HideDock', on }),
      );
    case 'permissions': {
      const r = row(
        'Permissions',
        '',
        button('Open', () => send({ _tag: 'Permissions' }), 'box'),
      );
      draws.push((s) =>
        r.say(s.missing === 0 ? 'macOS allows everything Machete needs.' : `${s.missing} still missing.`),
      );
      return r.el;
    }
    case 'resetShortcuts': {
      const b = button('Reset all', () => send({ _tag: 'ResetHotkeys' }), 'box');
      const r = row('Shortcuts', '', b);
      draws.push((s) => {
        b.disabled = !s.hotkeys.some((k) => k.changed);
        r.say(
          b.disabled
            ? 'All as Machete came with. Each program has its own in its tab.'
            : 'Every one back to what Machete came with.',
        );
      });
      return r.el;
    }
  }
};
const PAGE = pageOf(APPS);
const show = (at: number) => {
  stopRecording();
  for (const [i, t] of [...tabs.children].entries()) {
    t.setAttribute('aria-selected', String(i === at));
    (page.children[i] as HTMLElement).hidden = i !== at;
  }
  page.scrollTop = 0;
};
for (const [at, tab] of PAGE.entries()) {
  const t = button('', () => show(at));
  t.append(svg(tab.icon), tab.name);
  t.setAttribute('role', 'tab');
  tabs.append(t);
  const panel = h('div', '', ...tab.rows.map(rowOf));
  panel.setAttribute('role', 'tabpanel');
  page.append(panel);
}
show(0);

let noted = 0;
function draw() {
  if (!state) return;
  for (const d of draws) d(state);
  const note = byId('note');
  if (state.note !== '' && note.textContent !== state.note) {
    note.hidden = false;
    clearTimeout(noted);
    noted = window.setTimeout(() => (note.hidden = true), 2600);
  }
  note.textContent = state.note;
}
runMain(
  fromBridge(window.settings.onState).pipe(
    Stream.runForEach((s) =>
      Effect.sync(() => {
        state = s;
        draw();
      }),
    ),
  ),
);
