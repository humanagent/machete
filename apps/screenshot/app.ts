import { defineApp } from '../../core/app';
import { BACKGROUNDS, SIZES } from './frame';

const named = (values: ReadonlyArray<string>) =>
  values.map((v) => [v, v[0]!.toUpperCase() + v.slice(1)] as const);

export const screenshot = defineApp({
  id: 'screenshot',
  name: 'Screenshots',
  icon: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><circle cx="12" cy="12" r="3"/>',
  shortcuts: [
    { name: 'full', title: 'Full screen', keys: ['Shift+CommandOrControl+3'] },
    { name: 'area', title: 'Area', keys: ['Shift+CommandOrControl+4'] },
  ],
  menu: 'area',
  settings: [
    { name: 'frame', title: 'Frame', hint: 'The editor opens with it.', kind: 'toggle' },
    {
      name: 'background',
      title: 'Background',
      hint: 'What shows around the screenshot.',
      kind: 'choice',
      options: named(BACKGROUNDS),
    },
    { name: 'size', title: 'Size', hint: 'How wide the frame is.', kind: 'choice', options: named(SIZES) },
  ],
  windows: { previews: 'renderer/previews', editor: 'renderer/editor' },
});
