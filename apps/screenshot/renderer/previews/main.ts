// The floating previews: drag one into any app, or use its buttons.
import { Effect, Stream } from 'effect';
import { byId, fromBridge, runMain } from '../../../../core/renderer/runtime';
import { CARD_BUTTONS, type CardButton } from '../../card';
import type { PreviewsBridge, PreviewsState } from '../../ipc';

declare global {
  interface Window {
    readonly previews: PreviewsBridge;
  }
}

const stack = byId('stack');
const cards = new Map<string, HTMLElement>();

const button = (id: string, { kind, command, label, text, icon }: CardButton) => {
  const b = document.createElement('button');
  b.className = kind;
  b.title = label;
  b.setAttribute('aria-label', label);
  if (icon !== undefined) b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
  else b.textContent = text ?? label;
  b.addEventListener('click', () => window.previews.send({ _tag: command, id }));
  return b;
};

const card = (id: string, thumb: string) => {
  const div = document.createElement('div');
  div.className = 'card';
  const img = document.createElement('img');
  img.src = thumb;
  img.alt = 'Screenshot';
  img.title = 'Drag it into an app';
  img.draggable = true;
  img.addEventListener('dragstart', (e) => {
    e.preventDefault();
    window.previews.send({ _tag: 'Drag', id });
  });
  div.append(img, ...CARD_BUTTONS.map((b) => button(id, b)));
  return div;
};

const onState = (state: PreviewsState) =>
  Effect.sync(() => {
    const ids = new Set(state.shots.map((s) => s.id));
    for (const id of cards.keys()) if (!ids.has(id)) cards.delete(id);
    stack.replaceChildren(
      ...state.shots.map((s) => {
        const el = cards.get(s.id) ?? card(s.id, s.thumb);
        cards.set(s.id, el);
        return el;
      }),
    );
  });

runMain(fromBridge(window.previews.onState).pipe(Stream.runForEach(onState)));
