import { defineApp } from '../../core/app';

export const clipboard = defineApp({
  id: 'clipboard',
  name: 'Clipboard',
  icon: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3.5h6V5M9 11h6M9 15h4"/>',
  shortcuts: [{ name: 'toggle', title: 'Show or hide', keys: ['Shift+CommandOrControl+V'] }],
  menu: 'toggle',
  settings: [
    { name: 'history', title: 'History', kind: 'action', button: 'Clear', confirm: 'Clear it all?' },
  ],
  windows: { clipboard: 'renderer' },
});
