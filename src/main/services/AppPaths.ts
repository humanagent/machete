// Where Machete keeps its files: ~/Library/Application Support/Machete and ~/Library/Logs/Machete.log on macOS.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Context, Layer } from 'effect';

export interface AppPathsShape {
  readonly supportDir: string;
  readonly settingsFile: string;
  readonly profilesFile: string;
  readonly tokenFile: string;
  readonly logFile: string;
  /** Chromium's own data, kept apart from the app's files. */
  readonly chromiumDir: string;
}

export class AppPaths extends Context.Service<AppPaths, AppPathsShape>()('machete/AppPaths') {
  static readonly fromSupportDir = (
    supportDir: string,
    logFile = join(supportDir, 'Machete.log'),
  ): AppPathsShape => ({
    supportDir,
    settingsFile: join(supportDir, 'settings.json'),
    profilesFile: join(supportDir, 'profiles.json'),
    tokenFile: join(supportDir, 'siwc.json'),
    logFile,
    chromiumDir: join(supportDir, 'electron'),
  });

  static readonly system = (): AppPathsShape =>
    process.platform === 'darwin'
      ? AppPaths.fromSupportDir(
          join(homedir(), 'Library', 'Application Support', 'Machete'),
          join(homedir(), 'Library', 'Logs', 'Machete.log'),
        )
      : AppPaths.fromSupportDir(
          join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Machete'),
        );

  static readonly layer = Layer.sync(AppPaths, AppPaths.system);
  static readonly layerAt = (supportDir: string) =>
    Layer.succeed(AppPaths, AppPaths.fromSupportDir(supportDir));
}
