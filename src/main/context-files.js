'use strict';
// Turns dropped/chosen files (resume, job description, notes) into plain text for a bot's context (ContextFiles.swift).
const fs = require('fs');
const path = require('path');
const native = require('./native');

const EXTENSIONS = ['pdf', 'txt', 'text', 'rtf', 'rtfd', 'json', 'csv', 'html', 'htm', 'md', 'docx', 'doc'];

function stripHTML(s) {
  return s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function text(file) {
  if (native.available) return native.extractText(file);
  // Non-macOS fallback until the Windows build ships its own extractors (PDF/Word need a parser there).
  const ext = path.extname(file).slice(1).toLowerCase();
  if (['pdf', 'docx', 'doc', 'rtf', 'rtfd'].includes(ext)) return null;
  let s;
  try { s = fs.readFileSync(file, 'utf8'); } catch { return null; }
  return ['html', 'htm'].includes(ext) ? stripHTML(s) : s;
}

/** "--- resume.pdf ---\n<text>" blocks, ready to append to a context. */
async function block(file) {
  const raw = (await text(file))?.trim();
  if (!raw) return null;
  return `--- ${path.basename(file)} ---\n${raw}`;
}

module.exports = { block, EXTENSIONS };
