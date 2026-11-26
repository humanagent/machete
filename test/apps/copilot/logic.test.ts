import { describe, expect, test } from 'bun:test';
import * as L from '../../../apps/copilot/logic';
import { Strings } from '../../../apps/copilot/strings';

describe('isSilent', () => {
  test('only a line that is just the tag', () => {
    for (const s of ['SILENT', '  **SILENT**  ', '`silent`.', '[NOTHING]', 'Looks fine\nSILENT']) {
      expect(L.isSilent(s)).toBe(true);
    }
    for (const s of ['Stay silent about it', 'The answer is 2x, not x.']) expect(L.isSilent(s)).toBe(false);
  });
});

describe('looksLikeQuestion', () => {
  test.each([
    ['How would you scale it?', true],
    ['Cuánto es 4 + 4', true],
    ['¿Me ayudás con esto', true],
    ['Tell me about a project you built', true],
    ['Thanks. Walk me through the design', true],
    ['Contame de algún proyecto', true],
    ['Por qué elegiste Postgres', true],
    ['That sounds great. Let us continue.', false],
    ['', false],
  ])('%p → %p', (text, expected) => expect(L.looksLikeQuestion(text)).toBe(expected));
});

test('systemPrompt = bot instructions + base rules', () => {
  expect(L.systemPrompt({ instructions: 'You are X.' })).toBe(`You are X.\n\n${Strings.baseRules}`);
});

describe('buildPrompt', () => {
  test('empty question asks for the default task, no optional blocks', () => {
    expect(L.buildPrompt('')).toBe(
      `\nAttached is a screenshot of my screen right now.\n\n\nTask: ${Strings.defaultTask}`,
    );
  });

  test('context, transcript with partials, history', () => {
    const out = L.buildPrompt('What next?', {
      context: '  My notes  ',
      lines: [
        { speaker: 'them', text: 'Hi' },
        { speaker: 'me', text: 'Hello' },
      ],
      partialThem: 'So tell',
      partialMe: 'Sure',
      exchanges: [
        { typed: '', answer: 'A1', isFollow: false },
        { typed: 'q2', answer: null, isFollow: false },
        { isFollow: true, typed: 'x', answer: 'Fix it' },
      ],
    });
    expect(out).toBe(
      'Context about me / this session:\n<context>\nMy notes\n</context>\n\n' +
        'Attached is a screenshot of my screen right now.\n' +
        'Live transcript of the current conversation ("Me" = my microphone, "Them" = the other people / computer audio):\n' +
        '<transcript>\nThem: Hi\nMe: Hello\nThem: So tell\nMe: Sure\n</transcript>\n\n' +
        'Earlier in this chat:\n<history>\nMe: (asked for help with the screen)\nYou: A1\n\nYou (follow-mode suggestion): Fix it\n</history>\n\n' +
        'Task: What next?',
    );
  });

  test('keeps only the last 300 lines and 4 exchanges', () => {
    const lines = Array.from({ length: 310 }, (_, i) => ({ speaker: 'me' as const, text: `l${i}` }));
    const exchanges = Array.from({ length: 6 }, (_, i) => ({
      typed: `q${i}`,
      answer: `a${i}`,
      isFollow: false,
    }));
    const out = L.buildPrompt('x', { lines, exchanges });
    expect(out).not.toContain('Me: l9\n');
    expect(out).toContain('Me: l10\n');
    expect(out).toContain('Me: l309');
    expect(out).not.toContain('q1');
    expect(out).toContain('Me: q2\nYou: a2');
  });
});

test('default bots', () => {
  expect(Strings.defaultProfiles.map((p) => p.name)).toEqual(['General', 'Sales']);
  expect(
    Strings.defaultProfiles[0]?.instructions.startsWith('You are Machete, a real-time assistant on my Mac.'),
  ).toBe(true);
  expect(Strings.presets.whatToSay.label).toBe('What should I say?');
});

test('fingerprintDifference', () => {
  expect(L.fingerprintDifference([0, 10], [10, 0])).toBe(10);
  expect(L.fingerprintDifference([], [])).toBe(255);
  expect(L.fingerprintDifference([1], [1, 2])).toBe(255);
});

test('clock and recordedSeconds', () => {
  expect(L.clock(0)).toBe('0:00');
  expect(L.clock(768)).toBe('12:48');
  expect(L.recordedSeconds({ isPaused: false, listenStart: 1_000, recordedBefore: 5 }, 11_500)).toBe(15);
  expect(L.recordedSeconds({ isPaused: true, listenStart: 1_000, recordedBefore: 5.9 }, 99_000)).toBe(5);
});

test('transcriptText', () => {
  expect(
    L.transcriptText([
      { id: '1', speaker: 'them', text: 'Hi', offset: 3 },
      { id: '2', speaker: 'me', text: 'Hey', offset: 65 },
    ]),
  ).toBe('0:03 Them: Hi\n1:05 Me: Hey');
});

describe('cardVisible', () => {
  const base = {
    collapsed: false,
    cardOpen: false,
    loggedIn: true,
    isThinking: false,
    exchanges: [],
    errorText: null,
    page: 'chat' as const,
  };
  test('closed by default, open for any reason to show something', () => {
    expect(L.cardVisible(base)).toBe(false);
    expect(L.cardVisible({ ...base, cardOpen: true })).toBe(true);
    expect(L.cardVisible({ ...base, loggedIn: false })).toBe(true);
    expect(L.cardVisible({ ...base, errorText: 'x' })).toBe(true);
    expect(L.cardVisible({ ...base, exchanges: [1] })).toBe(true);
    expect(L.cardVisible({ ...base, page: 'sessions' })).toBe(true);
    expect(L.cardVisible({ ...base, page: 'session' })).toBe(true);
  });
  test('collapsing wins', () =>
    expect(L.cardVisible({ ...base, cardOpen: true, collapsed: true })).toBe(false));
});

test('new speech is noticed at the cap and after New chat, and only once', () => {
  const full = (from: number) => Array.from({ length: 400 }, (_, i) => ({ id: String(from + i) }));
  expect(L.newSpeech(full(0), '399')).toBe(false);
  expect(L.newSpeech(full(1), '399')).toBe(true); // same count, one line later
  expect(L.newSpeech([{ id: 'x' }], '399')).toBe(true); // New chat: fewer lines than before
  expect(L.newSpeech([], '399')).toBe(false);
  expect(L.newSpeech([{ id: 'x' }], undefined)).toBe(true);
});

describe('sessions', () => {
  test('a title is one clean line', () => {
    expect(L.cleanTitle('"Compensation Discussion with Fabricio."')).toBe(
      'Compensation Discussion with Fabricio',
    );
    expect(L.cleanTitle('Title: Padel Club Planning\nmore')).toBe('Padel Club Planning');
    expect(L.cleanTitle('  ')).toBe('');
  });
  test('durations read like a list', () => {
    expect(L.durationLabel(42)).toBe('42s');
    expect(L.durationLabel(36 * 60)).toBe('36m');
    expect(L.durationLabel(69 * 60)).toBe('1h 9m');
  });
});

test('a Follow answer shows while streaming once it is clearly not SILENT', () => {
  expect(L.showsWhileStreaming('SIL')).toBe(false);
  expect(L.showsWhileStreaming('SILENT')).toBe(false);
  expect(L.showsWhileStreaming('[SILENT] and')).toBe(false);
  expect(L.showsWhileStreaming('It is')).toBe(false);
  expect(L.showsWhileStreaming('Four plus four is eight')).toBe(true);
});
