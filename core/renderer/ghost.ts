// The ghost: the same button in every panel that has it. Lit, Machete is invisible to screen sharing.
import { byId } from './runtime';
import type { GhostBridge } from '../invisibility';

declare global {
  interface Window {
    readonly ghost: GhostBridge;
  }
}

const BODY = 'M4.5 20.5V10.5a7.5 7.5 0 0 1 15 0v10l-2.5-2.2-2.5 2.2-2.5-2.2-2.5 2.2-2.5-2.2z';
const EYES =
  'M9.3 9a1.4 1.7 0 1 0 0 3.4 1.4 1.7 0 0 0 0-3.4zM14.7 9a1.4 1.7 0 1 0 0 3.4 1.4 1.7 0 0 0 0-3.4z';
const svg = (inside: string) =>
  `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">${inside}</svg>`;
/** Lit: a whole ghost. Not: its outline. */
const INVISIBLE = svg(`<path fill="currentColor" fill-rule="evenodd" stroke="none" d="${BODY}${EYES}"/>`);
const VISIBLE = svg(`<path fill="none" d="${BODY}"/><path fill="currentColor" stroke="none" d="${EYES}"/>`);

/** Brings #ghost to life: it draws what Machete is, and a click changes it everywhere. */
export const ghost = () => {
  const button = byId<HTMLButtonElement>('ghost');
  const show = (invisible: boolean) => {
    button.innerHTML = invisible ? INVISIBLE : VISIBLE;
    button.classList.toggle('on', invisible);
    button.setAttribute('aria-pressed', String(invisible));
    button.setAttribute('aria-label', 'Invisible');
    button.title = invisible
      ? 'Invisible in screen sharing. Click to show Machete.'
      : 'Visible in screen sharing. Click to make Machete invisible.';
  };
  button.addEventListener('mousedown', (e) => e.preventDefault()); // the caret stays where it was
  button.addEventListener('click', () => window.ghost.toggle());
  show(true);
  window.ghost.onState(show);
  return button;
};
