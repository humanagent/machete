'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');

const isMac = process.platform === 'darwin';

/** Same folder the native app uses: profiles.json and siwc.json are shared between both builds. */
function appData() {
  if (isMac) return path.join(os.homedir(), 'Library', 'Application Support');
  return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
}

const supportDir = path.join(appData(), 'Machete');
const legacyDir = path.join(appData(), 'gpt-helper');
const logFile = isMac ? path.join(os.homedir(), 'Library', 'Logs', 'Machete.log') : path.join(supportDir, 'Machete.log');

function ensureDir(dir, mode) {
  fs.mkdirSync(dir, { recursive: true, mode });
  return dir;
}

module.exports = { isMac, supportDir, legacyDir, logFile, ensureDir };
