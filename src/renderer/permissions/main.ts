// "Set up Machete": a pure view of PermissionsState. Allow sends the request; the icon tile starts a native drag.
import { Effect, Stream } from 'effect';
import type { PermissionsBridge, PermissionsCommand, PermissionsState } from '../../shared/ipc';
import { missing, PERMISSIONS, permission } from '../../shared/permissions';
import { byId, fromBridge, runMain } from '../common/runtime';

declare global {
  interface Window {
    readonly permissions: PermissionsBridge;
  }
}

const el = {
  appIcon: byId<HTMLImageElement>('app-icon'),
  rows: byId('rows'),
  guide: byId('guide'),
  guideTitle: byId('guide-title'),
  tile: byId('tile'),
  tileIcon: byId<HTMLImageElement>('tile-icon'),
  restart: byId('restart'),
  restartBtn: byId('restart-btn'),
  progress: byId('progress'),
  close: byId<HTMLButtonElement>('close'),
};

const send = (command: PermissionsCommand) => window.permissions.send(command);

const rows = new Map(
  PERMISSIONS.map((p) => {
    const li = document.createElement('li');
    li.className = 'row';
    const text = document.createElement('div');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = p.title;
    const why = document.createElement('span');
    why.className = 'why';
    why.textContent = p.why;
    text.append(title, why);
    const action = document.createElement('div');
    li.append(text, action);
    el.rows.append(li);
    return [p.key, { li, action }] as const;
  }),
);

const render = (s: PermissionsState) =>
  Effect.sync(() => {
    if (s.icon !== '') {
      el.appIcon.src = s.icon;
      el.tileIcon.src = s.icon;
      el.appIcon.hidden = false;
    }
    for (const p of PERMISSIONS) {
      const row = rows.get(p.key);
      if (!row) continue;
      const granted = s.status[p.key] === 'granted';
      row.li.classList.toggle('active', s.guiding === p.key);
      row.li.classList.toggle('done', granted);
      row.action.replaceChildren();
      if (granted) {
        const ok = document.createElement('span');
        ok.className = 'allowed';
        ok.textContent = 'Allowed';
        row.action.append(ok);
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = s.guiding === p.key ? '' : 'primary';
        button.textContent = s.guiding === p.key ? 'Open again' : 'Allow';
        button.addEventListener('click', () => send({ _tag: 'Allow', key: p.key }));
        row.action.append(button);
      }
    }
    el.guide.hidden = s.guiding === null;
    if (s.guiding !== null) el.guideTitle.textContent = `Drag Machete into ${permission(s.guiding).title}`;
    // One thing at a time: the restart waits until no drag is in progress.
    el.restart.hidden = !s.needsRestart || s.guiding !== null;
    const left = missing(s.status).length;
    el.progress.textContent =
      left === 0 ? 'All set.' : `${PERMISSIONS.length - left} of ${PERMISSIONS.length} allowed`;
    el.close.textContent = left === 0 ? 'Done' : 'Later';
    el.close.className = left === 0 && !s.needsRestart ? 'primary' : '';
  });

el.tile.addEventListener('dragstart', (event) => {
  // The main process starts the real file drag (Machete.app) from here.
  event.preventDefault();
  send({ _tag: 'Drag' });
});
el.restartBtn.addEventListener('click', () => send({ _tag: 'Restart' }));
el.close.addEventListener('click', () => send({ _tag: 'Close' }));

runMain(fromBridge(window.permissions.onState).pipe(Stream.runForEach(render)));
