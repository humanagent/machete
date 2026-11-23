import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer, Option } from 'effect';
import {
  appendBlock,
  ContextFiles,
  contextBlock,
  stripHTML,
} from '../../../src/products/copilot/services/ContextFiles';
import { fakeHelper, filesAt, runInTempDir } from '../../support/fakes';

test('blocks, appending and HTML stripping', () => {
  expect(contextBlock('/a/cv.pdf', '  text  ')).toEqual(Option.some('--- cv.pdf ---\ntext'));
  expect(contextBlock('/a/cv.pdf', '   ')).toEqual(Option.none());
  expect(appendBlock('', 'B')).toBe('B');
  expect(appendBlock(' A \n', 'B')).toBe('A\n\nB');
  expect(stripHTML('<style>x</style><p>a &amp; b</p>')).toBe('a & b');
});

test('without the helper, plain text is read and PDFs are refused', async () => {
  const result = await runInTempDir(
    (dir) =>
      Layer.unwrap(
        fakeHelper({ available: false }).pipe(
          Effect.map((h) => ContextFiles.layer.pipe(Layer.provide(h.layer), Layer.provide(filesAt(dir)))),
        ),
      ),
    (dir) =>
      Effect.gen(function* () {
        const files = yield* ContextFiles;
        return {
          md: yield* files.block(join(dir, 'notes.md')),
          html: yield* files.block(join(dir, 'page.html')),
          pdf: yield* files.block(join(dir, 'cv.pdf')),
          missing: yield* files.block(join(dir, 'nope.txt')),
        };
      }),
    async (dir) => {
      await writeFile(join(dir, 'notes.md'), '# Notes');
      await writeFile(join(dir, 'page.html'), '<b>Hi</b>');
      await writeFile(join(dir, 'cv.pdf'), '%PDF');
    },
  );
  expect(result).toEqual({
    md: Option.some('--- notes.md ---\n# Notes'),
    html: Option.some('--- page.html ---\nHi'),
    pdf: Option.none(),
    missing: Option.none(),
  });
});
