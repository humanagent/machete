// Turns transport failures into the wording macOS uses ("The Internet connection appears to be offline.").
import { HttpClientError } from 'effect/http';
import { ChatGptError } from '../errors';

const MESSAGES: Readonly<Record<string, string>> = {
  ENOTFOUND: 'A server with the specified hostname could not be found.',
  EAI_AGAIN: 'The Internet connection appears to be offline.',
  ENETUNREACH: 'The Internet connection appears to be offline.',
  ECONNREFUSED: 'Could not connect to the server.',
  ECONNRESET: 'The network connection was lost.',
  ETIMEDOUT: 'The request timed out.',
  UND_ERR_CONNECT_TIMEOUT: 'The request timed out.',
};

const codeOf = (u: unknown): string | undefined => {
  for (let e: unknown = u, depth = 0; e && depth < 5; depth++) {
    if (typeof e === 'object' && 'code' in e && typeof e.code === 'string') return e.code;
    e = typeof e === 'object' && 'cause' in e ? e.cause : undefined;
  }
  return undefined;
};

export const networkMessage = (cause: unknown): string =>
  MESSAGES[codeOf(cause) ?? ''] ?? 'The network connection was lost.';

/** Any HttpClient failure as a ChatGptError with a readable message. */
export const fromHttpError = (error: HttpClientError.HttpClientError): ChatGptError =>
  ChatGptError.of(
    error.reason._tag === 'TransportError' ? networkMessage(error.reason.cause) : error.message,
  );
