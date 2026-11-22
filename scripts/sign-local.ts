// Re-signs the packed app with the local "Machete Local" certificate, when it is installed.
// Ad-hoc builds are identified by their hash, so macOS forgets their permissions on every build;
// a certificate gives them a stable identity ("ar.com.machete" + that certificate).
import { $ } from 'bun';
import { Console, Effect } from 'effect';

const root = new URL('..', import.meta.url).pathname;
const app = `${root}dist/mac-arm64/Machete.app`;
const entitlements = `${root}scripts/entitlements.adhoc.plist`;
const IDENTITY = 'Machete Local';

const sh = (run: () => Promise<unknown>) => Effect.promise(run);

const program = Effect.gen(function* () {
  const identities = yield* sh(() => $`security find-identity -p codesigning`.quiet().nothrow().text());
  const hash = String(identities).match(new RegExp(`([0-9A-F]{40}) "${IDENTITY}"`))?.[1];
  if (!hash) return yield* Console.log(`No "${IDENTITY}" certificate: the build stays ad-hoc signed.`);
  const sign = (path: string, deep: boolean) =>
    sh(() =>
      $`codesign --force ${deep ? ['--deep'] : []} --options runtime --entitlements ${entitlements} --sign ${hash} ${path}`.quiet(),
    );
  // Inside out: nested code first, the helper (same identity as the app), then the app that seals them.
  yield* sign(app, true);
  yield* sign(`${app}/Contents/MacOS/machete-native`, false);
  yield* sign(app, false);
  yield* sh(() => $`codesign --verify --deep --strict ${app}`.quiet());
  yield* Console.log(`signed with "${IDENTITY}" (${hash.slice(0, 8)}…)`);
});

Effect.runPromise(program).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
