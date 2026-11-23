import { defineApp } from '../../core/app';

export const snippets = defineApp({
  id: 'snippets',
  name: 'Snippets',
  icon: '<path d="M8 6l-5 6 5 6M16 6l5 6-5 6"/>',
  shortcuts: [{ name: 'toggle', title: 'Show or hide', keys: ['Shift+CommandOrControl+C'] }],
  menu: 'toggle',
  settings: [{ name: 'import', title: 'Text replacements', kind: 'action', button: 'Import from macOS' }],
  windows: { snippets: 'renderer' },
});
