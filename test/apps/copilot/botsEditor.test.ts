import { describe, expect, test } from 'bun:test';
import { BotsEditor, searchBots } from '../../../apps/copilot/botsEditor';
import type { BotsRequest } from '../../../apps/copilot/ipc';

/** A main process with two bots, and an editor of them. */
const setup = async () => {
  let bots = [
    { id: 'a', name: 'General', instructions: 'Be brief.', context: '' },
    { id: 'b', name: 'Coding', instructions: 'Restate it.', context: '' },
  ];
  let selected = 'a';
  const asked: Array<BotsRequest> = [];
  const ask = async (raw: unknown) => {
    const r = raw as BotsRequest;
    asked.push(r);
    switch (r._tag) {
      case 'Get':
        return { profiles: bots, selectedProfileID: selected };
      case 'Add':
        bots = [...bots, { id: 'n', name: 'New', instructions: '', context: '' }];
        return 'n';
      case 'Remove':
        bots = bots.filter((p) => p.id !== r.id);
        return;
      case 'Select':
        selected = r.id;
        return;
      case 'Update':
        bots = bots.map((p) => (p.id === r.id ? { ...p, ...(r.fields as object) } : p));
        return;
      case 'AddFiles':
        return `Added ${r.files.length}`;
      case 'Choose':
        return ['/cv.pdf'];
    }
  };
  let drawn = 0;
  const editor = new BotsEditor(ask, () => void drawn++, 10);
  await editor.refresh();
  const tags = () => asked.map((r) => r._tag);
  return { editor, asked, tags, bots: () => bots, drawn: () => drawn };
};
const later = () => new Promise((r) => setTimeout(r, 25));

describe('editing bots', () => {
  test('opens the one in use', async () => {
    const { editor } = await setup();
    expect(editor.view.editing?.id).toBe('a');
    expect(editor.view.inUse).toBe('a');
  });

  test('typing shows at once and is saved once, a moment later', async () => {
    const { editor, tags, bots } = await setup();
    editor.edit('name', 'S');
    editor.edit('name', 'St');
    editor.edit('name', 'Standup');
    expect(editor.view.editing?.name).toBe('Standup');
    expect(tags()).toEqual(['Get']);
    await later();
    expect(tags().filter((t) => t === 'Update')).toHaveLength(1);
    expect(bots()[0]!.name).toBe('Standup');
  });

  test('fields are saved apart', async () => {
    const { editor, bots } = await setup();
    editor.edit('instructions', 'Three lines.');
    editor.edit('context', 'Payments');
    await later();
    expect(bots()[0]).toMatchObject({ instructions: 'Three lines.', context: 'Payments' });
  });

  test('opening another saves what was being typed first', async () => {
    const { editor, bots } = await setup();
    editor.edit('context', 'Payments');
    editor.open('b');
    expect(bots()[0]!.context).toBe('Payments');
    expect(editor.view.editing?.id).toBe('b');
  });

  test('a refresh doesn’t undo what isn’t saved yet', async () => {
    const { editor } = await setup();
    editor.edit('name', 'Typing');
    await editor.refresh();
    expect(editor.view.editing?.name).toBe('Typing');
  });

  test('only the newest refresh counts', async () => {
    let answer: Array<(s: unknown) => void> = [];
    const editor = new BotsEditor(
      () => new Promise((r) => void answer.push(r)),
      () => {},
    );
    const first = editor.refresh();
    const second = editor.refresh();
    const bot = (id: string) => ({ id, name: id, instructions: '', context: '' });
    answer[1]!({ profiles: [bot('new')], selectedProfileID: 'new' });
    answer[0]!({ profiles: [bot('old')], selectedProfileID: 'old' });
    await Promise.all([first, second]);
    expect(editor.view.editing?.id).toBe('new');
  });

  test('a new bot is opened', async () => {
    const { editor } = await setup();
    await editor.add();
    expect(editor.view.editing?.id).toBe('n');
    expect(editor.view.profiles).toHaveLength(3);
  });

  test('deleting asks first, drops its unsaved edits, and opens another', async () => {
    const { editor, tags, bots } = await setup();
    editor.open('b');
    editor.edit('name', 'Gone');
    await editor.remove();
    expect(editor.view.removing).toBe(true);
    expect(bots()).toHaveLength(2);
    await editor.remove();
    await later();
    expect(tags()).not.toContain('Update');
    expect(bots().map((p) => p.id)).toEqual(['a']);
    expect(editor.view.editing?.id).toBe('a');
  });

  test('opening another takes the question back; the last one can’t be deleted', async () => {
    const { editor, bots } = await setup();
    await editor.remove();
    editor.open('b');
    expect(editor.view.removing).toBe(false);
    await editor.remove();
    await editor.remove();
    await editor.remove();
    await editor.remove();
    expect(bots()).toHaveLength(1);
  });

  test('using one, and adding files to it', async () => {
    const { editor, asked } = await setup();
    editor.open('b');
    await editor.use();
    expect(editor.view.inUse).toBe('b');
    await editor.choose();
    expect(asked).toContainEqual({ _tag: 'AddFiles', id: 'b', files: ['/cv.pdf'] });
    expect(editor.view.note).toBe('Added 1');
    await editor.addFiles([]);
    expect(asked.filter((r) => r._tag === 'AddFiles')).toHaveLength(1);
  });

  test('what is typed is saved before files are added, and both end up there', async () => {
    const order: Array<string> = [];
    let context = '';
    const editor = new BotsEditor(
      async (raw) => {
        const r = raw as BotsRequest;
        if (r._tag === 'Update') {
          await new Promise((go) => setTimeout(go, 15));
          context = (r.fields as { context: string }).context;
        }
        if (r._tag === 'AddFiles') context += ' + cv';
        order.push(r._tag);
        if (r._tag === 'Get')
          return {
            profiles: [{ id: 'a', name: 'A', instructions: '', context }],
            selectedProfileID: 'a',
          };
        return 'Added';
      },
      () => {},
      10,
    );
    await editor.refresh();
    editor.edit('context', 'Typed');
    await editor.addFiles(['/cv.pdf']);
    await later();
    expect(order.indexOf('Update')).toBeLessThan(order.indexOf('AddFiles'));
    expect(editor.view.editing?.context).toBe('Typed + cv');
  });

  test('an answer older than a save on its way is ignored', async () => {
    let saved: () => void = () => {};
    const editor = new BotsEditor(
      (raw) =>
        (raw as BotsRequest)._tag === 'Update'
          ? new Promise<void>((r) => void (saved = r))
          : Promise.resolve({
              profiles: [{ id: 'a', name: 'Old', instructions: '', context: '' }],
              selectedProfileID: 'a',
            }),
      () => {},
      1,
    );
    await editor.refresh();
    editor.edit('name', 'New');
    await later();
    await editor.refresh();
    expect(editor.view.editing?.name).toBe('New');
    saved();
  });

  test('a save that fails doesn’t leave it stuck', async () => {
    const editor = new BotsEditor(
      (raw) =>
        (raw as BotsRequest)._tag === 'Update'
          ? Promise.reject(new Error('disk'))
          : Promise.resolve({
              profiles: [{ id: 'a', name: 'Saved', instructions: '', context: '' }],
              selectedProfileID: 'a',
            }),
      () => {},
      1,
    );
    await editor.refresh();
    editor.edit('name', 'Lost');
    await later();
    expect(editor.view.editing?.name).toBe('Saved');
  });

  test('searching by name', async () => {
    const { editor } = await setup();
    const names = (typed: string) => searchBots(editor.view.profiles, typed).map((p) => p.name);
    expect(names('')).toEqual(['General', 'Coding']);
    expect(names('  cod ')).toEqual(['Coding']);
    expect(names('zzz')).toEqual([]);
  });

  test('opening the panel again shows the one in use, with what was typed saved', async () => {
    const { editor, bots } = await setup();
    editor.open('b');
    editor.edit('context', 'Half typed');
    editor.showInUse();
    await later();
    await editor.refresh();
    expect(editor.view.editing?.id).toBe('a');
    expect(bots()[1]!.context).toBe('Half typed');
  });
});
