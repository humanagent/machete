// The dictation pill: the app the words will go to, and dots that follow your voice. Click for Finish / Cancel.
import { Effect, Stream } from 'effect';
import type { DictationBridge, DictationEvent } from '../../shared/ipc';
import { byId, fromBridgeAll, runMain } from '../common/runtime';

declare global {
  interface Window {
    readonly dictation: DictationBridge;
  }
}

const DOTS = 26;
const el = {
  pill: byId('pill'),
  icon: byId<HTMLImageElement>('icon'),
  app: byId('app'),
  wave: byId('wave'),
  status: byId('status'),
};
const dots = Array.from({ length: DOTS }, () => el.wave.appendChild(document.createElement('span')));
const levels: Array<number> = new Array(DOTS).fill(0);

const draw = () =>
  dots.forEach((dot, i) => {
    dot.style.height = `${4 + Math.round((levels[i] ?? 0) * 14)}px`;
  });

const showStatus = (text: string, error: boolean) => {
  el.wave.hidden = true;
  el.status.hidden = false;
  el.status.className = error ? 'status err' : 'status';
  el.status.textContent = text;
};

const onEvent = (event: DictationEvent) =>
  Effect.sync(() => {
    switch (event._tag) {
      case 'Show':
        el.app.textContent = event.app || 'Dictation';
        el.icon.hidden = event.icon === '';
        if (event.icon) el.icon.src = event.icon;
        el.wave.hidden = false;
        el.status.hidden = true;
        levels.fill(0);
        draw();
        return;
      case 'Level':
        levels.shift();
        levels.push(Math.min(1, event.level));
        draw();
        return;
      case 'Finishing':
        return showStatus('Transcribing…', false);
      case 'Failed':
        return showStatus(event.message, true);
    }
  });

runMain(
  Effect.gen(function* () {
    el.pill.addEventListener('mousedown', () => window.dictation.send({ _tag: 'OpenMenu' }));
    yield* fromBridgeAll(window.dictation.onEvent).pipe(Stream.runForEach(onEvent));
  }),
);
