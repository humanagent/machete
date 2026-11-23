// The scaffold has to type-check and pass what every app has to pass: contributors start from it.
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { $ } from 'bun';

const root = join(import.meta.dir, '..');

test('a new app type-checks, passes the app tests and builds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'machete-new-app-'));
  try {
    for (const f of ['apps', 'core', 'scripts', 'test', 'package.json', 'tsconfig.json', 'bunfig.toml'])
      await cp(join(root, f), join(dir, f), { recursive: true });
    await symlink(join(root, 'node_modules'), join(dir, 'node_modules'));
    await $`bun scripts/new-app.ts color-picker "Color picker"`.cwd(dir).quiet();
    const check = await $`bun check`.cwd(dir).quiet().nothrow();
    expect(check.stdout.toString() + check.stderr.toString()).toContain('No type errors');
    expect((await $`bun test test/apps.test.ts`.cwd(dir).quiet().nothrow()).exitCode).toBe(0);
    expect((await $`bun scripts/build.ts`.cwd(dir).quiet().nothrow()).exitCode).toBe(0);
    // The same one twice, or a bad name, changes nothing.
    expect((await $`bun scripts/new-app.ts color-picker X`.cwd(dir).quiet().nothrow()).exitCode).toBe(1);
    expect((await $`bun scripts/new-app.ts ../evil X`.cwd(dir).quiet().nothrow()).exitCode).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
