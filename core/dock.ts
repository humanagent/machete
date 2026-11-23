/** What to ask macOS for. Asking for what's already so can make the Dock list Machete, so then it's nothing. */
export const dockStep = (shown: boolean, hidden: boolean): 'show' | 'hide' | 'none' =>
  shown === !hidden ? 'none' : hidden ? 'hide' : 'show';
