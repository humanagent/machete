'use strict';
const fs = require('fs');
const path = require('path');
const { supportDir, legacyDir } = require('./paths');
const log = require('./log');

/**
 * Data saved under the app's previous name (gpt-helper): ChatGPT sign-in and bots.
 * The native app moves the folder; here files are copied (never deleted) so the old build keeps working.
 */
function migrateLegacyData() {
  if (!fs.existsSync(legacyDir)) return;
  fs.mkdirSync(supportDir, { recursive: true, mode: 0o700 });
  for (const name of ['profiles.json', 'siwc.json']) {
    const from = path.join(legacyDir, name);
    const to = path.join(supportDir, name);
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      fs.copyFileSync(from, to);
      if (name === 'siwc.json') fs.chmodSync(to, 0o600);
      log.write(`migrate: copied ${name} from gpt-helper`);
    }
  }
}

module.exports = { migrateLegacyData };
