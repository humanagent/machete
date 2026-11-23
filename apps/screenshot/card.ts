// The buttons of a floating preview, one per corner. The picture itself only drags.
import type { PreviewsCommand } from './ipc';

export interface CardButton {
  /** Its class: where it goes. */
  readonly kind: 'close' | 'edit' | 'copy' | 'save';
  readonly command: Exclude<PreviewsCommand['_tag'], 'Drag'>;
  readonly label: string;
  readonly text?: string;
  /** What's inside a 24×24 stroked <svg>, instead of text. */
  readonly icon?: string;
}

export const CARD_BUTTONS: ReadonlyArray<CardButton> = [
  { kind: 'close', command: 'Close', label: 'Close', text: '✕' },
  {
    kind: 'edit',
    command: 'Edit',
    label: 'Edit',
    icon: '<path d="M4 20l4.5-1L19 8.5a2.1 2.1 0 0 0-3-3L5 16z"/><path d="M13.5 8l3 3"/>',
  },
  { kind: 'copy', command: 'Copy', label: 'Copy', text: 'Copy' },
  { kind: 'save', command: 'Save', label: 'Save to the Desktop', text: 'Save' },
];
