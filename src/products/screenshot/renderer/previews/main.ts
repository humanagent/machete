// The floating previews: click one to edit it, drag it into any app, or use its buttons.
import { Effect, Stream } from 'effect';
import { byId, fromBridge, runMain } from '../../../../core/renderer/runtime';
import type { PreviewsBridge, PreviewsState } from '../../ipc';

declare global {
  interface Window {
    readonly previews: PreviewsBridge;
  }
}

const stack = byId('stack');
const cards = new Map<string, HTMLElement>();

const button = (id: string, kind: 'close' | 'copy' | 'save', text: string, label: string) => {
  const b = document.createElement('button');
  b.className = kind;
  b.textContent = text;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const tag = { close: 'Close', copy: 'Copy', save: 'Save' } as const;
    window.previews.send({ _tag: tag[kind], id });
  });
  return b;
};

const card = (id: string, thumb: string) => {
  const div = document.createElement('div');
  div.className = 'card';
  div.title = 'Click to edit, drag to drop it in an app';
  const img = document.createElement('img');
  img.src = thumb;
  img.alt = 'Screenshot';
  img.draggable = true;
  img.addEventListener('dragstart', (e) => {
    e.preventDefault();
    window.previews.send({ _tag: 'Drag', id });
  });
  div.addEventListener('click', () => window.previews.send({ _tag: 'Edit', id }));
  div.append(
    img,
    button(id, 'close', '✕', 'Close'),
    button(id, 'copy', 'Copy', 'Copy'),
    button(id, 'save', 'Save', 'Save to the Desktop'),
  );
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
