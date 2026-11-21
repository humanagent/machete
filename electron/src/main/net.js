'use strict';

/** fetch() reports network failures as a bare "fetch failed"; use the wording URLSession shows. */
function networkError(e) {
  if (e?.name === 'AbortError' || e?.cancelled) return e;
  if (!(e instanceof TypeError)) return e;
  const code = e.cause?.code || '';
  const msg = ({
    ENOTFOUND: 'A server with the specified hostname could not be found.',
    EAI_AGAIN: 'The Internet connection appears to be offline.',
    ENETUNREACH: 'The Internet connection appears to be offline.',
    ECONNREFUSED: 'Could not connect to the server.',
    ECONNRESET: 'The network connection was lost.',
    ETIMEDOUT: 'The request timed out.',
    UND_ERR_CONNECT_TIMEOUT: 'The request timed out.',
  })[code] || 'The network connection was lost.';
  const err = new Error(msg);
  err.cause = e;
  return err;
}

async function fetchChecked(url, opts) {
  try { return await fetch(url, opts); } catch (e) { throw networkError(e); }
}

module.exports = { fetchChecked, networkError };
