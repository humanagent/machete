// The overlay view. All state lives in the main process; this program renders each state it receives
// and turns clicks and keys into commands.
import { Effect, Stream } from 'effect';
import type { Exchange, OverlayState } from '../../shared/domain';
import type { OverlayBridge, OverlayCommand } from '../../shared/ipc';
import { clock, recordedSeconds, transcriptText } from '../../shared/logic';
import { escapeHTML, renderBody } from '../../shared/markdown';
import { byId, fromBridge, runMain } from '../common/runtime';

declare global {
  interface Window {
    readonly machete: OverlayBridge;
  }
}

const bridge = window.machete;
const send = (command: OverlayCommand) => bridge.send(command);

const BAR = 58;
const PAD = 8;
const CLOSE_MS = 200;

const el = {
  panel: byId('panel'),
  back: byId<HTMLButtonElement>('back'),
  backIcon: byId('backIcon'),
  unseen: byId('unseen'),
  rec: byId('rec'),
  recsep: byId('recsep'),
  recdot: byId('recdot'),
  rectime: byId('rectime'),
  input: byId<HTMLInputElement>('input'),
  go: byId<HTMLButtonElement>('go'),
  follow: byId<HTMLButtonElement>('follow'),
  followIcon: byId('followIcon'),
  bots: byId<HTMLButtonElement>('bots'),
  capture: byId<HTMLButtonElement>('capture'),
  captureIcon: byId('captureIcon'),
  record: byId<HTMLButtonElement>('record'),
  stop: byId<HTMLButtonElement>('stop'),
  bodywrap: byId('bodywrap'),
  card: byId('card'),
  hero: byId('hero'),
  signin: byId<HTMLButtonElement>('signin'),
  signinLogo: byId('signinLogo'),
  signinSpin: byId('signinSpin'),
  signinText: byId('signinText'),
  heroWait: byId('heroWait'),
  exchanges: byId('exchanges'),
  thinking: byId('thinking'),
  status: byId('status'),
  error: byId('error'),
  transcript: byId('transcript'),
  tbtn: byId<HTMLButtonElement>('tbtn'),
  newchat: byId<HTMLButtonElement>('newchat'),
  end: byId('end'),
  grip: byId('grip'),
};

/** What this view remembers between renders (the main process owns everything else). */
const view = {
  state: null as OverlayState | null,
  bodyMounted: false,
  bodyOpen: false,
  bodyWanted: false,
  bodyGen: 0,
  lastQuestion: '',
  lastExchangeCount: 0,
  lastThinking: false,
  lastFocusTick: 0,
  grip: null as { readonly y: number; readonly height: number } | null,
  exchanges: new Map<
    string,
    { readonly root: HTMLElement; readonly answer: HTMLElement; rendered: string | null }
  >(),
};

// MARK: Layout

const bodyHeight = (s: OverlayState) => Math.max(160, s.cardHeight - 66) + 0.5;

const sendLayout = () => {
  const s = view.state;
  if (!s) return;
  send({
    _tag: 'Layout',
    width: s.cardWidth + PAD * 2,
    height: BAR + (view.bodyMounted ? bodyHeight(s) : 0) + PAD * 2,
  });
};

/** Slides the body open or closed; the window only gives the room back once it has closed. */
const setBody = (open: boolean) => {
  const gen = ++view.bodyGen;
  const wrap = el.bodywrap;
  if (open) {
    view.bodyMounted = true;
    wrap.hidden = false;
    wrap.classList.remove('closing');
    sendLayout();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (gen !== view.bodyGen || !view.state) return;
        wrap.classList.add('open');
        view.bodyOpen = true;
        wrap.style.height = `${bodyHeight(view.state)}px`;
      }),
    );
    return;
  }
  wrap.classList.remove('open');
  wrap.classList.add('closing');
  view.bodyOpen = false;
  wrap.style.height = '0px';
  setTimeout(() => {
    if (gen !== view.bodyGen) return;
    view.bodyMounted = false;
    wrap.hidden = true;
    sendLayout();
  }, CLOSE_MS);
};

// MARK: Render

const renderBar = (s: OverlayState) => {
  el.backIcon.className = s.cardVisible ? 'i-arrow-left' : 'i-arrow-down';
  el.back.title = s.cardVisible ? 'Collapse' : s.unseenFollow > 0 ? 'New Follow correction' : 'Show answers';
  el.unseen.hidden = s.cardVisible || s.unseenFollow === 0;

  el.rec.hidden = !s.isListening;
  el.recsep.hidden = !s.isListening;
  el.recdot.classList.toggle('paused', s.isPaused);
  el.rectime.classList.toggle('paused', s.isPaused);
  el.rectime.textContent = clock(recordedSeconds(s, Date.now()));

  el.input.placeholder = s.exchanges.length === 0 ? 'Ask a follow-up about the meeting…' : 'Ask follow-up…';
  // The field mirrors the question: an ask (button, Enter or ⌥↩) clears it even while it has focus.
  if (s.question === '' && view.lastQuestion !== '') el.input.value = '';
  else if (el.input.value !== s.question && document.activeElement !== el.input) el.input.value = s.question;
  view.lastQuestion = s.question;

  el.follow.classList.toggle('active', s.followMode);
  el.followIcon.className = s.followMode ? 'i-binoculars-fill' : 'i-binoculars';
  el.follow.title = s.followMode ? 'Follow is on (click to stop)' : 'Follow: flag my mistakes automatically';
  el.bots.title = `Bot: ${s.currentProfileName}`;
  el.captureIcon.className = s.visibleInCapture ? 'i-eye' : 'i-eye-slash';
  el.capture.title = s.visibleInCapture
    ? 'Visible in screen sharing (click to hide)'
    : 'Hidden from screen sharing (click to show)';
  el.record.hidden = s.isListening;
  el.stop.hidden = !s.isListening;
};

const renderHero = (s: OverlayState) => {
  el.hero.hidden = s.directSignedIn;
  el.signin.disabled = s.signingIn;
  el.signinLogo.hidden = s.signingIn;
  el.signinSpin.hidden = !s.signingIn;
  el.signinText.textContent = s.signingIn ? 'Waiting for browser…' : 'Sign in with ChatGPT';
  el.heroWait.hidden = !s.signingIn;
};

const exchangeNode = (e: Exchange) => {
  const root = document.createElement('div');
  root.className = 'ex';
  if (!e.isFollow) {
    const row = document.createElement('div');
    row.className = 'askrow';
    row.innerHTML = `<div class="bubble">${escapeHTML(e.ask)}</div>`;
    root.appendChild(row);
  }
  const answer = document.createElement('div');
  answer.className = 'answer';
  root.appendChild(answer);
  return { root, answer, rendered: null as string | null };
};

const renderExchanges = (s: OverlayState) => {
  const ids = new Set(s.exchanges.map((e) => e.id));
  for (const [id, node] of view.exchanges) {
    if (!ids.has(id)) {
      node.root.remove();
      view.exchanges.delete(id);
    }
  }
  s.exchanges.forEach((e, i) => {
    let node = view.exchanges.get(e.id);
    if (!node) {
      node = exchangeNode(e);
      view.exchanges.set(e.id, node);
    }
    const at = el.exchanges.children[i] ?? null;
    if (at !== node.root) el.exchanges.insertBefore(node.root, at);
    const key = `${e.answer ?? '\u0000'}|${e.done}`;
    if (node.rendered === key) return;
    node.rendered = key;
    if (e.answer == null) {
      node.answer.innerHTML = '';
      node.answer.hidden = true;
      return;
    }
    node.answer.hidden = false;
    node.answer.innerHTML =
      renderBody(e.answer) +
      (e.done ? '<button class="copy" type="button" title="Copy"><i class="i-copy"></i></button>' : '');
    const answer = e.answer;
    node.answer
      .querySelector<HTMLButtonElement>('.copy')
      ?.addEventListener('click', () => send({ _tag: 'Copy', text: answer }));
  });
};

const transcriptRow = (time: string, speaker: 'me' | 'them', text: string, final: boolean) =>
  `<div class="trow${final ? '' : ' partial'}"><time>${escapeHTML(time)}</time><div><div class="who">${
    speaker === 'me' ? 'ME' : 'THEM'
  }</div><div class="txt">${escapeHTML(text)}</div></div></div>`;

const renderTranscript = (s: OverlayState) => {
  const show = s.showTranscript && !s.isListening;
  el.transcript.hidden = !show;
  if (!show) {
    el.transcript.innerHTML = '';
    return;
  }
  let html = '<div class="thead"><span class="label">TRANSCRIPT</span><span class="spacer"></span>';
  if (s.lines.length > 0) {
    html += '<button class="tcopy" id="tcopy" type="button"><i class="i-copy"></i>Copy Transcript</button>';
  }
  html += '</div>';
  if (s.lines.length === 0 && !s.partialMe && !s.partialThem) {
    html += `<div class="tempty">${
      s.isListening ? "Listening… words show up here as they're recognized." : 'Nothing transcribed yet.'
    }</div>`;
  }
  for (const l of s.lines) html += transcriptRow(clock(l.offset), l.speaker, l.text, true);
  if (s.partialThem) html += transcriptRow('', 'them', s.partialThem, false);
  if (s.partialMe) html += transcriptRow('', 'me', s.partialMe, false);
  el.transcript.innerHTML = html;
  document
    .getElementById('tcopy')
    ?.addEventListener('click', () => send({ _tag: 'Copy', text: transcriptText(s.lines) }));
};

const renderCard = (s: OverlayState) => {
  renderHero(s);
  renderExchanges(s);
  const last = s.exchanges.at(-1);
  el.thinking.hidden = !(s.isThinking && !last?.answer);
  el.status.textContent = s.status;
  el.error.hidden = s.errorText == null;
  el.error.textContent = s.errorText ?? '';
  renderTranscript(s);
  el.tbtn.hidden = !(s.lines.length > 0 && !s.isListening);
  el.tbtn.classList.toggle('on', s.showTranscript);
  el.newchat.hidden = s.exchanges.length === 0;
  // Scroll to the end when an exchange is added or thinking starts or stops.
  if (s.exchanges.length !== view.lastExchangeCount || s.isThinking !== view.lastThinking) {
    view.lastExchangeCount = s.exchanges.length;
    view.lastThinking = s.isThinking;
    requestAnimationFrame(() => el.end.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  }
};

const render = (s: OverlayState) =>
  Effect.sync(() => {
    const first = view.state === null;
    view.state = s;
    if (first) view.lastFocusTick = s.focusInputTick;
    document.documentElement.style.setProperty('--body-alpha', String(0.5 + 0.5 * s.glassOpacity));
    el.panel.style.width = `${s.cardWidth}px`;
    el.card.style.height = `${bodyHeight(s) - 0.5}px`;
    if (view.bodyOpen && !view.grip) el.bodywrap.style.height = `${bodyHeight(s)}px`;
    renderBar(s);
    renderCard(s);
    if (s.cardVisible !== view.bodyWanted) {
      view.bodyWanted = s.cardVisible;
      setBody(s.cardVisible);
    }
    sendLayout();
    if (s.focusInputTick !== view.lastFocusTick) {
      view.lastFocusTick = s.focusInputTick;
      setTimeout(() => el.input.focus(), 0);
    }
  });

// MARK: Input

const askFromInput = () => {
  const question = el.input.value;
  el.input.value = '';
  send({ _tag: 'Ask', question });
};

const bindInput = Effect.sync(() => {
  el.input.addEventListener('input', () => send({ _tag: 'SetQuestion', question: el.input.value }));
  el.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      askFromInput();
    }
  });
  el.go.addEventListener('click', askFromInput);
  el.back.addEventListener('click', () => send({ _tag: 'Collapse' }));
  el.follow.addEventListener('click', () => send({ _tag: 'ToggleFollow' }));
  el.capture.addEventListener('click', () => send({ _tag: 'ToggleCapture' }));
  el.record.addEventListener('click', () => send({ _tag: 'ToggleListening' }));
  el.stop.addEventListener('click', () => send({ _tag: 'ToggleListening' }));
  el.signin.addEventListener('click', () => send({ _tag: 'Login' }));
  el.newchat.addEventListener('click', () => send({ _tag: 'Reset' }));
  el.tbtn.addEventListener('click', () => send({ _tag: 'ToggleTranscript' }));
  el.bots.addEventListener('click', () => {
    const r = el.bots.getBoundingClientRect();
    send({ _tag: 'BotsMenu', x: r.left, y: r.bottom + 4 });
  });

  // Bottom-edge grip: drag to make the panel shorter or taller (it never moves the window).
  el.grip.addEventListener('pointerdown', (event) => {
    if (!view.state) return;
    view.grip = { y: event.screenY, height: view.state.cardHeight };
    el.grip.setPointerCapture(event.pointerId);
    el.bodywrap.classList.remove('open', 'closing');
  });
  el.grip.addEventListener('pointermove', (event) => {
    const s = view.state;
    if (!view.grip || !s) return;
    const height = Math.min(1400, Math.max(220, view.grip.height + (event.screenY - view.grip.y)));
    view.state = { ...s, cardHeight: height };
    el.card.style.height = `${bodyHeight(view.state) - 0.5}px`;
    el.bodywrap.style.height = `${bodyHeight(view.state)}px`;
    sendLayout();
    send({ _tag: 'SetCardHeight', height, persist: false });
  });
  const endGrip = () => {
    if (!view.grip || !view.state) return;
    view.grip = null;
    send({ _tag: 'SetCardHeight', height: view.state.cardHeight, persist: true });
  };
  el.grip.addEventListener('pointerup', endGrip);
  el.grip.addEventListener('pointercancel', endGrip);
});

/** The recording clock ticks here, once a second, without waiting for a new state. */
const tickClock = Effect.sync(() => {
  const s = view.state;
  if (s?.isListening) el.rectime.textContent = clock(recordedSeconds(s, Date.now()));
}).pipe(Effect.andThen(Effect.sleep('1 second')), Effect.forever);

runMain(
  Effect.gen(function* () {
    yield* bindInput;
    yield* Effect.forkChild(tickClock);
    yield* fromBridge(bridge.onState).pipe(Stream.runForEach(render));
  }),
);
