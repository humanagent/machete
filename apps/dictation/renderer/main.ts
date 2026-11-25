// The dictation pill: the app the words will go to, and thin bars that follow your voice. Click for Finish / Cancel.
import { Effect, Stream } from 'effect';
import type { DictationBridge, DictationEvent } from '../ipc';
import { ghost } from '../../../core/renderer/ghost';
import { byId, fromBridgeAll, runMain } from '../../../core/renderer/runtime';

declare global {
  interface Window {
    readonly dictation: DictationBridge;
  }
}

const BARS = 44;
/** Bars at rest are a short line; the voice level stretches them up to the full height. */
const REST = 0.2;
/** How much of the remaining distance a bar covers each frame: lower is smoother. */
const EASE = 0.22;

const el = {
  pill: byId('pill'),
  icon: byId<HTMLImageElement>('icon'),
  app: byId('app'),
  wave: byId('wave'),
  status: byId('status'),
};
const bars = Array.from({ length: BARS }, () => el.wave.appendChild(document.createElement('span')));
/** Newest level on the right; each level is shown slightly softened by its neighbours. */
const target: Array<number> = new Array(BARS).fill(0);
const shown: Array<number> = new Array(BARS).fill(0);
let frame = 0;
// A press on it is for it: the pill's menu stays closed.
ghost().addEventListener('mousedown', (e) => e.stopPropagation());

const tick = () => {
  let moving = false;
  for (let i = 0; i < BARS; i++) {
    const soft = ((target[i - 1] ?? target[i]!) + 2 * target[i]! + (target[i + 1] ?? target[i]!)) / 4;
    const next = shown[i]! + (soft - shown[i]!) * EASE;
    if (Math.abs(next - shown[i]!) > 0.002) moving = true;
    shown[i] = next;
    bars[i]!.style.transform = `scaleY(${REST + (1 - REST) * next})`;
  }
  frame = moving ? requestAnimationFrame(tick) : 0;
};
const animate = () => {
  if (frame === 0) frame = requestAnimationFrame(tick);
};

const setMode = (mode: 'listening' | 'finishing' | 'failed', text = '') => {
  el.pill.classList.toggle('finishing', mode !== 'listening');
  el.status.hidden = mode === 'listening';
  el.status.className = mode === 'failed' ? 'status err' : 'status shimmer';
  el.status.textContent = text;
};

const onEvent = (event: DictationEvent) =>
  Effect.sync(() => {
    switch (event._tag) {
      case 'Show':
        el.app.textContent = event.app || 'Dictation';
        el.icon.hidden = event.icon === '';
        if (event.icon) el.icon.src = event.icon;
        target.fill(0);
        shown.fill(0);
        setMode('listening');
        animate();
        return;
      case 'Level':
        target.shift();
        target.push(Math.min(1, Math.sqrt(Math.max(0, event.level))));
        animate();
        return;
      case 'Finishing':
        return setMode('finishing', 'Transcribing');
      case 'Working':
        return setMode('finishing', event.text);
      case 'Failed':
        return setMode('failed', event.message);
    }
  });

runMain(
  Effect.gen(function* () {
    el.pill.addEventListener('mousedown', () => window.dictation.send({ _tag: 'OpenMenu' }));
    yield* fromBridgeAll(window.dictation.onEvent).pipe(Stream.runForEach(onEvent));
  }),
);
