// The copilot view. All state lives in the main process; this program renders each state it receives
// and turns clicks and keys into commands.
import { Effect, Stream } from 'effect';
import type { Exchange, CopilotState, Session, SessionSummary, TranscriptLine } from '../../domain';
import type { CopilotBridge, CopilotCommand, CopilotKeys } from '../../ipc';
import { clock, dayLabel, durationLabel, recordedSeconds, timeLabel, transcriptText } from '../../logic';
import { escapeHTML, renderBody } from '../../markdown';
import { ghost } from '../../../../core/renderer/ghost';
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
  follow: byId<HTMLButtonElement>('follow'),
  followIcon: byId('followIcon'),
  bots: byId<HTMLButtonElement>('bots'),
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
  scroll: byId('scroll'),
  stack: byId('stack'),
  sessions: byId('sessions'),
  sessionview: byId('sessionview'),
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
  page: 'chat' as CopilotState['page'],
  drawnSessions: null as ReadonlyArray<SessionSummary> | null,
  drawnSession: null as Session | null,
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
  el.back.title = !s.cardVisible
    ? s.unseenFollow > 0
      ? 'New Follow correction'
      : 'Show answers'
    : s.page === 'session'
      ? 'Back to sessions'
      : s.page === 'sessions'
        ? 'Back to chat'
        : 'Collapse';
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
  // Follow is looking at the screen and conversation right now.
  el.follow.classList.toggle('busy', s.followBusy);
  el.followIcon.className = s.followMode ? 'i-binoculars-fill' : 'i-binoculars';
  el.follow.title = s.followMode ? 'Follow is on (click to stop)' : 'Follow: flag my mistakes automatically';
  el.bots.title = `Bot: ${s.currentProfileName}`;
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

const UNTITLED = 'Untitled session';

/** The recordings, newest first, under the day they were made. Drawn again only when the list changes. */
const renderSessions = (list: ReadonlyArray<SessionSummary>) => {
  if (view.drawnSessions === list) return;
  view.drawnSessions = list;
  if (list.length === 0) {
    el.sessions.innerHTML =
      '<div class="tempty">No recordings yet. Press record and each one shows up here with its transcript.</div>';
    return;
  }
  let html = '';
  let day = '';
  for (const x of list) {
    const d = dayLabel(x.startedAt);
    if (d !== day) {
      day = d;
      html += `<div class="sday">${escapeHTML(d)}</div>`;
    }
    html += `<button class="srow" type="button" data-id="${escapeHTML(x.id)}"><span class="sicon"><i class="i-doc-text"></i></span><span class="stitle${
      x.title ? '' : ' untitled'
    }">${escapeHTML(x.title || UNTITLED)}</span><span class="sdur">${escapeHTML(
      durationLabel(x.seconds),
    )}</span><time>${escapeHTML(timeLabel(x.startedAt))}</time></button>`;
  }
  el.sessions.innerHTML = html;
};

/** One recording: its title, when and how long, and everything said. */
const renderSession = (x: Session | null) => {
  if (view.drawnSession === x) return;
  view.drawnSession = x;
  if (!x) {
    el.sessionview.innerHTML = '';
    return;
  }
  let html = `<h1 class="stitle-big">${escapeHTML(x.title || UNTITLED)}</h1><div class="chips"><span class="chip">${escapeHTML(
    `${dayLabel(x.startedAt)} · ${timeLabel(x.startedAt)}`,
  )}</span><span class="chip">${escapeHTML(durationLabel(x.seconds))}</span></div>`;
  html +=
    '<div class="transcript"><div class="thead"><span class="label">TRANSCRIPT</span><span class="spacer"></span>' +
    '<button class="tcopy" id="scopy" type="button"><i class="i-copy"></i>Copy Transcript</button></div>';
  for (const l of x.lines) html += transcriptRow(clock(l.offset), l.speaker, l.text, true);
  el.sessionview.innerHTML = `${html}</div>`;
};

const renderPage = (s: CopilotState) => {
  // Off the chat, the stack still shows an error, alone: a recording cut short must say so wherever you are.
  el.stack.classList.toggle('only-error', s.page !== 'chat');
  el.stack.hidden = s.page !== 'chat' && s.errorText == null;
  el.sessions.hidden = s.page !== 'sessions';
  el.sessionview.hidden = s.page !== 'session';
  if (s.page === 'sessions') renderSessions(s.sessions);
  renderSession(s.page === 'session' ? s.session : null);
  if (s.page !== view.page) {
    view.page = s.page;
    el.scroll.scrollTop = 0;
  }
};

const renderCard = (s: CopilotState) => {
  renderHero(s);
  renderExchanges(s);
  const last = s.exchanges.at(-1);
  el.thinking.hidden = !(s.isThinking && !last?.answer);
  el.status.textContent = s.status;
  el.error.hidden = s.errorText == null;
  el.error.textContent = s.errorText ?? '';
  renderPage(s);
  el.tbtn.hidden = s.page !== 'chat';
  el.newchat.hidden = s.page !== 'chat' || s.exchanges.length === 0;
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
  el.back.addEventListener('click', () => send({ _tag: 'Collapse' }));
  el.follow.addEventListener('click', () => send({ _tag: 'ToggleFollow' }));
  ghost();
  el.record.addEventListener('click', () => send({ _tag: 'ToggleListening' }));
  el.stop.addEventListener('click', () => send({ _tag: 'ToggleListening' }));
  el.signin.addEventListener('click', () => send({ _tag: 'Login' }));
  el.newchat.addEventListener('click', () => send({ _tag: 'Reset' }));
  el.tbtn.addEventListener('click', () => send({ _tag: 'ShowSessions' }));
  el.sessions.addEventListener('click', (event) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.srow') : null;
    if (row?.dataset.id) send({ _tag: 'OpenSession', id: row.dataset.id });
  });
  el.sessionview.addEventListener('click', (event) => {
    const lines = view.state?.session?.lines;
    if (lines && event.target instanceof Element && event.target.closest('#scopy'))
      send({ _tag: 'Copy', text: transcriptText(lines) });
  });
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

/** Puts the transcripts back on the updates that come without them. Here, where every update passes: the stream
 * after it keeps only the latest. */
const onState = (listener: (state: CopilotState) => void) => {
  let lines: ReadonlyArray<TranscriptLine> = [];
  let session: Session | null = null;
  return bridge.onState((update) => {
    lines = update.lines ?? lines;
    session = update.session === undefined ? session : update.session;
    listener({ ...update, lines, session });
  });
};

runMain(
  Effect.gen(function* () {
    yield* bindInput;
    yield* fromBridge(bridge.onKeys).pipe(Stream.runForEach(renderKeys), Effect.forkChild);
    yield* fromBridge(onState).pipe(Stream.runForEach(render));
  }),
);
