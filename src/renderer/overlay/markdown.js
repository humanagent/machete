'use strict';
// BodyView (AnswerText.swift): markdown paragraphs with fenced code blocks rendered as code.
// Inline markdown mirrors AttributedString(markdown:, .inlineOnlyPreservingWhitespace).

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Splits on ``` fences like BodyView.segments. */
function segments(text) {
  const out = [];
  let cur = [];
  let code = false;
  const flush = () => {
    let s = cur.join('\n');
    s = code ? s.replace(/^\n+|\n+$/g, '') : s.trim();
    if (s) out.push({ code, text: s });
    cur = [];
  };
  for (const line of String(text).split('\n')) {
    if (line.trim().startsWith('```')) { flush(); code = !code; continue; }
    cur.push(line);
  }
  flush();
  return out;
}

function inline(src) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = src;
  // `code` first so its contents stay literal.
  s = s.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${escapeHTML(c)}</code>`));
  // [text](url)
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
    const safe = /^(https?:|mailto:)/i.test(u) ? u : null;
    return safe ? keep(`<a href="${escapeHTML(safe)}">${escapeHTML(t)}</a>`) : `[${t}](${u})`;
  });
  s = escapeHTML(s);
  s = s.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

function renderBody(text) {
  return segments(text).map((seg) => (seg.code
    ? `<div class="code"><pre>${escapeHTML(seg.text)}</pre></div>`
    : `<div class="para">${inline(seg.text)}</div>`)).join('');
}

if (typeof module !== 'undefined') module.exports = { renderBody, segments, inline, escapeHTML };
else window.Markdown = { renderBody, escapeHTML };
