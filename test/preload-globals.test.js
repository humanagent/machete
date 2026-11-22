'use strict';
// contextBridge exposes `window.bots` / `window.machete` as non-configurable globals; a top-level
// `const bots = …` in the page script is then a SyntaxError and the whole window stays empty.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

for (const [script, name] of [['manage/app.js', 'bots'], ['overlay/app.js', 'machete']]) {
  test(`${script} loads next to a non-configurable \`${name}\` global`, () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', script), 'utf8');
    const ctx = vm.createContext({});
    vm.runInContext(`Object.defineProperty(globalThis, '${name}', { value: {}, configurable: false })`, ctx);
    // Running without a DOM fails later (ReferenceError on `document`); only a declaration clash is a SyntaxError.
    let err = null;
    try { new vm.Script(src).runInContext(ctx, { timeout: 50 }); } catch (e) { err = e; }
    assert.ok(!(err && err.name === 'SyntaxError'), String(err));
  });
}
