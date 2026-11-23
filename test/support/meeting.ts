// A synthetic meeting with the volume of a real one: two people, a line every three or four seconds, each heard word
// by word before it is final. The helper reports every one of those pieces.
import { Effect } from 'effect';
import type { Speaker } from '../../core/domain';
import type { HelperEvent } from '../../core/services/NativeHelper';

/** A dense conversation: 53 minutes of a real one came to some 17 lines a minute. */
export const LINES_PER_MINUTE = 18;
/** Pieces of a line heard before it is final, some four a second. */
const PIECES = 12;
const WORDS = 'bueno entonces lo que vemos en el equipo es que hay que priorizar dos o tres temas'.split(' ');

export const lineText = (i: number) =>
  `${i}: ${Array.from({ length: PIECES }, (_, w) => WORDS[(i + w) % WORDS.length]).join(' ')}`;

export const linesOf = (minutes: number) => minutes * LINES_PER_MINUTE;

/** Every event of the meeting, in order. */
export function* meeting(minutes: number): Generator<HelperEvent> {
  for (let i = 0; i < linesOf(minutes); i++) {
    const speaker: Speaker = i % 3 === 0 ? 'me' : 'them';
    const words = lineText(i).split(' ');
    for (let w = 1; w <= words.length; w++)
      yield { type: 'partial', speaker, text: words.slice(0, w).join(' ') };
    yield { type: 'partial', speaker, text: '' };
    yield { type: 'commit', speaker, text: lineText(i) };
  }
}

/** Plays it as fast as it goes, letting whoever listens keep up; `at` runs once every simulated minute. */
export const play = (
  minutes: number,
  emit: (event: HelperEvent) => Effect.Effect<unknown>,
  at: (minute: number) => Effect.Effect<unknown> = () => Effect.void,
) =>
  Effect.gen(function* () {
    let commits = 0;
    for (const event of meeting(minutes)) {
      yield* emit(event);
      if (event.type !== 'commit' || ++commits % LINES_PER_MINUTE !== 0) continue;
      yield* Effect.sleep('1 millis');
      yield* at(commits / LINES_PER_MINUTE);
    }
  });
