// Answer text to HTML: paragraphs with inline markdown, fenced code blocks as code. Escapes everything else.

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHTML = (s: string): string => s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

export interface Segment {
  readonly code: boolean;
  readonly text: string;
}

/** Splits on ``` fences. */
export const segments = (text: string): ReadonlyArray<Segment> => {
  const out: Array<Segment> = [];
  let current: Array<string> = [];
  let code = false;
  const flush = () => {
    const joined = current.join('\n');
    const s = code ? joined.replace(/^\n+|\n+$/g, '') : joined.trim();
    if (s) out.push({ code, text: s });
    current = [];
  };
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) {
      flush();
      code = !code;
      continue;
    }
    current.push(line);
  }
  flush();
  return out;
};

/** Inline markdown: `code`, [links](https://…), **bold**, *italic*, ~~strike~~. */
export const inline = (src: string): string => {
  const slots: Array<string> = [];
  const keep = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = src.replace(/`([^`\n]+)`/g, (_, c: string) => keep(`<code>${escapeHTML(c)}</code>`));
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, t: string, u: string) =>
    /^(https?:|mailto:)/i.test(u) ? keep(`<a href="${escapeHTML(u)}">${escapeHTML(t)}</a>`) : whole,
  );
  s = escapeHTML(s)
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => slots[Number(i)] ?? '');
};

export const renderBody = (text: string): string =>
  segments(text)
    .map((seg) =>
      seg.code
        ? `<div class="code"><pre>${escapeHTML(seg.text)}</pre></div>`
        : `<div class="para">${inline(seg.text)}</div>`,
    )
    .join('');
