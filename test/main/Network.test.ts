import { expect, test } from 'bun:test';
import { HttpClientError } from 'effect/http';
import { HttpClientRequest } from 'effect/http';
import { AppPaths } from '../../src/main/services/AppPaths';
import { fromHttpError, networkMessage } from '../../src/main/services/Network';

test('transport failures read like macOS', () => {
  expect(networkMessage({ cause: { code: 'ENOTFOUND' } })).toBe(
    'A server with the specified hostname could not be found.',
  );
  expect(networkMessage(new TypeError('fetch failed', { cause: { code: 'EAI_AGAIN' } }))).toBe(
    'The Internet connection appears to be offline.',
  );
  expect(networkMessage(new Error('weird'))).toBe('The network connection was lost.');
});

test('fromHttpError maps a transport error to a ChatGptError', () => {
  const error = new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request: HttpClientRequest.get('https://api.openai.com'),
      cause: { code: 'ETIMEDOUT' },
    }),
  });
  expect(fromHttpError(error)).toMatchObject({ _tag: 'ChatGptError', message: 'The request timed out.' });
});

test('app paths live under the support folder', () => {
  const p = AppPaths.fromSupportDir('/s', '/l/Machete.log');
  expect(p).toEqual({
    supportDir: '/s',
    settingsFile: '/s/settings.json',
    profilesFile: '/s/profiles.json',
    tokenFile: '/s/siwc.json',
    logFile: '/l/Machete.log',
    chromiumDir: '/s/electron',
  });
  expect(AppPaths.system().supportDir.endsWith('Machete')).toBe(true);
});
