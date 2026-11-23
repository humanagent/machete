// Values every product shares: who is speaking, the languages, the ChatGPT models.
// Every value that crosses a boundary (disk, IPC, the native helper) is a Schema.
import { Schema } from 'effect';

export const Speaker = Schema.Literals(['me', 'them']);
export type Speaker = typeof Speaker.Type;

export const Model = Schema.Struct({ slug: Schema.String, name: Schema.String });
export type Model = typeof Model.Type;

export const Language = Schema.Literals(['en-US', 'es-ES', 'es-419']);
export type Language = typeof Language.Type;
export const Languages: ReadonlyArray<readonly [Language, string]> = [
  ['en-US', 'English'],
  ['es-419', 'Español (Latinoamérica)'],
  ['es-ES', 'Español (España)'],
];
