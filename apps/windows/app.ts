import { defineApp } from '../../core/app';

export const windows = defineApp({
  id: 'windows',
  name: 'Windows',
  icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/>',
  shortcuts: [
    { name: 'left', title: 'Left half', keys: ['Control+A'] },
    { name: 'right', title: 'Right half', keys: ['Control+D'] },
    { name: 'full', title: 'Full screen', keys: ['Control+W'] },
  ],
});
