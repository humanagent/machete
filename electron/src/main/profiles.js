'use strict';
// ProfileStore: bots in <support>/profiles.json, same shape the native app reads and writes
// ([{ id: "UPPERCASE-UUID", name, instructions, context }]).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { supportDir, ensureDir } = require('./paths');
const S = require('../shared/strings');
const { upgradeProfiles } = require('../shared/logic');

const file = path.join(supportDir, 'profiles.json');
const newID = () => crypto.randomUUID().toUpperCase();

function defaults() {
  return S.defaultProfiles.map((p) => ({ id: newID(), name: p.name, instructions: p.instructions, context: '' }));
}

function load() {
  try {
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(p) && p.length) {
      return upgradeProfiles(p.map((x) => ({ id: String(x.id), name: x.name ?? '', instructions: x.instructions ?? '', context: x.context ?? '' })));
    }
  } catch { /* no file yet */ }
  return defaults();
}

function save(profiles) {
  ensureDir(supportDir);
  const clean = profiles.map(({ id, name, instructions, context }) => ({ id, name, instructions, context: context ?? '' }));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { load, save, newID, file };
