// What a long recording does to the helper and to the pipe between it and Machete. The state behind the panel has its
// own tests in test/apps/copilot/AppState.test.ts.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, Layer, Option, Stream } from 'effect';
import { helperBinary, NativeHelper } from '../../core/services/NativeHelper';
import { linesOf, lineText } from '../support/meeting';

const real = Option.getOrUndefined(helperBinary(process.cwd()));
const start = (...args: ReadonlyArray<string>) => {
  const p = Bun.spawn([real!, ...args], { stdout: 'pipe', stderr: 'pipe' });
  return { stdout: () => new Response(p.stdout).text(), log: new Response(p.stderr).text() };
};

describe('a meeting over the serve protocol', () => {
  afterAll(() => {
    delete process.env['FAKE_NATIVE_MEETING'];
  });
  const fake = Option.some(join(import.meta.dir, '../support/fake-native.ts'));
  for (const minutes of [30, 60])
    test(`${minutes} minutes all at once: every line arrives, in order`, async () => {
      process.env['FAKE_NATIVE'] = 'ok';
      process.env['FAKE_NATIVE_MEETING'] = String(minutes);
      const heard = await Effect.runPromise(
        Effect.service(NativeHelper).pipe(
          Effect.flatMap((helper) =>
            Effect.gen(function* () {
              const events = yield* helper.subscribe;
              yield* helper.startListening('en-US');
              return yield* events.pipe(
                Stream.filter((e) => e.type === 'commit'),
                Stream.take(linesOf(minutes) + 1),
                Stream.runCollect,
              );
            }),
          ),
          Effect.provide(NativeHelper.layerFrom(fake).pipe(Layer.provide(NodeServices.layer))),
          Effect.scoped,
        ),
      );
      // The first is the stand-in's own.
      expect([...heard].slice(1).map((e) => (e.type === 'commit' ? e.text : ''))).toEqual(
        Array.from({ length: linesOf(minutes) }, (_, i) => lineText(i)),
      );
    }, 60_000);
});

describe.skipIf(real === undefined)('the real helper', () => {
  test('with nobody reading its output, whoever reports never waits, and no line is lost', async () => {
    const lines = linesOf(60);
    // A reader that isn't there for a while: the pipe fills up right away. (Bun itself would read it at once.)
    const p = Bun.spawn(['sh', '-c', '"$0" output-load "$1" | (sleep 2; cat)', real!, String(lines)], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [text, log] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    expect(Number(log.match(/reported in (\d+) ms/)?.[1])).toBeLessThan(1000);
    const events = text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { readonly type: string; readonly text: string });
    const of = (type: string) => events.filter((e) => e.type === type).map((e) => e.text);
    expect(of('commit')).toEqual(Array.from({ length: lines }, (_, i) => `line ${i}`));
    // Words in progress are dropped meanwhile: the next ones replace them.
    expect(of('partial').length).toBeLessThan(lines * 12);
  }, 30_000);

  // In real time, so only when asked: MACHETE_SOAK=60 bun test heavy-recording (minutes). Two channels transcribed on
  // this Mac from a synthetic voice; no microphone, no screen.
  const minutes = Number(process.env['MACHETE_SOAK'] ?? 0);
  test.skipIf(!(minutes > 0))(
    'two live channels for that long: the memory stays flat and it keeps up',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'machete-soak-'));
      try {
        const said =
          'Let us go over the plan for the quarter and see what is missing. The team made progress. ';
        await Bun.$`say -o ${dir}/v.aiff ${said.repeat(6)}`.quiet();
        await Bun.$`afconvert -f WAVE -d LEI16@48000 -c 1 ${dir}/v.aiff ${dir}/v.wav`.quiet();
        const helper = start('soak', `${dir}/v.wav`, 'en-US', String(minutes * 60));
        const [, log] = await Promise.all([helper.stdout(), helper.log]);
        const at = [...log.matchAll(/footprint=([\d.]+)MB/g)].map((m) => Number(m[1]));
        expect(log).toContain('failures=0');
        expect(at.length).toBeGreaterThan(minutes);
        expect(at.at(-1)! - at[0]!).toBeLessThan(30);
        expect(Number(log.match(/finish took ([\d.]+)s/)?.[1])).toBeLessThan(10);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    (minutes + 5) * 60_000,
  );
});
