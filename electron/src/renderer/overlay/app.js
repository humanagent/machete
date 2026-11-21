'use strict';
/* global Markdown */
// OverlayView.swift as a plain DOM view. All state lives in the main process; this renders snapshots.
const api = window.machete;
const $ = (id) => document.getElementById(id);
const esc = Markdown.escapeHTML;

const BAR = 58;
const PAD = 8;

let s = null;                 // latest snapshot
let bodyMounted = false;      // window keeps room for the body
let bodyOpen = false;         // body drawn at full height (animated)
let bodyGen = 0;
let lastExchangeCount = 0;
let lastThinking = false;
let lastFocusTick = 0;
let gripDrag = null;
const exNodes = new Map();    // exchange id -> { root, answerEl, rendered, done }

const clock = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

function recordedSeconds(now = Date.now()) {
  if (!s) return 0;
  const current = (s.isPaused || s.listenStart == null) ? 0 : (now - s.listenStart) / 1000;
  return Math.max(0, Math.floor(s.recordedBefore + current));
}

// MARK: Layout

function bodyHeight() { return Math.max(160, s.cardHeight - 66) + 0.5; }

function sendLayout() {
  if (!s) return;
  const h = BAR + (bodyMounted ? bodyHeight() : 0) + PAD * 2;
  api.layout(s.cardWidth + PAD * 2, h);
}

function setBody(open) {
  bodyGen += 1;
  const gen = bodyGen;
  const wrap = $('bodywrap');
  if (open) {
    bodyMounted = true;
    wrap.hidden = false;
    wrap.classList.remove('closing');
    sendLayout();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (gen !== bodyGen) return;
      wrap.classList.add('open');
      bodyOpen = true;
      wrap.style.height = `${bodyHeight()}px`;
    }));
  } else {
    wrap.classList.remove('open');
    wrap.classList.add('closing');
    bodyOpen = false;
    wrap.style.height = '0px';
    // Give the room back only after the body has slid closed.
    setTimeout(() => {
      if (gen !== bodyGen) return;
      bodyMounted = false;
      wrap.hidden = true;
      sendLayout();
    }, 200);
  }
}

// MARK: Render

function renderBar() {
  const cardVisible = s.cardVisible;
  $('backIcon').className = cardVisible ? 'i-arrow-left' : 'i-arrow-down';
  $('back').title = cardVisible ? 'Collapse' : (s.unseenFollow > 0 ? 'New Follow correction' : 'Show answers');
  $('unseen').hidden = !(!cardVisible && s.unseenFollow > 0);

  $('rec').hidden = !s.isListening;
  $('recsep').hidden = !s.isListening;
  $('recdot').classList.toggle('paused', !!s.isPaused);
  $('rectime').classList.toggle('paused', !!s.isPaused);
  $('rectime').textContent = clock(recordedSeconds());

  const input = $('input');
  input.placeholder = s.exchanges.length === 0 ? 'Ask a follow-up about the meeting…' : 'Ask follow-up…';
  if (input.value !== s.question && document.activeElement !== input) input.value = s.question;
  if (s.question === '' && input.value !== '' && pendingAskClear) { input.value = ''; pendingAskClear = false; }

  $('follow').classList.toggle('active', s.followMode);
  $('followIcon').className = s.followMode ? 'i-binoculars-fill' : 'i-binoculars';
  $('follow').title = s.followMode ? 'Follow is on (click to stop)' : 'Follow: flag my mistakes automatically';
  $('bots').title = `Bot: ${s.currentProfileName}`;
  $('captureIcon').className = s.visibleInCapture ? 'i-eye' : 'i-eye-slash';
  $('capture').title = s.visibleInCapture ? 'Visible in screen sharing (click to hide)' : 'Hidden from screen sharing (click to show)';
  $('record').hidden = s.isListening;
  $('stop').hidden = !s.isListening;
}

function renderHero() {
  $('hero').hidden = s.directSignedIn;
  $('signin').disabled = s.signingIn;
  $('signinLogo').hidden = s.signingIn;
  $('signinSpin').hidden = !s.signingIn;
  $('signinText').textContent = s.signingIn ? 'Waiting for browser…' : 'Sign in with ChatGPT';
  $('heroWait').hidden = !s.signingIn;
}

function exchangeNode(e) {
  const root = document.createElement('div');
  root.className = 'ex';
  if (!e.isFollow) {
    const row = document.createElement('div');
    row.className = 'askrow';
    row.innerHTML = `<div class="bubble">${esc(e.ask)}</div>`;
    root.appendChild(row);
  }
  const answerEl = document.createElement('div');
  answerEl.className = 'answer';
  root.appendChild(answerEl);
  return { root, answerEl, rendered: null, done: false };
}

function renderExchanges() {
  const list = $('exchanges');
  const ids = new Set(s.exchanges.map((e) => e.id));
  for (const [id, n] of exNodes) if (!ids.has(id)) { n.root.remove(); exNodes.delete(id); }
  s.exchanges.forEach((e, i) => {
    let n = exNodes.get(e.id);
    if (!n) { n = exchangeNode(e); exNodes.set(e.id, n); }
    if (list.children[i] !== n.root) list.insertBefore(n.root, list.children[i] || null);
    const key = `${e.answer ?? '\u0000'}|${e.done}`;
    if (n.rendered !== key) {
      n.rendered = key;
      if (e.answer == null) { n.answerEl.innerHTML = ''; n.answerEl.hidden = true; }
      else {
        n.answerEl.hidden = false;
        n.answerEl.innerHTML = Markdown.renderBody(e.answer)
          + (e.done ? '<button class="copy" type="button" title="Copy"><i class="i-copy"></i></button>' : '');
        const copy = n.answerEl.querySelector('.copy');
        if (copy) copy.onclick = () => api.copy(e.answer);
      }
    }
  });
}

function transcriptRow(time, speaker, text, final) {
  return `<div class="trow${final ? '' : ' partial'}"><time>${esc(time)}</time><div><div class="who">${speaker === 'me' ? 'ME' : 'THEM'}</div>`
    + `<div class="txt">${esc(text)}</div></div></div>`;
}

function renderTranscript() {
  const show = s.showTranscript && !s.isListening;
  const el = $('transcript');
  el.hidden = !show;
  if (!show) { el.innerHTML = ''; return; }
  let html = '<div class="thead"><span class="label">TRANSCRIPT</span><span class="spacer"></span>';
  if (s.lines.length) html += '<button class="tcopy" id="tcopy" type="button"><i class="i-copy"></i>Copy Transcript</button>';
  html += '</div>';
  if (s.lines.length === 0 && !s.partialMe && !s.partialThem) {
    html += `<div class="tempty">${s.isListening ? 'Listening… words show up here as they\'re recognized.' : 'Nothing transcribed yet.'}</div>`;
  }
  for (const l of s.lines) html += transcriptRow(clock(l.offset), l.speaker, l.text, true);
  for (const [sp, t] of [['them', s.partialThem], ['me', s.partialMe]]) if (t) html += transcriptRow('', sp, t, false);
  el.innerHTML = html;
  const c = $('tcopy');
  if (c) c.onclick = () => api.copy(s.lines.map((l) => `${clock(l.offset)} ${l.speaker === 'me' ? 'Me' : 'Them'}: ${l.text}`).join('\n'));
}

function renderCard() {
  renderHero();
  renderExchanges();
  const last = s.exchanges[s.exchanges.length - 1];
  $('thinking').hidden = !(s.isThinking && !(last?.answer ?? ''));
  $('status').textContent = s.status;
  $('error').hidden = s.errorText == null;
  $('error').textContent = s.errorText ?? '';
  renderTranscript();
  $('tbtn').hidden = !(s.lines.length > 0 && !s.isListening);
  $('tbtn').classList.toggle('on', s.showTranscript);
  $('newchat').hidden = s.exchanges.length === 0;

  // Scroll to the end when an exchange is added or thinking starts/stops.
  if (s.exchanges.length !== lastExchangeCount || s.isThinking !== lastThinking) {
    lastExchangeCount = s.exchanges.length;
    lastThinking = s.isThinking;
    requestAnimationFrame(() => $('end').scrollIntoView({ behavior: 'smooth', block: 'end' }));
  }
}

function render() {
  document.documentElement.style.setProperty('--body-alpha', String(0.5 + 0.5 * s.glassOpacity));
  $('panel').style.width = `${s.cardWidth}px`;
  $('card').style.height = `${bodyHeight() - 0.5}px`;
  if (bodyOpen && !gripDrag) $('bodywrap').style.height = `${bodyHeight()}px`;
  renderBar();
  renderCard();
  if (s.cardVisible !== bodyMounted && (s.cardVisible || bodyOpen)) setBody(s.cardVisible);
  sendLayout();
  if (s.focusInputTick !== lastFocusTick) {
    lastFocusTick = s.focusInputTick;
    setTimeout(() => $('input').focus(), 0);
  }
}

api.onState((snap) => {
  const first = s == null;
  s = snap;
  if (first) {
    lastFocusTick = s.focusInputTick;
    bodyMounted = false;
  }
  render();
});

// Recording clock ticks locally (TimelineView(.periodic(by: 1))).
setInterval(() => { if (s?.isListening) $('rectime').textContent = clock(recordedSeconds()); }, 1000);

// MARK: Actions

let pendingAskClear = false;
const input = $('input');
input.addEventListener('input', () => api.setQuestion(input.value));
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    const q = input.value;
    input.value = '';
    pendingAskClear = true;
    api.ask(q);
  }
});
$('go').onclick = () => { const q = input.value; input.value = ''; api.ask(q); };
$('back').onclick = () => api.collapse();
$('follow').onclick = () => api.toggleFollow();
$('capture').onclick = () => api.toggleCapture();
$('record').onclick = () => api.toggleListening();
$('stop').onclick = () => api.toggleListening();
$('signin').onclick = () => api.login();
$('newchat').onclick = () => api.reset();
$('tbtn').onclick = () => api.toggleTranscript();
$('bots').onclick = () => {
  const r = $('bots').getBoundingClientRect();
  api.botsMenu(r.left, r.bottom + 4);
};

// Bottom-edge grip: drag to make the panel shorter or taller (never moves the window).
$('grip').addEventListener('pointerdown', (e) => {
  gripDrag = { y: e.screenY, h: s.cardHeight };
  $('grip').setPointerCapture(e.pointerId);
  $('bodywrap').classList.remove('open', 'closing');
});
$('grip').addEventListener('pointermove', (e) => {
  if (!gripDrag) return;
  const h = Math.min(1400, Math.max(220, gripDrag.h + (e.screenY - gripDrag.y)));
  s.cardHeight = h;
  $('card').style.height = `${bodyHeight() - 0.5}px`;
  $('bodywrap').style.height = `${bodyHeight()}px`;
  sendLayout();
  api.setCardHeight(h, false);
});
const endGrip = () => { if (!gripDrag) return; gripDrag = null; api.setCardHeight(s.cardHeight, true); };
$('grip').addEventListener('pointerup', endGrip);
$('grip').addEventListener('pointercancel', endGrip);
