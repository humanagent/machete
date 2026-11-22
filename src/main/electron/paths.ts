// Where the bundled windows, preloads and assets live. app.getAppPath() is the project root in development
// and Contents/Resources/app.asar when packaged; the build puts everything under out/ next to package.json.
import { join } from 'node:path';
import { app } from 'electron';

type Window = 'overlay' | 'manage' | 'dictation' | 'permissions';

export const appRoot = (): string => app.getAppPath();
export const rendererFile = (name: Window) => join(appRoot(), 'out', 'renderer', name, 'index.html');
export const preloadFile = (name: Window) => join(appRoot(), 'out', 'preload', `${name}.js`);
export const assetFile = (name: string) => join(appRoot(), 'assets', name);
