'use strict';
// AppState.swift, ported. Owns everything the overlay shows; the renderer is a pure view of snapshot().
const fs = require('fs');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const S = require('../shared/strings');
const L = require('../shared/logic');
const settings = require('./settings');
const profileStore = require('./profiles');
const auth = require('./auth');
const responses = require('./responses');
const codex = require('./codex');
const native = require('./native');
const log = require('./log');

const LANGUAGES = [['en-US', 'English'], ['es-ES', 'Español']];
const PRESETS = ['whatToSay', 'followUps', 'recap'];
const CAPTURE_MSG = 'Screen capture timed out. Grant Screen Recording to Machete in System Settings ▸ Privacy & Security, then reopen the app.';

class Cancelled extends Error { constructor() { super('cancelled'); this.cancelled = true; } }

/** Runs `promise`, failing with `message` if it takes longer than `seconds`. */
function withTimeout(seconds, message, promise, onTimeout) {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => { onTimeout?.(); reject(new Error(message)); }, seconds * 1000);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

class AppState extends EventEmitter {
  constructor() {
    super();
    this.question = '';
    this.exchanges = [];
    this.isThinking = false;
    this.errorText = null;
    this.isListening = false;
    this.showTranscript = false;
    this.lines = [];
    this.partialMe = '';
    this.partialThem = '';
    this.cardOpen = false;
    this.collapsed = false;
    this.listenStart = null;     // ms, start of the current (unpaused) segment
    this.isPaused = false;
    this.recordedBefore = 0;     // seconds
    this.status = 'Thinking…';
    this.loggedIn = null;
    this.signingIn = false;
    this.glassOpacity = settings.get('glassOpacity');
    this.language = settings.get('language');
    this.directSignedIn = false;
    this.model = settings.get('model');
    this.models = [{ slug: 'gpt-6.2-sol', name: 'GPT-6.2-Sol' }, { slug: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' }, { slug: 'gpt-6-luna', name: 'GPT-6-Luna' }];
    this.visibleInCapture = settings.get('visibleInCapture');
    this.cardWidth = settings.get('cardWidth');
    this.cardHeight = settings.get('cardHeight');
    this.autoAnswer = settings.get('autoAnswer');
    this.followMode = false;
    this.followBusy = false;
    this.unseenFollow = 0;
    this.profiles = profileStore.load();
    this.selectedProfileID = settings.get('profileID') || crypto.randomUUID().toUpperCase();
    this.focusInputTick = 0;

    this._askGen = 0;
    this._abort = null;
    this._autoTimer = null;
    this._followTimer = null;
    this._lastFingerprint = [];
    this._lastFollowAt = 0;
    this._lastFollowLineCount = 0;
    this._pending = false;

    native.on('partial', (m) => {
      if (m.speaker === 'me') this.partialMe = m.text; else this.partialThem = m.text;
      this.changed();
    });
    native.on('commit', (m) => this.onCommit(m.speaker, m.text));
    native.on('error', (m) => { this.errorText = m.message; this.changed(); });
  }

  // MARK: plumbing

  changed() {
    if (this._pending) return;
    this._pending = true;
    setImmediate(() => { this._pending = false; this.emit('change'); });
  }

  showPanel() { this.emit('showPanel'); }

  get currentProfile() { return this.profiles.find((p) => p.id === this.selectedProfileID) || this.profiles[0]; }
  get systemPrompt() { return L.systemPrompt(this.currentProfile); }

  /** True when the answer card below the bar shows (OverlayView.cardVisible). */
  get cardVisible() {
    if (this.collapsed) return false;
    return this.cardOpen || this.loggedIn === false || this.isThinking || this.exchanges.length > 0
      || this.errorText != null || (this.showTranscript && !this.isListening);
  }

  recordedSeconds(now = Date.now()) {
    const current = (this.isPaused || this.listenStart == null) ? 0 : (now - this.listenStart) / 1000;
    return Math.max(0, Math.floor(this.recordedBefore + current));
  }

  snapshot() {
    return {
      question: this.question, exchanges: this.exchanges, isThinking: this.isThinking, errorText: this.errorText,
      isListening: this.isListening, showTranscript: this.showTranscript, lines: this.lines,
      partialMe: this.partialMe, partialThem: this.partialThem, cardOpen: this.cardOpen, collapsed: this.collapsed,
      listenStart: this.listenStart, isPaused: this.isPaused, recordedBefore: this.recordedBefore,
      status: this.status, loggedIn: this.loggedIn, signingIn: this.signingIn, glassOpacity: this.glassOpacity,
      directSignedIn: this.directSignedIn, visibleInCapture: this.visibleInCapture,
      cardWidth: this.cardWidth, cardHeight: this.cardHeight, followMode: this.followMode, followBusy: this.followBusy,
      unseenFollow: this.unseenFollow, currentProfileName: this.currentProfile.name, focusInputTick: this.focusInputTick,
      cardVisible: this.cardVisible,
    };
  }

  // MARK: Ask

  setQuestion(q) { this.question = String(q ?? ''); }

  ask(presetKey = null, { automatic = false } = {}) {
    if (automatic && this.loggedIn === false) return;
    if (this.loggedIn === false) {
      this.showPanel(); this.cardOpen = true; this.collapsed = false;
      this.errorText = 'Sign in with ChatGPT first.';
      this.changed();
      return;
    }
    const preset = presetKey ? S.presets[presetKey] : null;
    const typed = preset ? preset.instruction : this.question.trim();
    if (!preset) this.question = '';
    this.run({ label: preset ? preset.label : (typed === '' ? 'Assist' : typed), instruction: typed,
      isPreset: !!preset, isFollow: false, reveal: !automatic });
  }

  /** Shared request path. Follow-mode requests are quiet: no streaming, dropped if there's nothing new. */
  run({ label, instruction, isPreset, isFollow, reveal = true }) {
    const quiet = isFollow || !reveal;
    if (!quiet) { this.showPanel(); this.cardOpen = true; this.collapsed = false; }
    this.cancelAsk();
    codex.cancel();
    this.errorText = null;
    this.isThinking = !isFollow;
    this.followBusy = isFollow;
    this.status = 'Capturing screen…';

    const prompt = L.buildPrompt(instruction, { lines: this.lines, partialMe: this.partialMe, partialThem: this.partialThem,
      exchanges: this.exchanges, context: this.currentProfile.context });
    const ex = { id: crypto.randomUUID(), ask: label, typed: instruction, isPreset, isFollow, answer: null, done: false };
    this.exchanges.push(ex);
    const instructions = this.systemPrompt;
    const gen = ++this._askGen;
    const abort = new AbortController();
    this._abort = abort;
    const cancelled = () => gen !== this._askGen;
    const find = () => this.exchanges.find((e) => e.id === ex.id);
    this.changed();

    (async () => {
      let skipCleanup = false;
      try {
        let answer;
        if (this.directSignedIn) {
          const image = await withTimeout(15, CAPTURE_MSG, native.captureDataURL());
          if (cancelled()) { skipCleanup = true; return; }
          this.status = 'Asking ChatGPT…'; this.changed();
          answer = await withTimeout(120, 'ChatGPT took too long to answer. Try again.', responses.ask({
            model: this.model, instructions, text: prompt, imageDataURL: image, effort: 'low', signal: abort.signal,
            onText: (partial) => {
              if (isFollow || cancelled()) return;
              const e = find(); if (e) { e.answer = partial; this.changed(); }
            },
          }), () => abort.abort());
        } else {
          const image = await withTimeout(15, CAPTURE_MSG, native.capturePNG());
          if (cancelled()) { skipCleanup = true; return; }
          this.status = 'Asking ChatGPT (via Codex)…'; this.changed();
          try {
            answer = await withTimeout(150, 'ChatGPT took too long to answer. Try again.',
              codex.run(instructions + '\n\n' + prompt, image), () => codex.cancel());
          } finally { fs.rm(image, () => {}); }
        }
        if (cancelled()) { skipCleanup = true; return; }
        const trimmed = answer.trim();
        const e = find();
        if (e) {
          if (isFollow && (trimmed === '' || L.isSilent(trimmed))) {
            this.exchanges = this.exchanges.filter((x) => x.id !== ex.id); // SILENT: no mistake, show nothing
            log.write('follow: silent');
          } else {
            e.answer = answer;
            // Follow never pops the panel open; it only flags that something new arrived.
            if (quiet && this.collapsed) this.unseenFollow += 1;
          }
        }
      } catch (err) {
        if (cancelled()) { skipCleanup = true; return; }
        if (!(err?.cancelled || err?.name === 'AbortError')) {
          this.errorText = err.message;
          if (isFollow) this.setFollow(false); // don't keep hammering on errors / usage limits
          if (err instanceof auth.SIWCError && err.needsSignIn) { this.directSignedIn = false; this.refreshLoggedIn(); }
          if (String(err.message).includes('sign-in')) this.loggedIn = false;
        }
      } finally {
        if (!skipCleanup && !cancelled()) {
          this.isThinking = false;
          this.followBusy = false;
          const e = find();
          if (e) e.done = true;
          this.exchanges = this.exchanges.filter((x) => !(x.id === ex.id && !(x.answer ?? '')));
          this.changed();
        }
      }
    })();
  }

  cancelAsk() {
    this._askGen++;
    this._abort?.abort();
    this._abort = null;
  }

  reset() {
    this.cancelAsk();
    this.followBusy = false;
    codex.cancel();
    this.isThinking = false;
    this.exchanges = [];
    this.errorText = null;
    this.cardOpen = false;
    this.collapsed = false;
    this.lines = [];
    this.partialMe = '';
    this.partialThem = '';
    this.changed();
  }

  // MARK: Bots (profiles)

  selectProfile(id) { this.selectedProfileID = id; settings.set('profileID', id); this.changed(); this.emit('profiles'); }
  saveProfiles() { profileStore.save(this.profiles); this.changed(); this.emit('profiles'); }

  addProfile() {
    const p = { id: profileStore.newID(), name: 'New bot', instructions: S.newBotInstructions, context: '' };
    this.profiles.push(p);
    this.saveProfiles();
    return p.id;
  }

  deleteProfile(id) {
    if (this.profiles.length <= 1) return;
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.selectedProfileID === id) this.selectProfile(this.profiles[0].id);
    this.saveProfiles();
  }

  updateProfile(id, fields) {
    const p = this.profiles.find((x) => x.id === id);
    if (!p) return;
    for (const k of ['name', 'instructions', 'context']) if (typeof fields[k] === 'string') p[k] = fields[k];
    this.saveProfiles();
  }

  // MARK: Follow mode

  toggleFollow() { this.setFollow(!this.followMode); }

  setFollow(on) {
    this.followMode = on;
    clearTimeout(this._followTimer);
    this._followTimer = null;
    this.changed();
    if (!on) return;
    if (this.loggedIn === false) { this.followMode = false; this.errorText = 'Sign in with ChatGPT first.'; this.changed(); return; }
    this._lastFingerprint = [];
    this._lastFollowAt = 0;
    if (!this.isListening) this.startListening(); // Follow listens to the conversation too
    const loop = async () => {
      if (!this.followMode) return;
      await this.followTick();
      if (this.followMode) this._followTimer = setTimeout(loop, 3000);
    };
    loop();
  }

  /** Every few seconds: if the screen changed noticeably or new speech arrived, ask for suggestions. */
  async followTick() {
    if (!this.followMode || this.isThinking || this.followBusy) return;
    if (Date.now() - this._lastFollowAt < 20_000) return;
    let fp;
    try { fp = await native.fingerprint(); } catch { return; }
    const screenChanged = this._lastFingerprint.length === 0 || L.fingerprintDifference(fp, this._lastFingerprint) > 12;
    const newSpeech = this.lines.length > this._lastFollowLineCount;
    if (!(screenChanged || newSpeech) || !this.followMode || this.isThinking) return;
    this._lastFingerprint = fp;
    this._lastFollowLineCount = this.lines.length;
    this._lastFollowAt = Date.now();
    log.write(`follow: tick screenChanged=${screenChanged} newSpeech=${newSpeech}`);
    this.run({ label: 'Follow', instruction: S.followInstruction, isPreset: false, isFollow: true, reveal: false });
  }

  // MARK: Listening

  toggleListening() { this.isListening ? this.stopListening() : this.startListening(); }

  startListening() {
    this.errorText = null;
    this.isListening = true;
    this.isPaused = false;
    this.recordedBefore = 0;
    this.listenStart = Date.now();
    this.showTranscript = false;
    this.changed();
    this.emit('menu');
    native.startListening(this.language).catch((e) => {
      this.errorText = e.message;
      this.stopListening();
    });
  }

  onCommit(speaker, text) {
    this.lines.push({ id: crypto.randomUUID(), speaker, text, offset: this.recordedSeconds() });
    log.write(`transcript: +1 line (${L.speakerLabel(speaker)}), ${this.lines.length} total`);
    if (this.lines.length > 400) this.lines.splice(0, this.lines.length - 400);
    if (speaker === 'them') this.scheduleAutoAnswer();
    else clearTimeout(this._autoTimer); // I started talking: don't interrupt
    this.changed();
  }

  togglePause() {
    if (!this.isListening) return;
    if (this.isPaused) { this.listenStart = Date.now(); this.isPaused = false; }
    else {
      this.recordedBefore += (Date.now() - (this.listenStart ?? Date.now())) / 1000;
      this.isPaused = true;
      clearTimeout(this._autoTimer);
    }
    native.setPaused(this.isPaused);
    this.changed();
  }

  /** When the other side finishes a question, prepare what to say. */
  scheduleAutoAnswer() {
    clearTimeout(this._autoTimer);
    if (!this.autoAnswer) return;
    // Wait for them to finish (multi-sentence questions arrive as several lines).
    this._autoTimer = setTimeout(() => {
      if (this.isThinking || this.partialThem !== '') return;
      const recent = this.lines.slice(-3).filter((l) => l.speaker === 'them').map((l) => l.text).join(' ');
      if (!L.looksLikeQuestion(recent)) return;
      this.ask('whatToSay', { automatic: true });
    }, 1200);
  }

  stopListening() {
    const wasListening = this.isListening;
    clearTimeout(this._autoTimer);
    this.listenStart = null;
    this.isPaused = false;
    this.recordedBefore = 0;
    if (wasListening) native.stopListening().then(() => log.write(`listen: stopped, ${this.lines.length} lines total`));
    this.isListening = false;
    this.partialMe = '';
    this.partialThem = '';
    if (wasListening) {
      // Show the full transcript once recording stops (final words may still arrive for a moment).
      this.showTranscript = true;
      this.cardOpen = true;
      this.collapsed = false;
      this.showPanel();
    }
    this.changed();
    this.emit('menu');
  }

  setLanguage(code) {
    this.language = code;
    settings.set('language', code);
    if (this.isListening) { this.stopListening(); this.startListening(); }
    this.emit('menu');
  }

  // MARK: Settings

  setAutoAnswer(on) { this.autoAnswer = on; settings.set('autoAnswer', on); this.emit('menu'); }
  setModel(slug) { this.model = slug; settings.set('model', slug); this.emit('menu'); }
  setGlassOpacity(v) { this.glassOpacity = v; settings.set('glassOpacity', v); this.changed(); this.emit('menu'); }

  toggleCaptureVisibility() {
    this.visibleInCapture = !this.visibleInCapture;
    settings.set('visibleInCapture', this.visibleInCapture);
    this.emit('captureVisibility', this.visibleInCapture);
    this.changed();
  }

  setCardSize(width, height, persist) {
    this.cardWidth = Math.max(480, width);
    this.cardHeight = Math.max(300, height);
    if (persist) { settings.set('cardWidth', this.cardWidth); settings.set('cardHeight', this.cardHeight); }
    this.changed();
  }

  /** Bottom-edge grip: drags change the panel height; it never moves the window. */
  setCardHeight(h, persist) {
    this.cardHeight = Math.min(1400, Math.max(220, h));
    if (persist) settings.set('cardHeight', this.cardHeight);
    this.changed();
  }

  collapseToggle() {
    if (this.cardVisible) { this.collapsed = true; this.showTranscript = false; }
    else { this.collapsed = false; this.cardOpen = true; this.unseenFollow = 0; }
    this.changed();
  }

  toggleTranscript() { this.showTranscript = !this.showTranscript; this.changed(); }

  focusInput() { this.collapsed = false; this.focusInputTick += 1; this.changed(); }

  // MARK: Auth

  async checkLogin() {
    this.directSignedIn = auth.isSignedIn();
    if (this.directSignedIn) this.loadModels();
    await this.refreshLoggedIn();
    this.emit('menu');
  }

  async refreshLoggedIn() {
    if (this.directSignedIn) { this.loggedIn = true; this.changed(); return; }
    const ok = await codex.isLoggedIn();
    this.loggedIn = ok;
    if (!ok) this.cardOpen = true;
    this.changed();
    this.emit('menu');
  }

  async login() {
    if (this.signingIn) return;
    this.signingIn = true;
    this.errorText = null;
    this.showPanel();
    this.changed();
    try {
      await auth.signIn();
      this.directSignedIn = true;
      this.loggedIn = true;
      this.loadModels();
    } catch (e) {
      this.errorText = e.message;
    }
    this.signingIn = false;
    this.changed();
    this.emit('menu');
  }

  async signOut() {
    auth.signOut();
    this.directSignedIn = false;
    await this.refreshLoggedIn();
  }

  async loadModels() {
    try {
      const list = await responses.listModels();
      if (!list.length) return;
      this.models = list;
      if (!list.some((m) => m.slug === this.model)) this.setModel(list[0].slug);
      this.emit('menu');
    } catch { /* keep defaults */ }
  }
}

module.exports = { AppState, LANGUAGES, PRESETS, withTimeout };
