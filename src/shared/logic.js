'use strict';
// Pure logic ported 1:1 from AppState.swift / Profiles.swift. No Electron imports, so it is unit-testable.
const S = require('./strings');

const speakerLabel = (s) => (s === 'me' ? 'Me' : 'Them');

/** Follow's "nothing to say" tag, only when it stands on a line of its own. */
function isSilent(text) {
  const strip = /^[\s*`.\[\]<>]+|[\s*`.\[\]<>]+$/g;
  return String(text).split('\n').some((line) => {
    const t = line.replace(strip, '').toUpperCase();
    return t === 'SILENT' || t === 'NOTHING';
  });
}

function looksLikeQuestion(text) {
  const t = String(text).toLowerCase().trim();
  if (t.includes('?')) return true;
  const parts = t.split(/[.!]/).filter((p) => p.length > 0); // Swift split omits empty pieces
  const lastSentence = parts.length ? parts[parts.length - 1] : t;
  const s = lastSentence.replace(/^ +| +$/g, '');
  return S.questionStarters.some((st) => s.startsWith(st));
}

/** Instructions sent with every request: the bot's prompt plus the shared rules. */
function systemPrompt(profile) {
  return profile.instructions + '\n\n' + S.baseRules;
}

/**
 * The user-turn text, identical to AppState.buildPrompt(question:).
 * `exchanges` must not include the exchange being asked (the native app builds it before appending).
 */
function buildPrompt(question, { lines = [], partialMe = '', partialThem = '', exchanges = [], context = '' } = {}) {
  const transcript = lines.slice(-300).map((l) => `${speakerLabel(l.speaker)}: ${l.text}`);
  if (partialThem) transcript.push(`Them: ${partialThem}`);
  if (partialMe) transcript.push(`Me: ${partialMe}`);

  const task = question === '' ? S.defaultTask : question;

  const history = exchanges.slice(-4).flatMap((e) => {
    if (e.answer == null) return [];
    if (e.isFollow) return [`You (follow-mode suggestion): ${e.answer}`];
    return [`Me: ${e.typed === '' ? '(asked for help with the screen)' : e.typed}\nYou: ${e.answer}`];
  });
  const ctx = String(context).trim();

  const c = ctx === '' ? '' : `Context about me / this session:\n<context>\n${ctx}\n</context>\n`;
  const t = transcript.length === 0 ? ''
    : `Live transcript of the current conversation ("Me" = my microphone, "Them" = the other people / computer audio):\n<transcript>\n${transcript.join('\n')}\n</transcript>\n`;
  const h = history.length === 0 ? '' : `Earlier in this chat:\n<history>\n${history.join('\n\n')}\n</history>\n`;
  return `${c}\nAttached is a screenshot of my screen right now.\n${t}\n${h}\nTask: ${task}`;
}

/** Upgrades built-in prompts the user never edited (ProfileStore.load). */
function upgradeProfiles(profiles) {
  const previous = [S.oldSystemDesignPrompt, S.previousSystemDesignPrompt2, S.previousSystemDesignPrompt3, S.previousSystemDesignPrompt4]
    .map((p) => p.trim());
  return profiles.map((p) => (previous.includes(String(p.instructions).trim()) ? { ...p, instructions: S.systemDesignPrompt } : p));
}

/** Mean absolute difference (0-255) between two screen fingerprints. */
function fingerprintDifference(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

const clock = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

module.exports = { isSilent, looksLikeQuestion, systemPrompt, buildPrompt, upgradeProfiles, fingerprintDifference, clock, speakerLabel };
