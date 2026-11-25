// Pure rules of the assistant: prompt building, follow-mode silence, question detection.
// No I/O, so everything here is unit tested directly.
import type { Speaker } from '../../core/domain';
import type { Exchange, Profile, TranscriptLine } from './domain';
import { Strings } from './strings';

export const speakerLabel = (s: Speaker): 'Me' | 'Them' => (s === 'me' ? 'Me' : 'Them');

const TAG_EDGES = /^[\s*`.[\]<>]+|[\s*`.[\]<>]+$/g;

/** Follow mode's "nothing to say" tag, only when it stands on a line of its own. */
export const isSilent = (text: string): boolean =>
  text.split('\n').some((line) => {
    const t = line.replace(TAG_EDGES, '').toUpperCase();
    return t === 'SILENT' || t === 'NOTHING';
  });

/** Whether the other side just asked something: a question mark, or a sentence that starts like a question. */
export const looksLikeQuestion = (text: string): boolean => {
  const t = text.toLowerCase().trim();
  if (t.includes('?')) return true;
  const parts = t.split(/[.!]/).filter((p) => p.length > 0);
  const last = (parts.at(-1) ?? t).replace(/^ +| +$/g, '');
  return Strings.questionStarters.some((starter) => last.startsWith(starter));
};

/** Instructions sent with every request: the bot's prompt plus the shared rules. */
export const systemPrompt = (profile: Pick<Profile, 'instructions'>): string =>
  `${profile.instructions}\n\n${Strings.baseRules}`;

export interface PromptInput {
  readonly lines?: ReadonlyArray<Pick<TranscriptLine, 'speaker' | 'text'>>;
  readonly partialMe?: string;
  readonly partialThem?: string;
  /** Earlier exchanges, not including the one being asked. */
  readonly exchanges?: ReadonlyArray<Pick<Exchange, 'answer' | 'isFollow' | 'typed'>>;
  readonly context?: string;
}

/** The user turn: context, live transcript, recent history and the task. */
export const buildPrompt = (question: string, input: PromptInput = {}): string => {
  const { lines = [], partialMe = '', partialThem = '', exchanges = [], context = '' } = input;
  const transcript = lines.slice(-300).map((l) => `${speakerLabel(l.speaker)}: ${l.text}`);
  if (partialThem) transcript.push(`Them: ${partialThem}`);
  if (partialMe) transcript.push(`Me: ${partialMe}`);

  const task = question === '' ? Strings.defaultTask : question;
  const history = exchanges.slice(-4).flatMap((e) => {
    if (e.answer == null) return [];
    if (e.isFollow) return [`You (follow-mode suggestion): ${e.answer}`];
    return [`Me: ${e.typed === '' ? '(asked for help with the screen)' : e.typed}\nYou: ${e.answer}`];
  });
  const ctx = context.trim();

  const c = ctx === '' ? '' : `Context about me / this session:\n<context>\n${ctx}\n</context>\n`;
  const t =
    transcript.length === 0
      ? ''
      : `Live transcript of the current conversation ("Me" = my microphone, "Them" = the other people / computer audio):\n<transcript>\n${transcript.join('\n')}\n</transcript>\n`;
  const h =
    history.length === 0 ? '' : `Earlier in this chat:\n<history>\n${history.join('\n\n')}\n</history>\n`;
  return `${c}\nAttached is a screenshot of my screen right now.\n${t}\n${h}\nTask: ${task}`;
};

/** Mean absolute difference (0-255) between two screen fingerprints; 255 when they can't be compared. */
export const fingerprintDifference = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number => {
  if (a.length !== b.length || a.length === 0) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / a.length;
};

/** Whether something was said since `lastLine`. By id: the count stops growing at the cap, and starts over on New chat. */
export const newSpeech = (
  lines: ReadonlyArray<Pick<TranscriptLine, 'id'>>,
  lastLine: string | undefined,
): boolean => {
  const last = lines.at(-1)?.id;
  return last !== undefined && last !== lastLine;
};

/** m:ss */
export const clock = (secs: number): string =>
  `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

/** Whole seconds recorded, across pauses. */
export const recordedSeconds = (
  s: { readonly isPaused: boolean; readonly listenStart: number | null; readonly recordedBefore: number },
  now: number,
): number => {
  const current = s.isPaused || s.listenStart == null ? 0 : (now - s.listenStart) / 1000;
  return Math.max(0, Math.floor(s.recordedBefore + current));
};

/** Text of a transcript for the clipboard. */
export const transcriptText = (lines: ReadonlyArray<TranscriptLine>): string =>
  lines.map((l) => `${clock(l.offset)} ${speakerLabel(l.speaker)}: ${l.text}`).join('\n');

/** Whether the answer card below the bar shows. */
export const cardVisible = (s: {
  readonly collapsed: boolean;
  readonly cardOpen: boolean;
  readonly loggedIn: boolean | null;
  readonly isThinking: boolean;
  readonly exchanges: ReadonlyArray<unknown>;
  readonly errorText: string | null;
  readonly showTranscript: boolean;
  readonly isListening: boolean;
}): boolean =>
  !s.collapsed &&
  (s.cardOpen ||
    s.loggedIn === false ||
    s.isThinking ||
    s.exchanges.length > 0 ||
    s.errorText != null ||
    (s.showTranscript && !s.isListening));
