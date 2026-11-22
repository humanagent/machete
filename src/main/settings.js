'use strict';
// Replaces UserDefaults. Same keys and defaults as the native app; on first run they are imported
// from the native app's defaults domain so the switch is seamless.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { supportDir, isMac, ensureDir } = require('./paths');

const file = path.join(supportDir, 'settings.json');

const DEFAULTS = {
  glassOpacity: 0.55,
  language: 'en-US',
  model: 'gpt-6.2-sol',
  cardWidth: 640,
  cardHeight: 560,
  autoAnswer: true,
  profileID: null,
  siwcHostID: null,
  siwcClientID: null,
};

const TYPES = { glassOpacity: 'float', cardWidth: 'float', cardHeight: 'float', autoAnswer: 'bool' };

let values = null;

function readNativeDefaults() {
  if (!isMac) return {};
  const out = {};
  for (const domain of ['local.gpt-helper', 'ar.com.machete']) { // later domain wins
    for (const key of Object.keys(DEFAULTS)) {
      try {
        const raw = execFileSync('/usr/bin/defaults', ['read', domain, key], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (TYPES[key] === 'float') out[key] = Number(raw);
        else if (TYPES[key] === 'bool') out[key] = raw === '1' || raw === 'true';
        else out[key] = raw;
      } catch { /* key not set */ }
    }
  }
  return out;
}

function load() {
  if (values) return values;
  try {
    values = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    values = { ...DEFAULTS, ...readNativeDefaults() };
    save();
  }
  return values;
}

function save() {
  ensureDir(supportDir);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(values, null, 2));
  fs.renameSync(tmp, file);
}

function get(key) { return load()[key]; }
function set(key, value) { load()[key] = value; save(); }

module.exports = { get, set, DEFAULTS };
