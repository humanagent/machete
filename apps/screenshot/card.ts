// The buttons of a floating preview: one per corner, and Duplicate beside Edit. The picture itself only drags.
import type { PreviewsCommand } from './ipc';

export interface CardButton {
  /** Its class: where it goes. */
  readonly kind: 'close' | 'duplicate' | 'edit' | 'copy' | 'save';
  readonly command: Exclude<PreviewsCommand['_tag'], 'Drag'>;
  readonly label: string;
  readonly text?: string;
  /** What's inside a 24×24 stroked <svg>, instead of text. */
  readonly icon?: string;
}

export const CARD_BUTTONS: ReadonlyArray<CardButton> = [
  { kind: 'close', command: 'Close', label: 'Close', text: '✕' },
  {
    kind: 'duplicate',
    command: 'Duplicate',
    label: 'Duplicate',
    icon: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15"/>',
  },
  {
    kind: 'edit',
    command: 'Edit',
    label: 'Edit',
    icon: '<path d="M4 20l4.5-1L19 8.5a2.1 2.1 0 0 0-3-3L5 16z"/><path d="M13.5 8l3 3"/>',
  },
  { kind: 'copy', command: 'Copy', label: 'Copy', text: 'Copy' },
  { kind: 'save', command: 'Save', label: 'Save to the Desktop', text: 'Save' },
];
