import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { ProfileStore } from '../../../src/products/copilot/services/ProfileStore';
import { Strings } from '../../../src/products/copilot/strings';
import { filesAt, runInTempDir } from '../../support/fakes';

const layer = (dir: string) => ProfileStore.layer.pipe(Layer.provide(filesAt(dir)));
const load = Effect.service(ProfileStore).pipe(Effect.flatMap((s) => s.load));

test('the default bots when there is no file', async () => {
  const profiles = await runInTempDir(layer, () => load);
  expect(profiles.map((p) => p.name)).toEqual(Strings.defaultProfiles.map((p) => p.name));
  expect(profiles.every((p) => /^[0-9A-F-]{36}$/.test(p.id))).toBe(true);
});

test('reads older files with missing fields and upgrades untouched prompts', async () => {
  const profiles = await runInTempDir(
    layer,
    () => load,
    (dir) =>
      writeFile(
        join(dir, 'profiles.json'),
        JSON.stringify([{ id: 'A', name: 'SD', instructions: Strings.oldSystemDesignPrompt }, { id: 'B' }]),
      ),
  );
  expect(profiles).toEqual([
    { id: 'A', name: 'SD', instructions: Strings.systemDesignPrompt, context: '' },
    { id: 'B', name: '', instructions: '', context: '' },
  ]);
});

test('save writes the shared format', async () => {
  const saved = await runInTempDir(layer, (dir) =>
    Effect.service(ProfileStore).pipe(
      Effect.flatMap((s) => s.save([{ id: 'X', name: 'Mine', instructions: 'Be brief.', context: 'cv' }])),
      Effect.andThen(Effect.promise(() => readFile(join(dir, 'profiles.json'), 'utf8'))),
    ),
  );
  expect(JSON.parse(saved)).toEqual([{ id: 'X', name: 'Mine', instructions: 'Be brief.', context: 'cv' }]);
});
