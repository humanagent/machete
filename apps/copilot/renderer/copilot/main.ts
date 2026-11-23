// The copilot view. All state lives in the main process; this program renders each state it receives
// and turns clicks and keys into commands.
import { Effect, Stream } from 'effect';
import type { Exchange, CopilotState, TranscriptLine } from '../../domain';
import type { CopilotBridge, CopilotCommand, CopilotKeys } from '../../ipc';
import { clock, recordedSeconds, transcriptText } from '../../logic';
import { escapeHTML, renderBody } from '../../markdown';
import { byId, fromBridge, runMain } from '../../../../core/renderer/runtime';

declare global {
  interface Window {
    readonly machete: CopilotBridge;
  }
}

const bridge = window.machete;
const send = (command: CopilotCommand) => bridge.send(command);

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
  newkeys: byId('newkeys'),
  end: byId('end'),
  grip: byId('grip'),
};

/** What this view remembers between renders (the main process owns everything else). */
const view = {
  state: null as CopilotState | null,
  bodyMounted: false,
  bodyOpen: false,
  bodyWanted: false,
  bodyGen: 0,
  lastQuestion: '',
  lastExchange: undefined as string | undefined,
  clock: 0,
  transcript: null as Pick<CopilotState, 'lines' | 'partialMe' | 'partialThem' | 'isListening'> | null,
  lastThinking: false,
  lastFocusTick: 0,
  grip: null as { readonly y: number; readonly height: number } | null,
  exchanges: new Map<
    string,
    { readonly root: HTMLElement; readonly answer: HTMLElement; rendered: string | null }
  >(),
};

// MARK: Layout

const bodyHeight = (s: CopilotState) => Math.max(160, s.cardHeight - 66) + 0.5;

const sendLayout = () => {
  const s = view.state;
  if (!s) return;
  const width = s.cardWidth + PAD * 2;
  const height = BAR + (view.bodyMounted ? bodyHeight(s) : 0) + PAD * 2;
  send({ _tag: 'Layout', width, height });
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

/** The recording clock ticks here, once a second and only while it runs, without waiting for a new state. */
const tickWhile = (running: boolean) => {
  if (!running) {
    clearInterval(view.clock);
    view.clock = 0;
  } else if (view.clock === 0) {
    view.clock = window.setInterval(() => {
      if (view.state) el.rectime.textContent = clock(recordedSeconds(view.state, Date.now()));
    }, 1000);
  }
};

const renderBar = (s: CopilotState) => {
  el.backIcon.className = s.cardVisible ? 'i-arrow-left' : 'i-arrow-down';
  el.back.title = s.cardVisible ? 'Collapse' : s.unseenFollow > 0 ? 'New Follow correction' : 'Show answers';
  el.unseen.hidden = s.cardVisible || s.unseenFollow === 0;

  el.rec.hidden = !s.isListening;
  el.recsep.hidden = !s.isListening;
  el.recdot.classList.toggle('paused', s.isPaused);
  el.rectime.classList.toggle('paused', s.isPaused);
  el.rectime.textContent = clock(recordedSeconds(s, Date.now()));
  tickWhile(s.isListening && !s.isPaused);

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

const renderHero = (s: CopilotState) => {
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

const renderExchanges = (s: CopilotState) => {
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

const renderTranscript = (s: CopilotState) => {
  const show = s.showTranscript && !s.isListening;
  el.transcript.hidden = !show;
  if (!show) {
    if (view.transcript) el.transcript.innerHTML = '';
    view.transcript = null;
    return;
  }
  const drawn = view.transcript;
  if (
    drawn &&
    drawn.lines === s.lines &&
    drawn.partialMe === s.partialMe &&
    drawn.partialThem === s.partialThem &&
    drawn.isListening === s.isListening
  )
    return;
  view.transcript = {
    lines: s.lines,
    partialMe: s.partialMe,
    partialThem: s.partialThem,
    isListening: s.isListening,
  };
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

const renderCard = (s: CopilotState) => {
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
  if (last?.id !== view.lastExchange || s.isThinking !== view.lastThinking) {
    view.lastExchange = last?.id;
    view.lastThinking = s.isThinking;
    requestAnimationFrame(() => el.end.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  }
};

const render = (s: CopilotState) =>
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

  // Press anywhere and move: the whole panel follows, even from a button. A press that doesn't move
  // stays a click. The text field (selecting text) and the grip (resizing) keep their own behaviour.
  const DRAG_THRESHOLD = 4;
  let press: { x: number; y: number; id: number; target: Element; moving: boolean } | null = null;
  let swallowClick = false;
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest('input, textarea, #grip')) return;
      press = {
        x: event.screenX,
        y: event.screenY,
        id: event.pointerId,
        target: event.target,
        moving: false,
      };
    },
    true,
  );
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!press || event.pointerId !== press.id) return;
      const dx = event.screenX - press.x;
      const dy = event.screenY - press.y;
      if (!press.moving) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        press.moving = true;
        press.target.setPointerCapture?.(event.pointerId);
        document.body.classList.add('dragging');
        send({ _tag: 'DragStart' });
      }
      event.preventDefault();
      send({ _tag: 'DragMove', dx, dy });
    },
    true,
  );
  const endPress = () => {
    if (press?.moving) {
      swallowClick = true;
      document.body.classList.remove('dragging');
      // The click that ends a drag is not a click; any later one is.
      setTimeout(() => (swallowClick = false), 0);
    }
    press = null;
  };
  document.addEventListener('pointerup', endPress, true);
  document.addEventListener('pointercancel', endPress, true);
  window.addEventListener(
    'click',
    (event) => {
      if (!swallowClick) return;
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );
});

/** The shortcuts on the buttons, as they are in Settings. */
const renderKeys = (k: CopilotKeys) =>
  Effect.sync(() => {
    el.go.textContent = k.ask === '' ? 'Ask' : [...k.ask].join(' ');
    const withKeys = (text: string, keys: string) => (keys === '' ? text : `${text} (${keys})`);
    el.record.title = withKeys('Record', k.listen);
    el.stop.title = withKeys('Stop recording', k.listen);
    el.newkeys.replaceChildren(
      ...[...k.reset].map((sign) => {
        const key = document.createElement('span');
        key.className = 'key';
        key.textContent = sign;
        return key;
      }),
    );
  });

/** Puts the transcript back on the updates that come without it. Here, where every update passes: the stream after it
 * keeps only the latest. */
const onState = (listener: (state: CopilotState) => void) => {
  let lines: ReadonlyArray<TranscriptLine> = [];
  return bridge.onState((update) => {
    lines = update.lines ?? lines;
    listener({ ...update, lines });
  });
};

runMain(
  Effect.gen(function* () {
    yield* bindInput;
    yield* fromBridge(bridge.onKeys).pipe(Stream.runForEach(renderKeys), Effect.forkChild);
    yield* fromBridge(onState).pipe(Stream.runForEach(render));
  }),
);
