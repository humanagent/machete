import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { CARD_BUTTONS } from '../../../apps/screenshot/card';
import { PreviewsCommand } from '../../../apps/screenshot/ipc';

const read = (f: string) =>
  readFileSync(join(import.meta.dir, '../../../apps/screenshot/renderer/previews', f), 'utf8');

test('close, duplicate, edit, copy and save, each in its place and with a command that exists', () => {
  expect(CARD_BUTTONS.map((b) => b.kind)).toEqual(['close', 'duplicate', 'edit', 'copy', 'save']);
  const html = read('index.html');
  for (const b of CARD_BUTTONS) {
    expect(Schema.is(PreviewsCommand)({ _tag: b.command, id: 'x' })).toBe(true);
    expect((b.text === undefined) !== (b.icon === undefined)).toBe(true);
    expect(html).toContain(`.${b.kind} {`);
  }
  expect(html).toMatch(/\.duplicate \{\s*top: 7px;\s*right: 39px;/);
  expect(html).toMatch(/\.edit \{\s*top: 7px;\s*right: 7px;/);
});

test('only its button edits: the picture has no click of its own', () => {
  const main = read('main.ts');
  expect(main).not.toContain("'Edit'");
  expect(main).not.toMatch(/(div|img)\.addEventListener\('click'/);
  expect(main).toContain("img.addEventListener('dragstart'");
});
