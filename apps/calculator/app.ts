import { defineApp } from '../../core/app';

export const calculator = defineApp({
  id: 'calculator',
  name: 'Calculator',
  icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7.5h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>',
  shortcuts: [{ name: 'toggle', title: 'Show or hide', keys: ['Shift+CommandOrControl+D'] }],
  menu: 'toggle',
  windows: { calculator: 'renderer' },
});
