// The screenshot editor: draws the screenshot with its frame at full size; the canvas is what gets copied or saved.
import { Effect, Stream } from 'effect';
import { byId, fromBridge, runMain } from '../../../../core/renderer/runtime';
import { BACKGROUNDS, COLORS, cover, DEFAULT_FRAME, type Frame, layout, SIZES } from '../../frame';
import type { EditorBridge, EditorState } from '../../ipc';

declare global {
  interface Window {
    readonly editor: EditorBridge;
  }
}

const el = {
  canvas: byId<HTMLCanvasElement>('canvas'),
  frame: byId<HTMLButtonElement>('frame'),
  backgrounds: byId('backgrounds'),
  sizes: byId('sizes'),
  close: byId<HTMLButtonElement>('close'),
  save: byId<HTMLButtonElement>('save'),
  copy: byId<HTMLButtonElement>('copy'),
};
let frame: Frame = DEFAULT_FRAME;
let image: HTMLImageElement | undefined;
let wallpaper: HTMLImageElement | undefined;
let opened = -1;

const load = (src: string) =>
  Effect.callback<HTMLImageElement | undefined>((resume) => {
    if (src === '') return resume(Effect.succeed(undefined));
    const img = new Image();
    img.onload = () => resume(Effect.succeed(img));
    img.onerror = () => resume(Effect.succeed(undefined));
    img.src = src;
  });

const draw = () => {
  const ctx = el.canvas.getContext('2d');
  if (!image || !ctx) return;
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const l = layout(w, h, frame);
  el.canvas.width = l.width;
  el.canvas.height = l.height;
  if (!frame.on) return ctx.drawImage(image, 0, 0);

  if (frame.background === 'wallpaper' && wallpaper) {
    const c = cover(wallpaper.naturalWidth, wallpaper.naturalHeight, l.width, l.height);
    ctx.drawImage(wallpaper, c.x, c.y, c.width, c.height);
  } else {
    const [from, to] = COLORS[frame.background];
    const g = ctx.createLinearGradient(0, 0, l.width, l.height);
    g.addColorStop(0, from);
    g.addColorStop(1, to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, l.width, l.height);
  }
  ctx.beginPath();
  ctx.roundRect(l.padding, l.padding, w, h, l.radius);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = l.shadow;
  ctx.shadowOffsetY = l.shadow / 4;
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.clip();
  // A screenshot with see-through parts (a window's corners) must not show the black that cast the shadow.
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.drawImage(image, l.padding, l.padding);
  ctx.restore();
};

const set = (change: Partial<Frame>) => {
  frame = { ...frame, ...change };
  window.editor.send({ _tag: 'SetFrame', frame });
  render();
};

const swatches = BACKGROUNDS.map((background) => {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.setAttribute('aria-label', background);
  b.title = background[0]!.toUpperCase() + background.slice(1);
  b.style.backgroundImage = `linear-gradient(135deg, ${COLORS[background].join(', ')})`;
  b.addEventListener('click', () => set({ background }));
  return { background, b };
});
const sizes = SIZES.map((size) => {
  const b = document.createElement('button');
  b.textContent = size[0]!.toUpperCase();
  b.setAttribute('aria-label', size);
  b.addEventListener('click', () => set({ size }));
  return { size, b };
});
el.backgrounds.append(...swatches.map((s) => s.b));
el.sizes.append(...sizes.map((s) => s.b));

const render = () => {
  el.frame.setAttribute('aria-pressed', String(frame.on));
  for (const group of [el.backgrounds, el.sizes]) group.classList.toggle('off', !frame.on);
  for (const s of swatches) s.b.setAttribute('aria-pressed', String(s.background === frame.background));
  for (const s of sizes) s.b.setAttribute('aria-pressed', String(s.size === frame.size));
  if (wallpaper) swatches[0]!.b.style.backgroundImage = `url(${wallpaper.src})`;
  draw();
};

const png = () => el.canvas.toDataURL('image/png');
const copy = () => image && window.editor.send({ _tag: 'Copy', png: png() });
const save = () => image && window.editor.send({ _tag: 'Save', png: png() });
const close = () => window.editor.send({ _tag: 'Close' });

el.frame.addEventListener('click', () => set({ on: !frame.on }));
el.copy.addEventListener('click', copy);
el.save.addEventListener('click', save);
el.close.addEventListener('click', close);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') close();
  else if (e.metaKey && e.key === 's') save();
  else if (e.metaKey && e.key === 'c') copy();
  // On a button reached with Tab, ↩ presses that button.
  else if (e.key === 'Enter' && !document.activeElement?.matches('button:focus-visible')) copy();
  else if (e.key === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) set({ on: !frame.on });
  else return;
  e.preventDefault();
});

const onState = (state: EditorState) =>
  Effect.gen(function* () {
    if (state.opened === opened) return;
    opened = state.opened;
    frame = state.frame;
    image = undefined;
    [image, wallpaper] = yield* Effect.all([load(state.image), load(state.wallpaper)]);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    render();
  });

runMain(fromBridge(window.editor.onState).pipe(Stream.runForEach(onState)));
