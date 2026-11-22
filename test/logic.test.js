'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/shared/logic');
const S = require('../src/shared/strings');

test('isSilent: only a line that is just the tag', () => {
  assert.equal(L.isSilent('SILENT'), true);
  assert.equal(L.isSilent('  **SILENT**  '), true);
  assert.equal(L.isSilent('`silent`.'), true);
  assert.equal(L.isSilent('[NOTHING]'), true);
  assert.equal(L.isSilent('Looks fine\nSILENT'), true);
  assert.equal(L.isSilent('Stay silent about it'), false);
  assert.equal(L.isSilent('The answer is 2x, not x.'), false);
});

test('looksLikeQuestion: question marks and starters (EN/ES)', () => {
  assert.equal(L.looksLikeQuestion('How would you scale it?'), true);
  assert.equal(L.looksLikeQuestion('Tell me about a project you built'), true);
  assert.equal(L.looksLikeQuestion('Thanks. Walk me through the design'), true);
  assert.equal(L.looksLikeQuestion('Contame de algún proyecto'), true);
  assert.equal(L.looksLikeQuestion('Por qué elegiste Postgres'), true);
  assert.equal(L.looksLikeQuestion('That sounds great. Let us continue.'), false);
  assert.equal(L.looksLikeQuestion(''), false);
});

test('systemPrompt = bot instructions + base rules', () => {
  const p = { instructions: 'You are X.' };
  assert.equal(L.systemPrompt(p), 'You are X.\n\n' + S.baseRules);
});

test('buildPrompt: empty question asks for the default task, no optional blocks', () => {
  const out = L.buildPrompt('', {});
  assert.equal(out, `\nAttached is a screenshot of my screen right now.\n\n\nTask: ${S.defaultTask}`);
});

test('buildPrompt: context, transcript with partials, history', () => {
  const out = L.buildPrompt('What next?', {
    context: '  My resume  ',
    lines: [{ speaker: 'them', text: 'Hi' }, { speaker: 'me', text: 'Hello' }],
    partialThem: 'So tell', partialMe: 'Sure',
    exchanges: [
      { typed: '', answer: 'A1' },
      { typed: 'q2', answer: null },
      { isFollow: true, typed: 'x', answer: 'Fix it' },
    ],
  });
  assert.equal(out,
    'Context about me / this session:\n<context>\nMy resume\n</context>\n\n'
    + 'Attached is a screenshot of my screen right now.\n'
    + 'Live transcript of the current conversation ("Me" = my microphone, "Them" = the other people / computer audio):\n'
    + '<transcript>\nThem: Hi\nMe: Hello\nThem: So tell\nMe: Sure\n</transcript>\n\n'
    + 'Earlier in this chat:\n<history>\nMe: (asked for help with the screen)\nYou: A1\n\nYou (follow-mode suggestion): Fix it\n</history>\n\n'
    + 'Task: What next?');
});

test('buildPrompt keeps only the last 300 lines and 4 exchanges', () => {
  const lines = Array.from({ length: 310 }, (_, i) => ({ speaker: 'me', text: `l${i}` }));
  const exchanges = Array.from({ length: 6 }, (_, i) => ({ typed: `q${i}`, answer: `a${i}` }));
  const out = L.buildPrompt('x', { lines, exchanges });
  assert.ok(!out.includes('Me: l9\n') && out.includes('Me: l10\n') && out.includes('Me: l309'));
  assert.ok(!out.includes('q1') && out.includes('Me: q2\nYou: a2'));
});

test('upgradeProfiles replaces untouched old system design prompts only', () => {
  const out = L.upgradeProfiles([
    { id: 'A', name: 'SD', instructions: '\n' + S.previousSystemDesignPrompt3 + '\n', context: '' },
    { id: 'B', name: 'Mine', instructions: 'custom', context: '' },
  ]);
  assert.equal(out[0].instructions, S.systemDesignPrompt);
  assert.equal(out[1].instructions, 'custom');
});

test('default bots match the native app', () => {
  assert.deepEqual(S.defaultProfiles.map((p) => p.name),
    ['General', 'Coding Interview', 'System Design Interview', 'Behavioral Interview', 'Recruiter Screen', 'Sales']);
  assert.ok(S.defaultProfiles[0].instructions.startsWith('You are Machete, a real-time assistant on my Mac.'));
  assert.equal(S.presets.whatToSay.label, 'What should I say?');
});

test('fingerprintDifference', () => {
  assert.equal(L.fingerprintDifference([0, 10], [10, 0]), 10);
  assert.equal(L.fingerprintDifference([], []), 255);
  assert.equal(L.fingerprintDifference([1], [1, 2]), 255);
});

test('clock formats m:ss', () => {
  assert.equal(L.clock(0), '0:00');
  assert.equal(L.clock(768), '12:48');
});
