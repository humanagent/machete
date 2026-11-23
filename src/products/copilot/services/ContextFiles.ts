// Files dropped or chosen in the Bots window (resume, job description, notes) become text in a bot's context.
import { basename, extname } from 'node:path';
import { Context, Effect, FileSystem, Layer, Option } from 'effect';
import { NativeHelper } from '../../../core/services/NativeHelper';

export const EXTENSIONS = [
  'pdf',
  'txt',
  'text',
  'rtf',
  'rtfd',
  'json',
  'csv',
  'html',
  'htm',
  'md',
  'docx',
  'doc',
] as const;
const NEEDS_PARSER = new Set(['pdf', 'docx', 'doc', 'rtf', 'rtfd']);

export const stripHTML = (s: string): string =>
  s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

/** "--- resume.pdf ---\n<text>", ready to append to a context. */
export const contextBlock = (file: string, text: string): Option.Option<string> => {
  const trimmed = text.trim();
  return trimmed === '' ? Option.none() : Option.some(`--- ${basename(file)} ---\n${trimmed}`);
};

/** Appends a block to a context, separated by a blank line. */
export const appendBlock = (context: string, block: string): string =>
  context.trim() === '' ? block : `${context.trim()}\n\n${block}`;

export interface ContextFilesShape {
  readonly block: (file: string) => Effect.Effect<Option.Option<string>>;
}

export class ContextFiles extends Context.Service<ContextFiles, ContextFilesShape>()('machete/ContextFiles') {
  static readonly layer = Layer.effect(
    ContextFiles,
    Effect.gen(function* () {
      const helper = yield* NativeHelper;
      const fs = yield* FileSystem.FileSystem;
      const text = (file: string): Effect.Effect<Option.Option<string>> => {
        if (helper.available) return helper.extractText(file);
        // Without the macOS helper: plain-text formats only.
        const ext = extname(file).slice(1).toLowerCase();
        if (NEEDS_PARSER.has(ext)) return Effect.succeed(Option.none());
        return fs.readFileString(file).pipe(
          Effect.map((s) => Option.some(ext === 'html' || ext === 'htm' ? stripHTML(s) : s)),
          Effect.catch(() => Effect.succeed(Option.none<string>())),
        );
      };
      return {
        block: (file) => text(file).pipe(Effect.map(Option.flatMap((t) => contextBlock(file, t)))),
      } satisfies ContextFilesShape;
    }),
  );
}
