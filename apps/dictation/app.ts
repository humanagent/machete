import { defineApp } from '../../core/app';
import { Languages } from '../../core/domain';

export const dictation = defineApp({
  id: 'dictation',
  name: 'Dictation',
  icon: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  shortcuts: [{ name: 'toggle', title: 'Dictate', keys: ['RightAlt', 'Alt+D'] }],
  menu: 'toggle',
  settings: [
    {
      name: 'language',
      title: 'Language',
      hint: 'What you dictate in. It can be different from the call’s.',
      kind: 'choice',
      options: Languages,
    },
  ],
  windows: { dictation: 'renderer' },
});
