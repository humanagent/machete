'use strict';
// The dictation pill: where the words will go, and dots that follow your voice. Click for Finish / Cancel.
const $ = (id) => document.getElementById(id);
const N = 26;
const dots = [];
for (let i = 0; i < N; i++) { const s = document.createElement('span'); $('wave').appendChild(s); dots.push(s); }
const levels = new Array(N).fill(0);

function draw() { dots.forEach((d, i) => { d.style.height = (4 + Math.round(levels[i] * 14)) + 'px'; }); }

window.dictation.on('show', ({ app, icon }) => {
  $('app').textContent = app || 'Dictation';
  $('icon').hidden = !icon; if (icon) $('icon').src = icon;
  $('wave').hidden = false; $('status').hidden = true; $('status').className = 'status';
  levels.fill(0); draw();
});
window.dictation.on('level', (l) => { levels.shift(); levels.push(Math.min(1, l)); draw(); });
window.dictation.on('finishing', () => { $('wave').hidden = true; $('status').hidden = false; $('status').textContent = 'Transcribing…'; });
window.dictation.on('error', (m) => { $('wave').hidden = true; $('status').hidden = false; $('status').className = 'status err'; $('status').textContent = m; });
$('pill').addEventListener('mousedown', () => window.dictation.menu());
