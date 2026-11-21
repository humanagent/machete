'use strict';
const fs = require('fs');
const path = require('path');
const { logFile } = require('./paths');

/** Appends diagnostic lines to ~/Library/Logs/Machete.log (no audio or transcript content), like Log.swift. */
function write(msg) {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const line = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)} ${msg}\n`;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch { /* logging never breaks the app */ }
}

module.exports = { write };
