import { defineApp } from '../../core/app';
import { Languages } from '../../core/domain';

export const copilot = defineApp({
  id: 'copilot',
  name: 'Copilot',
  icon: '<path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>',
  shortcuts: [
    { name: 'toggle', title: 'Show or hide', keys: ['CommandOrControl+[', 'Alt+\\'] },
    { name: 'ask', title: 'Ask about the screen', keys: ['Alt+Return'] },
    { name: 'say', title: 'What should I say?', keys: ['Alt+S'] },
    { name: 'type', title: 'Type a question', keys: ['Alt+Space'] },
    { name: 'listen', title: 'Start or stop recording', keys: ['Alt+M'] },
    { name: 'new', title: 'New chat', keys: ['Alt+R'] },
  ],
  menu: 'toggle',
  settings: [
    { name: 'account', title: 'ChatGPT', kind: 'action', button: 'Sign in', general: true },
    {
      name: 'model',
      title: 'Model',
      hint: 'The one that answers in Copilot.',
      kind: 'choice',
      general: true,
    },
    {
      name: 'autoAnswer',
      title: 'Answer questions on its own',
      hint: 'While recording, when the other side asks something.',
      kind: 'toggle',
    },
    {
      name: 'language',
      title: 'Transcription language',
      hint: 'What the call is in.',
      kind: 'choice',
      options: Languages,
    },
    {
      name: 'panel',
      title: 'Panel',
      hint: 'How much of what’s behind shows through.',
      kind: 'choice',
      options: [
        ['0.35', 'More see-through'],
        ['0.55', 'Balanced'],
        ['0.8', 'Solid'],
      ],
    },
    { name: 'bots', title: 'Bots', kind: 'action', button: 'Open' },
  ],
  windows: { copilot: 'renderer/copilot', bots: 'renderer/bots' },
});
