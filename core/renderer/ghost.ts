// The ghost: the same button in every panel that has it, for whether screen sharing sees that panel.
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
/** A see-through ghost: the others don't see this panel. Struck out: they do. */
const INVISIBLE = svg(
  `<path fill="currentColor" fill-opacity="0.1" d="${BODY}"/><path fill="currentColor" stroke="none" d="${EYES}"/>`,
);
/** The bar has some air around it. */
const VISIBLE = svg(
  `<defs><mask id="struck" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><path fill="white" stroke="none" d="M0 0h24v24H0z"/><path stroke="black" stroke-width="5" d="M3 3l18 18"/></mask></defs><g mask="url(#struck)"><path fill="none" d="${BODY}"/><path fill="currentColor" stroke="none" d="${EYES}"/></g><path fill="none" stroke-linecap="round" d="M3 3l18 18"/>`,
);

/** Brings #ghost to life: it draws what its panel is, and a click changes it, only there. */
export const ghost = () => {
  const button = byId<HTMLButtonElement>('ghost');
  const show = (invisible: boolean) => {
    button.innerHTML = invisible ? INVISIBLE : VISIBLE;
    button.setAttribute('aria-pressed', String(!invisible));
    button.setAttribute('aria-label', 'Show in screen sharing');
    button.title = invisible
      ? 'Hidden in screen sharing. Click to show this panel.'
      : 'Shown in screen sharing. Click to hide this panel.';
  };
  button.addEventListener('mousedown', (e) => e.preventDefault()); // the caret stays where it was
  button.addEventListener('click', () => window.ghost.toggle());
  show(true);
  window.ghost.onState(show);
  return button;
};
