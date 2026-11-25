// 語彙練習アプリ（Word Ring）：画面（つなぎ役）。計算は core.js（FSRS）と vp.js（VP）、出題データは deck.js
// 2026-11-25：見本C（ホーム）・見本A（単語カード）を組み込み。スタジアム＝stadium.html、ランキング＝ranking.html
(function () {
  'use strict';
  const C = window.VocabCore;
  const V = window.VP;
  const D = window.DECK;
  const W = window.WR;                // アプリごとの設定（config.js・book.js：教科書版／速単版）
  const KEY = W.keys.state;           // 練習の記録（前の試作 vocab-srs-v0-L6 から book.js が引っこす）
  const LEDGER_KEY = W.keys.ledger;   // P の記録（vp-store.js と同じ）
  const PREF_KEY = W.keys.home;       // ホームでえらんだもの（レッスン・なにを・どうやって・試合の種類）
  const ROUND = 20;                   // 1回の枚数（仕様 13章：約20枚・5〜10分で「今日はここまで」）
  const A = 'assets/';
  const $ = (s) => document.querySelector(s);
  const notesById = Object.fromEntries(D.notes.map((n) => [n.id, n]));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- 記録 ----------
  function load() {
    try { const t = localStorage.getItem(KEY); if (t) return C.importState(t); } catch (e) { /* こわれていたら新しく */ }
    return C.newState();
  }
  function loadLedger() {
    try { const o = JSON.parse(localStorage.getItem(LEDGER_KEY) || 'null'); if (o && o.version === 1 && o.days) return o; } catch (e) { /* 新しく */ }
    return V.newLedger();
  }
  let state = load();
  let ledger = loadLedger();
  function save() {
    try { localStorage.setItem(KEY, C.exportState(state)); localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); } catch (e) { /* 保存できない端末 */ }
  }
  const now = () => Date.now();
  const prefs = { scope: 'today', how: 'card', mode: 'choice' };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) { /* 既定で */ }
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* */ } };

  // ---------- 小さな道具 ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function icon(name) {
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#i-' + name); s.append(u); return s;
  }
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const plain = (segs) => segs.map(([t]) => t).join('');
  const marked = (segs) => segs.map(([t, b]) => (b ? h('mark', {}, t) : t));
  const blanked = (segs) => segs.map(([t, b]) => (b ? h('span', { class: 'blank' }, h('span', { class: 'visually-hidden' }, '空所'), ' ') : t));
  const kbd = (k) => h('kbd', { 'aria-hidden': 'true' }, k);

  // ---------- 音 ----------
  // 効果音（自作の wav）
  const sfx = (name) => { if (state && state.settings.sfx === false) return; try { const a = new Audio(`${A}sfx/${name}.wav`); a.volume = 0.5; a.play().catch(() => {}); } catch (e) { /* */ } };
  // 読み上げ：語・例文は録音（assets/audio/ID_word.mp3・ID_ex.mp3）。なければブラウザの読み上げ
  let voice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    voice = vs.find((v) => /en-US/i.test(v.lang) && /Google|Natural|Aria|Jenny/i.test(v.name)) ||
      vs.find((v) => /en-US/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.addEventListener('voiceschanged', pickVoice); }
  let audio = null;
  function hush() { if (audio) { audio.pause(); audio = null; } if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  function tts(text) {
    if (!('speechSynthesis' in window) || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = state.settings.rate || 1;
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }
  // s = { id, kind: 'word'|'ex', text }
  function speak(s) {
    hush();
    if (!s) return;
    // 録音がない（まだ作っていない）語・例文はブラウザの読み上げ（audio-list.js）
    if (!s.id || (window.AUDIO_HAVE && !window.AUDIO_HAVE.has(`${s.id}_${s.kind}`))) { tts(s.text); return; }
    const a = new Audio(`${A}audio/${s.id}_${s.kind}.mp3`);
    a.playbackRate = state.settings.rate || 1;
    a.addEventListener('error', () => { if (audio === a) { audio = null; tts(s.text); } });
    audio = a;
    a.play().catch(() => {});
  }
  const wordSay = (note) => ({ id: note.id, kind: 'word', text: C.sayable(note.word) });
  const exSay = (note) => ({ id: note.id, kind: 'ex', text: plain(note.example) });
  const speakBtn = (s, label, cls, key) => h('button', { type: 'button', class: 'say ' + (cls || ''), 'aria-keyshortcuts': key ? 'ArrowUp' : null, onclick: () => speak(s) },
    icon('speaker'), label, key ? kbd('↑') : null);
  const sayIcon = (s, label) => h('button', { type: 'button', class: 'say icon', 'aria-label': label, onclick: () => speak(s) }, icon('speaker'));

  // ---------- 画面の切りかえ ----------
  function show(id) {
    if (id !== 'practice') { stopTimer(); hush(); session = null; current = null; }
    if ($('#end').open && id !== 'home') $('#end').close();
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    for (const b of document.querySelectorAll('nav.tabs button')) {
      if (b.dataset.go === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    if (id === 'home') renderHome();
    if (id === 'words') renderWords();
    if (id === 'records') renderRecords();
    if (id === 'settings') renderSettings();
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

  // ---------- ホーム（見本C：なにを × どうやって） ----------
  // えらんだレッスン（生徒がえらぶ・いくつでも。2026-11-25 先生）
  const selLessons = () => W.lessons(prefs);
  const selNotes = () => D.notes.filter(W.noteIn(selLessons()));
  const selDeck = () => ({ notes: selNotes() });
  function leechIds() { return selNotes().filter((n) => C.noteStatus(D, state, n.id) === 'leech').map((n) => n.id); }
  const starIds = () => { const ok = new Set(selNotes().map((n) => n.id)); return state.stars.filter((id) => ok.has(id)); };
  function renderShelf() {
    const sel = selLessons();
    $('#shelf').replaceChildren(...W.cfg.units.map((u) => {
      const ns = D.notes.filter((n) => n.lesson === u);
      if (!ns.length) return h('button', { type: 'button', disabled: true, title: '準備中' }, h('b', {}, `L${u}`), h('small', {}, '準備中'));
      const r = V.recallable({ notes: ns }, state.cards, now(), state.sorted);
      return h('button', { type: 'button', 'aria-pressed': String(sel.includes(u)), 'aria-label': `${W.cfg.unit} ${u}（思い出せる語 ${r}／${ns.length}）`, onclick: () => {
        const cur = selLessons();
        const next = cur.includes(u) ? cur.filter((x) => x !== u) : cur.concat(u).sort((a, b) => a - b);
        if (!next.length) { $('#home-msg').textContent = 'レッスンは1つ以上えらんでね'; return; }
        prefs.lessons = next; savePrefs(); sfx('flip'); renderHome();
      } }, h('b', {}, `L${u}`), h('small', {}, `${r}/${ns.length}`), h('span', { class: 'mbar', 'aria-hidden': 'true' }, h('i', { style: `width:${(100 * r) / ns.length}%` })));
    }));
  }
  function vpNow() {
    const t = now(), v = V.computeV(state.cards, t, state.sorted, D);
    return { t, v, level: V.level(v), week: V.week(ledger, t, v) };
  }
  function renderHome(msg) {
    const t = now();
    const sel = selLessons();
    const c = C.counts(D, state, t, sel);
    const all = selNotes().length;
    const recall = V.recallable(selDeck(), state.cards, t, state.sorted);
    renderShelf();
    // えらんでいないレッスンに復習がたまっていたら知らせる（えらぶかは生徒が決める・11/25 先生：C）
    const wait = C.waitingElsewhere(D, state, t, sel), wl = Object.keys(wait).map(Number).sort((a, b) => a - b);
    $('#shelf-note').hidden = !wl.length;
    if (wl.length) $('#shelf-note').replaceChildren(icon('calendar'),
      h('span', {}, wl.map((l) => `L${l} の復習が ${wait[l]}語`).join('・'), ' たまっています'),
      h('button', { type: 'button', onclick: () => { prefs.lessons = sel.concat(wl).sort((a, b) => a - b); savePrefs(); sfx('flip'); renderHome(); } },
        `${wl.map((l) => 'L' + l).join('・')} もえらぶ`));
    $('#brand-sub').textContent = `${W.cfg.sub} ・ ${W.label(sel)}`;
    $('#n-known').textContent = recall; $('#n-all').textContent = all; $('#n-all2').textContent = all;
    $('#meter').replaceChildren(...Array.from({ length: all }, (_, k) => h('i', { class: k < recall ? 'on' : null })));
    $('#c-new').textContent = c.fresh; $('#c-learn').textContent = c.learning; $('#c-review').textContent = c.review + c.learning;
    $('#c-today').textContent = c.fresh + c.review + c.learning;
    $('#n-leech').textContent = leechIds().length;
    $('#n-star').textContent = starIds().length;
    const vp = vpNow();
    $('#vp-v').textContent = vp.v.toLocaleString('ja-JP'); $('#vp-lv').textContent = vp.level.name; $('#vp-p').textContent = vp.week.p;
    $('#vp-rank').textContent = V.board(V.rivals(vp.t).concat([{ nick: 'me', p: vp.week.p, me: true }]), 'p').myRank;
    $('#wdays').textContent = vp.week.days; $('#wgoal').textContent = vp.week.days >= 4 ? ' 達成！' : '';
    $('#topic').textContent = sel.length === 1 ? ((D.lessons.find((l) => l.id === sel[0]) || {}).topic || '') : W.label(sel);
    const hr = new Date(t).getHours();
    $('#hello').textContent = hr < 11 ? 'おはよう！' : hr < 17 ? 'おかえり！' : '今日もやろう！';
    let m = msg || '';
    if (!m && prefs.scope === 'today' && !c.fresh && !c.learning && !c.review) {
      m = c.nextLearningAt ? `今日の分はほぼ終わり。練習中の語が ${Math.max(1, Math.round((c.nextLearningAt - t) / 60000))} 分後にもう一度出ます。` : '今日の分は終わりました。また明日！ ほかの「なにを」やスタジアムでも遊べます';
    }
    if (!m && prefs.scope === 'weak' && !leechIds().length) m = '苦手な語はまだありません（1回でもまちがえた語が入ります。別の日に2回続けて正解すると卒業）';
    if (!m && prefs.scope === 'star' && !starIds().length) m = '★の語はまだありません（答えのカードや単語帳で★をつけます）';
    $('#home-msg').textContent = m;
    renderChoice0();
  }
  function renderChoice0() {
    for (const b of document.querySelectorAll('[data-scope]')) b.setAttribute('aria-pressed', String(b.dataset.scope === prefs.scope));
    for (const b of document.querySelectorAll('[data-how]')) b.setAttribute('aria-pressed', String(b.dataset.how === prefs.how));
    for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === prefs.mode));
    const match = prefs.how === 'stadium';
    $('#match-mode').hidden = !match;
    $('#start').classList.toggle('match', match);
    $('#start use').setAttribute('href', match ? '#i-ball' : '#i-play');
    $('#go-label').textContent = match ? '試合開始' : prefs.how === 'sort' ? '入門テスト開始' : '始める';
  }
  for (const b of document.querySelectorAll('[data-scope]')) b.addEventListener('click', () => { prefs.scope = b.dataset.scope; savePrefs(); sfx('flip'); renderHome(); });
  for (const b of document.querySelectorAll('[data-how]')) b.addEventListener('click', () => { prefs.how = b.dataset.how; savePrefs(); sfx(prefs.how === 'stadium' ? 'whistle' : 'flip'); renderChoice0(); });
  for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => { prefs.mode = b.dataset.mode; savePrefs(); sfx('click'); renderChoice0(); });

  function sessionFor(scope) {
    if (scope === 'weak') return { mode: 'focus', noteIds: leechIds(), label: '苦手な語' };
    if (scope === 'star') return { mode: 'focus', noteIds: starIds(), label: '★の語' };
    if (scope === 'all') return { mode: 'focus', noteIds: selNotes().map((n) => n.id), label: `${W.label(selLessons())} ぜんぶ`, skipSorted: true };
    return { mode: 'normal', lessons: selLessons() };
  }
  function go() {
    savePrefs();
    if (prefs.how === 'stadium') { location.href = `stadium.html?mode=${prefs.mode}&scope=${prefs.scope}&lessons=${selLessons().join(',')}`; return; }
    if (prefs.how === 'sort') {
      // 入門（仕分け）：語も問題の種類もランダム。できている語を見つけて、ふだんの練習から外す（仕様 14章）
      const ids = prefs.scope === 'star' ? starIds() : selNotes().map((n) => n.id);
      if (!C.sortCandidates(D, state, ids).length) { renderHome('仕分けできる語がもうありません（まちがえたことのある語・仕分けずみの語は出ません）'); return; }
      startSession({ mode: 'sort', noteIds: ids, prog: {}, out: new Set(), sorted: 0, label: '入門（仕分け）' });
      return;
    }
    const s = sessionFor(prefs.scope);
    if (s.mode === 'focus' && !s.noteIds.length) { renderHome(); return; }
    startSession(s);
  }
  $('#start').addEventListener('click', go);

  // ---------- 練習 ----------
  let session = null;
  let current = null;
  // 時間とのしょうぶはスタジアムへ（カードの「落ちてくるゲーム」は 11/25 先生の判断で削除）
  function stopTimer() { /* カード練習には制限時間なし */ }

  function startSession(opts) {
    if ($('#end').open) $('#end').close();
    show('practice');
    session = Object.assign({ seen: new Set(), done: 0, right: 0, combo: 0, best: 0, p: 0, again: opts }, opts);
    nextCard();
  }
  // reason: 'round'（20枚）／'empty'（出す問題がない）／'quit'（やめる）
  function endSession(reason) {
    const s = session;
    if (s && reason === 'empty' && s.mode === 'normal' && s.done) s.p += V.awardDailyDone(ledger, now());
    if (s && s.done) state.sessions = (state.sessions || 0) + 1;   // 練習1回（仕分けずみの語の抜き打ちは 10回後）
    save();
    const again = s && s.again;
    show('home');
    if (s && s.done) {
      let msg = `この回：${s.done} 問に答えました（正解 ${s.right}）・P +${s.p}`;
      if (s.mode === 'sort') msg += `・仕分けずみ ${s.sorted}語（ふだんの練習には出ません）`;
      $('#end-h').textContent = reason === 'empty' && s.mode === 'normal' ? '今日の分、おしまい！' : reason === 'empty' && s.mode === 'sort' ? '仕分け、ぜんぶ終わり！' : '今日はここまで';
      $('#end-msg').textContent = msg;
      $('#end-again').hidden = reason === 'empty';
      endAgain = again;
      $('#end').showModal();
      sfx(reason === 'quit' ? 'click' : 'fanfare');
    } else {
      $('#start').focus();
    }
  }
  let endAgain = null;
  $('#end').addEventListener('close', () => {
    const v = $('#end').returnValue; $('#end').returnValue = '';
    if (v === 'again' && endAgain) startSession(endAgain); else if (!$('#home').hidden) $('#start').focus();
  });
  $('#quit').addEventListener('click', () => endSession('quit'));

  function nextCard() {
    if (!session) return;
    stopTimer();
    if (session.done >= ROUND) { current = null; endSession('round'); return; }
    const p = session.mode === 'sort' ? C.pickSort(D, state, session) : C.pickNext(D, state, now(), session);
    if (!p) { current = null; endSession('empty'); return; }
    const note = notesById[p.card.noteId];
    current = { card: p.card, queue: p.queue, note, stage: 0, hinted: false, done: false };
    if (session.mode === 'focus') session.seen.add(p.card.id);
    if (session.mode === 'sort') session.last = p.card.noteId;   // 同じ語を続けて出さない
    drawCard(true);
  }

  function updateTop() {
    const left = ROUND - session.done;
    $('#p-count').textContent = left;
    $('#p-bar').style.width = `${(session.done / ROUND) * 100}%`;
    const label = session.label || '今日の分';
    $('#p-left').textContent = label;
  }

  function drawCard(first) {
    const cur = current;
    cur.t0 = performance.now();
    updateTop();
    const slot = $('#card-slot');
    slot.replaceChildren(renderCard(cur));
    if (first || cur.stage > 0) {
      const f = slot.querySelector('input:not([disabled]), .choices button:not([disabled])');
      if (f) f.focus({ preventScroll: true });
    }
    if (cur.say && (first || cur.stage > 0)) setTimeout(() => { if (current === cur && !cur.done) speak(cur.say); }, 150);
  }

  const QUEUE_TAG = { new: 'はじめて', review: '復習', learning: '練習中', focus: '', sort: '入門', quiz: '抜き打ち' };
  function cardShell(cur, ...body) {
    return h('article', { class: 'card paper', 'aria-labelledby': 'card-kind' },
      h('span', { class: 'ring', 'aria-hidden': 'true' }),
      h('p', { class: 'kind', id: 'card-kind' },
        h('span', {}, C.TYPE_LABEL[cur.card.type], cur.stage > 0 ? '（ヒントつきでもう一度）' : ''),
        h('span', { class: 'tag' }, QUEUE_TAG[cur.queue] || '')),
      ...body,
      h('p', { class: 'keys', 'aria-hidden': 'true' },
        cur.card.type === 'w2m' ? [kbd('1'), '〜', kbd('4'), ' 選ぶ　'] : [kbd('Enter'), ' 答える　'],
        kbd('↑'), ' もう一度聞く　',
        cur.card.type !== 'w2m' && cur.card.type !== 'm2w' && cur.stage === 0 ? [kbd('?'), ' ヒント　'] : '',
        kbd('Esc'), ' 覚えていない'));
  }

  function textInput(id, label, placeholder) {
    return [h('label', { for: id, class: 'visually-hidden' }, label),
      h('input', { type: 'text', id, name: id, placeholder, autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done', class: 'en' })];
  }
  const answersOf = (cur) => (cur.card.type === 'cloze' ? cur.note.answers : [cur.note.word]);
  const readTyped = (cur) => answersOf(cur).map((_, i) => { const el = document.querySelector('#a' + i); return el ? el.value : ''; });

  function renderCard(cur) {
    if (cur.card.type === 'w2m') return renderChoice(cur);
    const { card, note, stage } = cur;
    const answers = answersOf(cur);
    const changed = note.kind === 'word' && C.normalize(note.answers[0]) !== C.normalize(note.word);
    let prompt;
    if (stage === 0) {
      if (card.type === 'listen') {
        cur.say = wordSay(note);
        prompt = [h('p', {}, speakBtn(cur.say, 'もう一度聞く', 'huge', true)), h('p', { class: 'muted' }, '聞こえた語を書こう'), ...textInput('a0', '聞こえた語')];
      } else if (card.type === 'm2w') {
        cur.say = null;
        prompt = [h('p', { class: 'bigja' }, note.meaning),
          h('p', { class: 'muted' }, '最初の文字：', h('b', { class: 'en' }, note.word[0]), `（${note.word.length} 文字）`),
          ...textInput('a0', '英語で書く')];
      } else {
        cur.say = exSay(note);
        prompt = [h('p', { style: 'margin-top:20px' }, speakBtn(cur.say, '例文を聞く', '', true)), clozeSentence(note, false),
          h('p', { class: 'ja' }, marked(note.exampleJa)),
          changed ? h('p', { class: 'note' }, '※ 文に合う形にして書こう（例：過去形・複数形）') : null];
      }
    } else {
      // ヒントつきでもう一度（難易度を下げる）
      const yours = cur.firstTyped && cur.firstTyped.some((v) => v.trim()) ? `あなた：${cur.firstTyped.join(' / ')}` : '';
      const why = 'ちがいました。';
      const head = h('p', { class: 'retry-msg', role: 'status' }, `${why}ヒントつきでもう一度。`, yours ? h('span', { class: 'en muted' }, `（${yours}）`) : '');
      if (card.type === 'cloze') {
        cur.say = exSay(note);
        prompt = [head, h('p', {}, speakBtn(cur.say, '例文を聞く', '', true)), clozeSentence(note, true),
          h('p', { class: 'ja' }, marked(note.exampleJa)),
          h('p', { class: 'muted' }, '意味：', note.meaning)];
      } else {
        cur.say = card.type === 'listen' ? wordSay(note) : exSay(note);
        prompt = [head,
          h('p', {}, card.type === 'listen' ? speakBtn(cur.say, '語を聞く', '', true) : speakBtn(cur.say, '例文を聞く', '', true)),
          h('p', { class: 'sentence' }, blanked(note.example)),
          h('p', { class: 'ja' }, marked(note.exampleJa)),
          h('p', { class: 'muted' }, '意味：', note.meaning, '　最初の文字：', h('b', { class: 'en' }, note.word[0]), `（${note.word.length} 文字）`),
          changed ? h('p', { class: 'note' }, `※ 例文では形が変わっています。元の形（辞書の形）で書こう`) : null,
          ...textInput('a0', '英語で書く', C.letterHint(note.word))];
      }
    }
    const hintOut = h('p', { class: 'note hint', role: 'status' });
    const form = h('form', { class: 'stack', onsubmit: (e) => {
      e.preventDefault();
      if (cur.done) return;
      const vals = readTyped(cur);
      if (vals.every((v) => !v.trim())) { hintOut.textContent = '書いてから「答える」を押してね。わからないときは「覚えていない」（Esc）。'; return; }
      const ok = vals.every((v, i) => C.checkTyped(v, answers[i]));
      if (cur.stage === 0) {
        if (ok) finish(cur, C.gradeTyped({ correct: true, ms: performance.now() - cur.t0, len: answers.join('').length, hinted: cur.hinted }), { typed: vals, answers });
        else { sfx('wrong'); toRetry(cur, vals); }
      } else finish(cur, C.gradeRetry(ok), { typed: vals, answers });
    } },
    prompt,
    hintOut,
    h('div', { class: 'actions' },
      h('button', { type: 'submit', class: 'primary' }, '答える', kbd('Enter')),
      card.type !== 'm2w' && stage === 0 ? h('button', { type: 'button', class: 'hint-btn', 'aria-keyshortcuts': '?', onclick: () => giveHint(cur, hintOut) }, 'ヒント', kbd('?')) : null,
      h('button', { type: 'button', class: 'give', 'aria-keyshortcuts': 'Escape', onclick: () => finish(cur, 1, { gave: true, answers }) }, '覚えていない（Esc）')));
    return cardShell(cur, form);
  }

  function clozeSentence(note, withHint) {
    let k = 0;
    return h('p', { class: 'sentence' }, note.example.map(([t, b]) => {
      if (!b) return t;
      const id = 'a' + k++;
      return h('span', {}, h('label', { for: id, class: 'visually-hidden' }, `空所 ${k}`),
        h('input', { type: 'text', id, name: id, size: Math.max(4, t.length + 1), placeholder: withHint ? C.letterHint(t) : null, autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done' }));
    }));
  }

  function giveHint(cur, out) {
    if (cur.done || cur.stage > 0 || cur.card.type === 'm2w' || cur.card.type === 'w2m') return;
    cur.hinted = true;
    out.textContent = 'ヒント：最初の文字は ' + answersOf(cur).map((a) => `「${a[0]}」`).join('・');
  }

  function toRetry(cur, typed) {
    if (cur.done || cur.stage > 0) return;
    stopTimer();
    if (session) session.combo = 0;
    cur.stage = 1;
    cur.firstTyped = typed;
    drawCard(false);
  }

  function renderChoice(cur) {
    const { note, stage } = cur;
    cur.say = wordSay(note);
    cur.options = cur.options || shuffle([note.choice || note.meaning, ...note.wrong]);
    const box = h('div', { class: 'choices', role: 'group', 'aria-label': '意味を選ぶ' },
      cur.options.map((o, i) => {
        const b = h('button', { type: 'button', 'data-i': i + 1, 'aria-keyshortcuts': String(i + 1), onclick: () => choose(cur, o) }, kbd(String(i + 1)), h('span', {}, o));
        if (stage > 0 && o === cur.firstWrong) { b.dataset.state = 'wrong'; b.disabled = true; }
        return b;
      }));
    const body = [h('p', { class: 'big' }, h('span', { class: 'en' }, note.word), sayIcon(cur.say, '発音を聞く'))];
    if (stage > 0) {
      const why = `ちがいました（「${cur.firstWrong}」ではありません）。`;
      body.push(h('p', { class: 'retry-msg', role: 'status' }, why, '文の中で考えてみよう。'),
        h('p', {}, speakBtn(exSay(note), '例文を聞く')),
        h('p', { class: 'sentence' }, blanked(note.example)),
        h('p', { class: 'ja' }, blanked(note.exampleJa)),
        h('p', {}, h('b', { class: 'en' }, note.word), ' の意味は？'));
    }
    body.push(box, h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'give', 'aria-keyshortcuts': 'Escape', onclick: () => finish(cur, 1, { gave: true }) }, '覚えていない（Esc）')));
    return cardShell(cur, ...body);
  }

  function choose(cur, o) {
    if (cur.done) return;
    const right = o === (cur.note.choice || cur.note.meaning);
    if (right || cur.stage > 0) {
      for (const b of document.querySelectorAll('#card-slot .choices button')) {
        const t = b.querySelector('span').textContent;
        if (t === (cur.note.choice || cur.note.meaning)) b.dataset.state = 'right';
        else if (t === o) b.dataset.state = 'wrong';
      }
      finish(cur, C.gradeChoice({ firstCorrect: right && cur.stage === 0, retryCorrect: cur.stage > 0 && right }), { chosen: o });
      return;
    }
    if (session) session.combo = 0;
    stopTimer();
    sfx('wrong');
    cur.firstWrong = o;
    cur.stage = 1;
    drawCard(false);
  }

  function dueText(cs) {
    const ms = cs.due - now();
    if (ms < 60 * 60000) return `${Math.max(1, Math.round(ms / 60000))} 分後`;
    const days = Math.round((C.dayStart(cs.due) - C.dayStart(now())) / C.DAY);
    return days <= 1 ? '明日' : `${days} 日後`;
  }

  const PRAISE = ['いいね！', 'その調子！', 'ナイス！', '完ぺき！'];
  const CHEER = ['次はいける！', 'ドンマイ！', 'もう一度見ておこう'];
  function finish(cur, g, info) {
    if (cur.done) return;
    cur.done = true;
    stopTimer();
    const t = now();
    const ms = performance.now() - cur.t0;
    let cs = null, sortRes = null;
    if (cur.queue === 'sort') {
      // 仕分け：正解は記録（次に出す日）を動かさない。まちがえたら③（意味を選ぶ）から練習に入れ、苦手に
      sortRes = C.sortAnswer(state, session.prog, cur.card, g > 1, t);
      if (sortRes === 'out') {
        session.out.add(cur.card.noteId);
        cs = C.answer(state, { id: `${cur.card.noteId}:w2m`, noteId: cur.card.noteId, type: 'w2m' }, 1, t, ms);
      } else {
        state.log.push({ t, c: cur.card.id, g, ms: Math.round(ms), sort: true });
        if (sortRes === 'sorted') { session.sorted++; session.out.add(cur.card.noteId); }
      }
    } else {
      cs = C.answer(state, cur.card, g, t, ms);
      if (cur.queue === 'quiz') C.quizAnswer(state, cur.card.noteId, g > 1);
    }
    // P：最初の挑戦で正解したときだけ（ヒントつきのもう一度・覚えていない は 0。同じカードは1日1回）
    const gotP = V.awardP(ledger, cur.card.id, t, { correct: g > 1, retry: cur.stage > 0 });
    V.recordV(ledger, t, V.computeV(state.cards, t, state.sorted, D));
    save();
    if (session) {
      session.done++;
      session.p += gotP;
      if (g > 1) { session.right++; session.combo = cur.stage === 0 ? session.combo + 1 : 0; } else session.combo = 0;
      session.best = Math.max(session.best, session.combo);
      updateTop();
    }
    const { note } = cur;
    const ok = g > 1;
    sfx(ok ? 'correct' : 'wrong');
    setTimeout(() => sfx('flip'), 120);
    const verdict = info.gave ? ['答えを見ました', 'ng', 'cross']
      : g === 1 ? ['ちがいました', 'ng', 'cross'] : g === 2 ? ['正解（少しあやしい）', 'hard', 'check'] : g === 3 ? ['正解', 'ok', 'check'] : ['正解・速い！', 'ok', 'check'];
    const starOn = () => state.stars.includes(note.id);
    const star = h('button', { type: 'button', class: 'star', 'aria-label': 'My単語帳（★）に入れる', 'aria-pressed': String(starOn()), onclick: (e) => {
      toggleStar(note.id); const b = e.currentTarget; b.setAttribute('aria-pressed', String(starOn())); b.replaceChildren(icon(starOn() ? 'star-fill' : 'star'));
    } }, icon(starOn() ? 'star-fill' : 'star'));
    const nextBtn = h('button', { type: 'button', class: 'primary next', onclick: () => { sfx('click'); nextCard(); } }, '次へ', kbd('Enter'));
    const showYours = info.typed && g === 1 && !info.gave;
    // 裏の面：カードがめくれて、意味と例文が出る（見本A）
    const back = h('article', { class: 'card paper back result', 'aria-label': '答え' },
      h('span', { class: 'ring', 'aria-hidden': 'true' }),
      g === 1 ? h('div', { class: 'sticky' }, 'もう一度') : null,
      h('p', { class: 'verdict ' + verdict[1], role: 'status' },
        h('b', {}, icon(verdict[2]), verdict[0], gotP ? h('span', { class: 'en' }, `　P +${gotP}`) : ''),
        h('span', { class: 'due' }, sortRes === 'sorted' ? '仕分けずみ！ ふだんの練習には出ません'
          : sortRes === 'progress' ? 'あと1種類（書く問題をふくむ）で仕分け'
            : sortRes === 'out' ? '練習に入れました（意味を選ぶ から）'
              : cur.queue === 'quiz' ? (g > 1 ? '抜き打ち合格！ また10回あとに' : '練習にもどします')
                : g === 1 ? 'すぐにもう一度出ます' : `次は ${dueText(cs)}`)),
      h('div', { class: 'head' }, h('span', { class: 'w' }, note.word), h('span', { class: 'pos' }, note.pos), h('span', { class: 'meaning' }, note.meaning),
        sayIcon(wordSay(note), '発音を聞く')),
      showYours ? h('p', { class: 'yours' }, 'あなた：', h('span', { class: 'en' }, info.typed.join(' / ') || '（空）'), '　正解：', h('b', { class: 'en' }, info.answers.join(' … '))) : null,
      h('p', { class: 'ex' }, marked(note.example), ' ', sayIcon(exSay(note), '例文を聞く')),
      h('p', { class: 'exja' }, marked(note.exampleJa)),
      note.phrases ? h('p', { class: 'phr' }, note.phrases) : null,
      cs && cs.leech && g === 1 ? h('p', { class: 'note' }, '苦手な語に入りました（ホームの「苦手な語」で練習できます。別の日に2回続けて正解すると卒業）') : null,
      h('div', { class: 'buddy', 'aria-hidden': 'true' }, h('div', { class: 'bubble' }, pick(ok ? PRAISE : CHEER)), h('img', { src: `${A}char/${ok ? 'A1_correct' : 'A2_wrong'}.png`, alt: '' })));
    $('#card-slot').replaceChildren(back, h('div', { class: 'next-row' }, nextBtn, star));
    nextBtn.focus({ preventScroll: true });
    // 答えの画面では例文を自動で読む
    if (state.settings.autoEx !== false) setTimeout(() => { if (current === cur) speak(exSay(note)); }, 450);
    window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }

  // ---------- キーボード ----------
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.keyCode === 229) return;
    // ホーム：Enter で始める（ボタン・リンクの上では、そのボタンが動く）
    if (!$('#home').hidden) {
      if (e.key === 'Enter' && !document.querySelector('dialog[open]') && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement || e.target instanceof HTMLInputElement)) { e.preventDefault(); go(); }
      return;
    }
    if ($('#practice').hidden || !current) return;
    const cur = current;
    const inText = e.target instanceof HTMLInputElement && e.target.type === 'text';
    if (cur.done) {
      // 答えのあと：Enter で次へ（ボタン以外にフォーカスがあるときも）
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); nextCard(); }
      return;
    }
    if (e.key === 'ArrowUp') { e.preventDefault(); speak(cur.say || wordSay(cur.note)); return; }
    if (e.key === 'Escape') { e.preventDefault(); finish(cur, 1, { gave: true, answers: cur.card.type === 'w2m' ? null : answersOf(cur) }); return; }
    if (e.key === '?') { e.preventDefault(); giveHint(cur, $('#card-slot .hint')); return; }
    if (cur.card.type === 'w2m' && !inText && /^[1-4]$/.test(e.key)) {
      const b = $(`#card-slot .choices button[data-i="${e.key}"]`);
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    }
  });

  function toggleStar(id) {
    const i = state.stars.indexOf(id);
    if (i >= 0) state.stars.splice(i, 1); else state.stars.push(id);
    save();
  }

  // ---------- 単語帳 ----------
  let filter = 'all';
  document.querySelectorAll('.filters button').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.f;
    document.querySelectorAll('.filters button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderWords();
  }));
  $('#q').addEventListener('input', () => renderWords());
  $('#redsheet').addEventListener('change', () => renderWords());
  const STATUS_JA = { new: 'まだ', learning: '練習中', known: '覚えた', leech: '苦手' };
  function renderWords() {
    const q = $('#q').value.trim().toLowerCase();
    // 赤シート：off／ja（日本語をかくす）／en（英語をかくす）。押すとシートがずれて見える（もう一度押すともどる）
    const sheet = ($('#redsheet input:checked') || {}).value || 'off';
    const cover = (text, label) => h('button', { type: 'button', class: 'sheet', 'aria-label': `${label}を見る`, 'aria-pressed': 'false', onclick: (e) => {
      const b = e.currentTarget, up = !b.classList.contains('lift'); b.classList.toggle('lift', up); b.setAttribute('aria-pressed', String(up));
    } }, text);
    // えらんだレッスンの語を、レッスンごとに見出しをつけて並べる
    let lastL = null;
    const items = selNotes().filter((n) => {
      const st = C.noteStatus(D, state, n.id);
      if (filter === 'leech' && st !== 'leech') return false;
      if (filter === 'star' && !state.stars.includes(n.id)) return false;
      return !q || n.word.toLowerCase().includes(q) || n.meaning.includes(q);
    }).map((n) => {
      const st = C.noteStatus(D, state, n.id);
      const meaning = sheet === 'ja' ? cover(n.meaning, `${n.word} の意味`) : n.meaning;
      const word = sheet === 'en' ? cover(n.word, `「${n.meaning}」の英語`) : n.word;
      const on = () => state.stars.includes(n.id);
      const head = n.lesson !== lastL && selLessons().length > 1 ? h('li', { class: 'grp' }, `${W.cfg.unit} ${n.lesson}`) : null;
      lastL = n.lesson;
      return [head, h('li', {},
        h('i', { class: 'dot', 'data-s': st, title: STATUS_JA[st] }, h('span', { class: 'visually-hidden' }, STATUS_JA[st])),
        h('div', {}, h('div', { class: 'w' }, word), h('div', { class: 'm' }, meaning)),
        h('button', { type: 'button', 'aria-label': `${n.word} を読み上げ`, onclick: () => speak(wordSay(n)) }, icon('speaker')),
        h('button', { type: 'button', class: 'star', 'aria-label': `${n.word} を★に入れる`, 'aria-pressed': String(on()), onclick: (e) => {
          toggleStar(n.id); const b = e.currentTarget; b.setAttribute('aria-pressed', String(on())); b.replaceChildren(icon(on() ? 'star-fill' : 'star'));
        } }, icon(on() ? 'star-fill' : 'star')))];
    }).flat().filter(Boolean);
    $('#word-list').replaceChildren(...(items.length ? items : [h('li', {}, h('span'), h('span', { class: 'muted' }, 'あてはまる語はありません'))]));
  }

  // ---------- 記録（2026-11-25 作りなおし：思い出せる語・V／P・語のようす・この7日） ----------
  const WD = ['月', '火', '水', '木', '金', '土', '日'];
  function renderRecords() {
    const s = C.stats(D, state, now());
    const vp = vpNow();
    const all = D.notes.length, recall = V.recallable(D, state.cards, vp.t, state.sorted);
    $('#r-known').textContent = recall; $('#r-all').textContent = all;
    $('#r-meter').replaceChildren(...Array.from({ length: all }, (_, k) => h('i', { class: k < recall ? 'on' : null })));
    // V と段階
    $('#r-v').textContent = vp.v.toLocaleString('ja-JP'); $('#r-lv').textContent = vp.level.name;
    const nx = vp.level.next;
    $('#r-lvbar').style.width = nx ? `${Math.round(100 * (vp.v - vp.level.from) / (nx.at - vp.level.from))}%` : '100%';
    $('#r-next').textContent = nx ? `あと ${(nx.at - vp.v).toLocaleString('ja-JP')} で ${nx.name}` : '最高の段階！';
    // P と今週やった日（月〜日）
    $('#r-p').textContent = vp.week.p; $('#r-days').textContent = vp.week.days;
    const todayIdx = (new Date(vp.t).getDay() + 6) % 7;
    $('#r-week').replaceChildren(...vp.week.active.map((on, k) => h('span', { class: k === todayIdx ? 'wk-today' : null },
      h('i', { class: on ? 'on' : null }), h('b', {}, WD[k]), h('span', { class: 'visually-hidden' }, on ? 'やった' : 'まだ'))));
    // 語のようす（覚えた・練習中・苦手・まだ）
    const st = s.status, JA = [['known', '覚えた'], ['learning', '練習中'], ['leech', '苦手'], ['new', 'まだ']];
    $('#r-bar').replaceChildren(...JA.map(([k]) => h('i', { 'data-s': k, style: `width:${(100 * st[k]) / all}%` })));
    $('#r-legend').replaceChildren(...JA.map(([k, ja]) => h('span', {}, h('i', { class: 'dot', 'data-s': k }), ja, ' ', h('b', {}, String(st[k])))));
    // この7日：答えた数（正解・まちがい）
    const days = Array.from({ length: 7 }, (_, k) => {
      const t = vp.t - (6 - k) * C.DAY, key = C.dayKey(t);
      const logs = state.log.filter((l) => C.dayKey(l.t) === key);
      return { k, t, ok: logs.filter((l) => l.g > 1).length, ng: logs.filter((l) => l.g === 1).length };
    });
    const max = Math.max(10, ...days.map((d) => d.ok + d.ng));
    $('#r-days7').replaceChildren(...days.map((d) => h('div', { class: 'col' + (d.k === 6 ? ' today' : '') },
      h('span', { class: 'n' }, String(d.ok + d.ng || '')),
      h('div', { class: 'bar7', style: `height:${(100 * (d.ok + d.ng)) / max}%`, title: `正解 ${d.ok}・まちがい ${d.ng}` },
        h('i', { class: 'ok', style: `flex:${d.ok}` }), h('i', { class: 'ng', style: `flex:${d.ng}` })),
      h('span', {}, d.k === 6 ? '今日' : WD[(new Date(d.t).getDay() + 6) % 7]))));
    const tile = (n, label) => h('div', {}, h('b', {}, String(n)), label);
    $('#stats').replaceChildren(
      tile(s.todayCount, '今日答えた数'),
      tile(s.accuracy == null ? '—' : s.accuracy + '%', '正答率（これまで）'),
      tile(s.streak + '日', '続いた日数'));
  }

  // ---------- 設定（2026-11-25 作りなおし） ----------
  const form = $('#settings-form');
  let savedTimer = 0;
  const saved = (m) => { $('#settings-msg').textContent = m; clearTimeout(savedTimer); savedTimer = setTimeout(() => { $('#settings-msg').textContent = ''; }, 2500); };
  function renderSettings() {
    for (const r of form.querySelectorAll('input[name=newPerDay]')) r.checked = Number(r.value) === Number(state.settings.newPerDay);
    for (const r of form.querySelectorAll('input[name=rate]')) r.checked = Number(r.value) === Number(state.settings.rate);
    for (const t of C.TYPES) form.elements[t].checked = state.settings.types[t] !== false;
    form.elements.autoEx.checked = state.settings.autoEx !== false;
    form.elements.sfx.checked = state.settings.sfx !== false;
    form.elements.typesound.checked = window.TypeSound ? window.TypeSound.on : false;
    form.elements.nick.value = ledger.nick || '';
    $('#settings-msg').textContent = '';
  }
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('change', (e) => {
    if (e.target.name === 'nick') return;
    if (e.target.name === 'typesound') { window.TypeSound.on = e.target.checked; if (e.target.checked) window.TypeSound.press('key'); saved('保存しました'); return; }
    const types = Object.fromEntries(C.TYPES.map((t) => [t, form.elements[t].checked]));
    if (!Object.values(types).some(Boolean)) {
      saved('問題の種類は1つ以上えらんでください。');
      for (const t of C.TYPES) form.elements[t].checked = state.settings.types[t] !== false;
      return;
    }
    const n = form.querySelector('input[name=newPerDay]:checked');
    if (n) state.settings.newPerDay = Number(n.value);
    const r = form.querySelector('input[name=rate]:checked');
    if (r) state.settings.rate = Number(r.value);
    state.settings.types = types;
    state.settings.autoEx = form.elements.autoEx.checked;
    state.settings.sfx = form.elements.sfx.checked;
    save();
    if (e.target.name === 'sfx' && state.settings.sfx) sfx('click');
    saved('保存しました');
  });
  // ニックネーム（ランキングの名前）：打ち終わったら保存
  form.elements.nick.addEventListener('change', () => {
    ledger.nick = form.elements.nick.value.trim().slice(0, 16); form.elements.nick.value = ledger.nick;
    save(); saved('名前を保存しました');
  });
  $('#export').addEventListener('click', () => {
    // VP（P の記録・ニックネーム）もいっしょに書き出す
    const data = Object.assign(JSON.parse(C.exportState(state)), { vpLedger: ledger });
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `単語れんしゅう記録_${C.dayKey(now())}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('#io-msg').textContent = '書き出しました。新しい端末で「記録を読みこむ」から選んでください。';
  });
  $('#import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      state = C.importState(text);
      const lg = JSON.parse(text).vpLedger;
      delete state.vpLedger;
      if (lg && lg.version === 1 && lg.days) ledger = lg;
      save();
      $('#io-msg').textContent = '読みこみました。';
      renderSettings();
    } catch (err) {
      $('#io-msg').textContent = '読みこめませんでした：' + err.message + '。書き出したファイルを選んでください。';
    }
    e.target.value = '';
  });
  const dlg = $('#reset-dialog');
  $('#reset').addEventListener('click', () => dlg.showModal());
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'reset') {
      state = C.newState(); ledger = V.newLedger(); save();
      $('#io-msg').textContent = '記録を消しました。';
      renderSettings();
    }
    dlg.returnValue = '';
  });

  // テスト用：今の問題・記録・時間の倍率
  window.VocabApp = { get state() { return state; }, get ledger() { return ledger; }, get current() { return current; }, ROUND };
  show('home');
  $('#start').focus();
})();
