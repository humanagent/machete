import { defineApp } from '../../core/app';

export const rewrite = defineApp({
  id: 'rewrite',
  name: 'Rewrite',
  icon: '<path d="M4 20l4.5-1L19 8.5a2.1 2.1 0 0 0-3-3L5 16z"/><path d="M13.5 20H20"/>',
  shortcuts: [
    { name: 'fix', title: 'Fix the selected text', keys: ['Shift+CommandOrControl+G'] },
    { name: 'panel', title: 'More options', keys: ['Alt+Shift+CommandOrControl+G'] },
  ],
  menu: 'panel',
  windows: { rewrite: 'renderer' },
});
