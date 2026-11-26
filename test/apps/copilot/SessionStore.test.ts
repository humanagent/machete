import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { SessionStore } from '../../../apps/copilot/services/SessionStore';
import { filesAt, runInTempDir } from '../../support/fakes';

const layer = (dir: string) => SessionStore.layer.pipe(Layer.provide(filesAt(dir)));
const session = (id: string, startedAt: number) => ({
  id,
  title: id,
  startedAt,
  seconds: 10,
  lines: [{ id: `${id}-1`, speaker: 'me' as const, text: 'Hi.', offset: 0 }],
});

test('a broken index never hides the sessions it listed', async () => {
  const ids = await runInTempDir(layer, (dir) =>
    Effect.gen(function* () {
      const store = yield* Effect.service(SessionStore);
      yield* store.save(session('a', 1));
      yield* store.save(session('b', 2));
      yield* Effect.promise(() => writeFile(join(dir, 'sessions', 'index.json'), '{ broken'));
      const listed = (yield* store.list).map((s) => s.id);
      const after = (yield* store.save(session('c', 3))).map((s) => s.id);
      return { listed, after };
    }),
  );
  expect(ids).toEqual({ listed: ['b', 'a'], after: ['c', 'b', 'a'] });
});
