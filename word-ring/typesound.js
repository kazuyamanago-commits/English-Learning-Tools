// タイプ音（共通・2026-11-25）：英語を打ちこむところ（カードの ①②④・スタジアム）すべてで鳴らす
// もとはスタジアム（見本B）の中にあったもの。オン・オフは設定とスタジアムの一時停止メニューで（この端末に残す）
(function () {
  'use strict';
  const PREF = 'wordring-typesound';
// タイプ音：録音ではなく、その場で音を合成する（素材ファイルなし・自作・遅れが少ない）
// 1打 ＝「カチッ」（高い音の短いノイズ）＋「コトッ」（低い音の胴鳴り）。押すたびに高さを少しずらして機械っぽさを消す。離したときは小さな「チッ」
const Keys = {
  get on() { try { return localStorage.getItem(PREF) !== 'off'; } catch (e) { return true; } },
  set on(v) { try { localStorage.setItem(PREF, v ? 'on' : 'off'); } catch (e) { /* */ } },
  n: 0, ctx: null, noise: null, out: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    const len = Math.floor(c.sampleRate * .25);
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.out = c.createGain(); this.out.gain.value = .55; this.out.connect(c.destination);
  },
  burst(t, f, q, gain, dur, type = "bandpass") {
    const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.playbackRate.value = .9 + Math.random() * .2;
    fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(fl).connect(g).connect(this.out); s.start(t, Math.random() * .2); s.stop(t + dur + .02);
  },
  tone(t, f, gain, dur) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * .55, t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + .002); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + .02);
  },
  press(kind) {
    if (!this.on) return;
    this.init(); if (!this.ctx) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.n++;
    const t = this.ctx.currentTime + .001, r = 1 + (Math.random() - .5) * .14, v = .85 + Math.random() * .3;
    if (kind === "space") {          // スペース：大きいキーなので低く長め＋カタつき
      this.burst(t, 900 * r, 1.4, .45 * v, .07); this.tone(t, 150 * r, .3 * v, .09); this.burst(t + .012, 2600 * r, 3, .12 * v, .03);
    } else if (kind === "enter") {   // Enter：強めに「ターン」
      this.burst(t, 3200 * r, 1.2, .6 * v, .014); this.burst(t + .002, 1100 * r, 1.8, .45 * v, .05); this.tone(t, 175 * r, .38 * v, .08);
    } else {                         // ふつうのキー・Backspace（少し低め）
      const k = kind === "back" ? .85 : 1;
      this.burst(t, 3800 * r * k, 1.3, .5 * v, .011); this.burst(t + .002, 1500 * r * k, 2, .32 * v, .035); this.tone(t, 245 * r * k, .22 * v, .05);
    }
  },
  release() {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + .001;
    this.burst(t, 4600 * (1 + (Math.random() - .5) * .1), 1.6, .13, .008);
  },
};
  // 英語の打ちこみ欄（data-typesound のある input・class="en" の text）で、キーを押したら鳴らす。押しっぱなしのくり返しでは鳴らさない
  const SKIP = ['Escape', 'Control', 'Shift', 'Alt', 'Meta', 'Tab', 'CapsLock', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  const isTyping = (t) => t instanceof HTMLInputElement && t.type === 'text' && !t.readOnly && !t.disabled && t.dataset.typesound !== 'off';
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || SKIP.includes(e.key) || !isTyping(e.target)) return;
    Keys.press(e.key === ' ' ? 'space' : e.key === 'Backspace' ? 'back' : e.key === 'Enter' ? 'enter' : 'key');
  }, true);
  document.addEventListener('keyup', (e) => { if (!SKIP.includes(e.key) && isTyping(e.target)) Keys.release(); }, true);
  window.TypeSound = Keys;
})();
