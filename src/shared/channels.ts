// IPC channel names. Dependency-free so the preloads stay tiny.
export const Channels = {
  overlayState: 'overlay:state',
  overlayCommand: 'overlay:command',
  botsState: 'bots:state',
  botsRequest: 'bots:request',
  dictationEvent: 'dictation:event',
  dictationCommand: 'dictation:command',
} as const;
