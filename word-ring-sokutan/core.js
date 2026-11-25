// 語彙練習アプリ：中核のロジック（画面なし・Node でもテストできる）
// FSRS は公開されている計算式（FSRS-5・既定の重み）を自前で書いたもの。外の部品は使わない。
(function (root) {
  'use strict';

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const DAY_START_HOUR = 4; // 1日の区切りは朝4時（Anki と同じ）

  // ---------- FSRS ----------
  const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
    0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
  const DECAY = -0.5;
  const FACTOR = 19 / 81;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  const fsrs = {
    initS: (g) => Math.max(W[g - 1], 0.1),
    initD: (g) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10),
    retrievability: (days, S) => Math.pow(1 + FACTOR * days / S, DECAY),
    intervalDays: (S, r) => (S / FACTOR) * (Math.pow(r, 1 / DECAY) - 1),
    nextD(D, g) {
      const d0easy = W[4] - Math.exp(W[5] * 3) + 1;
      const dp = D + (-W[6] * (g - 3)) * (10 - D) / 9;
      return clamp(W[7] * d0easy + (1 - W[7]) * dp, 1, 10);
    },
    recallS(D, S, R, g) {
      const hard = g === 2 ? W[15] : 1;
      const easy = g === 4 ? W[16] : 1;
      return S * (Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9]) *
        (Math.exp(W[10] * (1 - R)) - 1) * hard * easy + 1);
    },
    forgetS(D, S, R) {
      const s = W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R));
      return Math.min(s, S);
    },
    shortTermS: (S, g) => S * Math.exp(W[17] * (g - 3 + W[18])),
  };

  // ---------- 日付 ----------
  function dayStart(now) {
    const d = new Date(now - DAY_START_HOUR * HOUR);
    d.setHours(0, 0, 0, 0);
    return d.getTime() + DAY_START_HOUR * HOUR;
  }
  function dayKey(now) {
    const d = new Date(now - DAY_START_HOUR * HOUR);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // ---------- カード ----------
  // ③語→意味 → ①聞いて書く → ④例文の空所 → ②意味→語 の順に出していく（やさしい順）
  const TYPES = ['w2m', 'listen', 'cloze', 'm2w'];
  const TYPE_LABEL = { listen: '聞いて書く', m2w: '意味から書く', w2m: '意味を選ぶ', cloze: '例文の空所' };
  const PHRASE_TYPES = ['w2m', 'cloze']; // 語句は③④だけ（②は長すぎる・①は v0 では出さない）

  function buildCards(deck, enabled) {
    const out = [];
    deck.notes.forEach((n, ni) => {
      const types = n.kind === 'phrase' ? PHRASE_TYPES : TYPES;
      types.forEach((t) => {
        if (enabled && enabled[t] === false) return;
        out.push({ id: `${n.id}:${t}`, noteId: n.id, type: t, noteIndex: ni, typeIndex: TYPES.indexOf(t) });
      });
    });
    return out;
  }

  function defaultSettings() {
    return {
      newPerDay: 10,
      rate: 1.0,
      retention: 0.9,
      types: { listen: true, m2w: true, w2m: true, cloze: true },
      game: false, // 落ちてくるゲーム（制限時間つき）
    };
  }
  function newState() {
    return { version: 1, cards: {}, stars: [], log: [], settings: defaultSettings(), daily: { day: '', newCount: 0 } };
  }

  // ---------- 評価（自動） ----------
  // 1=Again 2=Hard 3=Good 4=Easy
  function gradeTyped({ correct, ms, len, hinted }) {
    if (!correct) return 1;
    if (hinted) return 2;
    if (ms > 9000 + 350 * len) return 2;
    if (ms < 2500 + 150 * len) return 4;
    return 3;
  }
  function gradeChoice({ firstCorrect, retryCorrect }) {
    if (firstCorrect) return 3;
    return retryCorrect ? 2 : 1;
  }
  // 書く問題の「ヒントつきでもう一度」：正解なら Hard、またまちがえたら Again
  const gradeRetry = (correct) => (correct ? 2 : 1);

  // 語句を読み上げる形に：[ ] の中と「 / 」のあとを落とす・( ) は外して中身を残す・A／B は残す
  function sayable(w) {
    return String(w).replace(/\s*\[[^\]]*\]/g, '').split(' / ')[0].replace(/[()]/g, '')
      .replace(/\s*\.\.\.\s*$/, '').replace(/\s+/g, ' ').trim();
  }
  // ヒント用：最初の文字＋のこりを下線（例：h_____）
  const letterHint = (a) => a.split(' ').map((w) => w[0] + '_'.repeat(Math.max(0, w.length - 1))).join(' ');

  // 落ちてくるゲームの制限時間（秒）
  function fallSeconds(type, len) {
    if (type === 'w2m') return 8;
    if (type === 'cloze') return 14 + 0.5 * len;
    return 10 + 0.5 * len;
  }

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[.,!?;:"]+$/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  const checkTyped = (input, answer) => normalize(input) === normalize(answer);

  // ---------- スケジュール ----------
  const LEARN_STEPS = [1 * MIN, 10 * MIN];
  const RELEARN_STEPS = [10 * MIN];
  const MAX_IVL = 365;
  const FIRST_IVL_MAX = 4;
  const LEECH_AGAINS = 1; // 1回でもまちがえたら「苦手」（2026-11-25 先生。前は4回）
  const WEAK_CLEAR = 2;   // 苦手から出るのは、まちがえたあと「別の日に2回続けて正解」（11/25 先生：3→2）
  const QUIZ_AFTER = 10;  // 仕分けずみの語は、練習 10回のあとに1回だけ抜き打ち（仕様 14章）

  function review(prev, g, now, settings) {
    const r = (settings && settings.retention) || 0.9;
    const cs = Object.assign({ state: 'new', step: 0, reps: 0, lapses: 0, agains: 0 }, prev || {});
    // 記憶の強さ（S）と難しさ（D）
    if (cs.S == null) {
      cs.S = fsrs.initS(g); cs.D = fsrs.initD(g);
    } else if (dayKey(cs.last) === dayKey(now)) {
      cs.S = fsrs.shortTermS(cs.S, g); cs.D = fsrs.nextD(cs.D, g);
    } else {
      const R = fsrs.retrievability(Math.max(0, (now - cs.last) / DAY), cs.S);
      cs.S = g === 1 ? fsrs.forgetS(cs.D, cs.S, R) : fsrs.recallS(cs.D, cs.S, R, g);
      cs.D = fsrs.nextD(cs.D, g);
    }
    const fromLearning = cs.state === 'new' || cs.state === 'learning';
    const graduate = (minDays) => {
      let ivl = Math.round(fsrs.intervalDays(cs.S, r));
      // はじめて卒業するカードは最大4日後（速く答えて Easy でも、いきなり2週間あけない）
      if (fromLearning) ivl = Math.min(ivl, FIRST_IVL_MAX);
      ivl = clamp(Math.max(ivl, minDays || 1), 1, MAX_IVL);
      cs.state = 'review'; cs.step = 0; cs.ivl = ivl;
      cs.due = dayStart(now) + ivl * DAY;
    };
    if (cs.state === 'new' || cs.state === 'learning') {
      cs.state = 'learning';
      if (g === 1) { cs.step = 0; cs.due = now + LEARN_STEPS[0]; }
      else if (g === 2) { cs.due = now + (cs.step === 0 ? (LEARN_STEPS[0] + LEARN_STEPS[1]) / 2 : LEARN_STEPS[cs.step]); }
      else if (g === 3) {
        cs.step += 1;
        if (cs.step >= LEARN_STEPS.length) graduate(1); else cs.due = now + LEARN_STEPS[cs.step];
      } else graduate(2);
    } else if (cs.state === 'review') {
      if (g === 1) { cs.lapses += 1; cs.state = 'relearning'; cs.step = 0; cs.due = now + RELEARN_STEPS[0]; }
      else {
        const prevIvl = cs.ivl || 1;
        graduate(g === 2 ? 1 : g === 3 ? prevIvl + 1 : prevIvl + 2);
        if (g === 2) { cs.ivl = clamp(Math.min(cs.ivl, Math.max(1, Math.round(prevIvl * 1.2))), 1, MAX_IVL); cs.due = dayStart(now) + cs.ivl * DAY; }
      }
    } else { // relearning
      if (g === 1 || g === 2) { cs.step = 0; cs.due = now + RELEARN_STEPS[0]; }
      else graduate(1);
    }
    if (g === 1) { cs.agains += 1; cs.weak = true; cs.okRun = 0; cs.okDay = ''; }
    else if (cs.weak && cs.okDay !== dayKey(now)) {   // 同じ日の正解は1回だけ数える
      cs.okRun = (cs.okRun || 0) + 1; cs.okDay = dayKey(now);
      if (cs.okRun >= WEAK_CLEAR) cs.weak = false;
    }
    cs.reps += 1;
    cs.last = now;
    cs.leech = !!cs.weak;
    return cs;
  }

  // 答えたことを state に記録する（state を書きかえる）
  function answer(state, card, g, now, ms) {
    const today = dayKey(now);
    if (state.daily.day !== today) state.daily = { day: today, newCount: 0 };
    const prev = state.cards[card.id];
    if (!prev) state.daily.newCount += 1;
    state.cards[card.id] = review(prev, g, now, state.settings);
    state.log.push({ t: now, c: card.id, g, ms: Math.round(ms || 0) });
    return state.cards[card.id];
  }

  function notesTouchedToday(state, now) {
    const today = dayKey(now);
    const set = new Set();
    for (const [id, cs] of Object.entries(state.cards)) {
      if (cs.last != null && dayKey(cs.last) === today) set.add(id.split(':')[0]);
    }
    return set;
  }

  // ---------- 仕分け（入門モード・仕様 14章） ----------
  // state.sorted = { noteId: { at: 仕分けたときの練習回数, day } }・state.sessions＝練習した回数（カード1回・試合1試合）
  const isSorted = (state, noteId) => !!(state.sorted && state.sorted[noteId]);
  const noteMissed = (state, noteId) => Object.entries(state.cards).some(([id, cs]) => id.startsWith(noteId + ':') && cs.agains > 0);
  // 仕分けで出してよい語：まだ仕分けていない・一度もまちがえていない
  function sortCandidates(deck, state, noteIds) {
    const ids = noteIds ? new Set(noteIds) : null;
    return deck.notes.filter((n) => (!ids || ids.has(n.id)) && !isSorted(state, n.id) && !noteMissed(state, n.id)).map((n) => n.id);
  }
  // 仕分けの次の1問：語も種類もランダム（prog＝{ noteId: { types: [...], typed } }・out＝この回で外れた語）
  function pickSort(deck, state, opts, rnd) {
    rnd = rnd || Math.random;
    const prog = opts.prog || {}, out = opts.out || new Set();
    const cards = buildCards(deck, state.settings.types);
    const ids = sortCandidates(deck, state, opts.noteIds).filter((id) => !out.has(id) && id !== opts.last);
    const pool = [];
    for (const id of ids) {
      const done = (prog[id] && prog[id].types) || [];
      for (const c of cards) if (c.noteId === id && !done.includes(c.type)) pool.push(c);
    }
    if (!pool.length) return null;
    return { card: pool[Math.floor(rnd() * pool.length)], queue: 'sort' };
  }
  const TYPED = new Set(['listen', 'cloze', 'm2w']);
  // 仕分けで1問答えた。もどり値：'sorted'（仕分けずみ）／'progress'（あと1種類）／'out'（まちがい → ふつうの練習へ）
  function sortAnswer(state, prog, card, correct, now) {
    if (!correct) return 'out';
    const p = prog[card.noteId] = prog[card.noteId] || { types: [], typed: false };
    if (!p.types.includes(card.type)) p.types.push(card.type);
    if (TYPED.has(card.type)) p.typed = true;
    if (p.types.length >= 2 && p.typed) {
      state.sorted = state.sorted || {};
      state.sorted[card.noteId] = { at: state.sessions || 0, day: dayKey(now) };
      return 'sorted';
    }
    return 'progress';
  }
  // 抜き打ち：練習 10回たった仕分けずみの語（書く問題で1回）
  function quizDue(deck, state, now, lessons) {
    if (!state.sorted) return null;
    const touched = notesTouchedToday(state, now);
    for (const [id, v] of Object.entries(state.sorted)) {
      if ((state.sessions || 0) - v.at < QUIZ_AFTER || touched.has(id)) continue;
      const n = deck.notes.find((x) => x.id === id);
      if (!n || (lessons && !lessons.includes(n.lesson))) continue;
      const type = n.kind === 'phrase' ? 'cloze' : 'm2w';
      return { card: { id: `${id}:${type}`, noteId: id, type, noteIndex: deck.notes.indexOf(n), typeIndex: TYPES.indexOf(type) }, queue: 'quiz' };
    }
    return null;
  }
  // 抜き打ちの結果：正解 → また 10回後／まちがい → 仕分けを外して練習にもどす
  function quizAnswer(state, noteId, correct) {
    if (!state.sorted || !state.sorted[noteId]) return;
    if (correct) state.sorted[noteId].at = state.sessions || 0; else delete state.sorted[noteId];
  }

  const inLessons = (deck, c, lessons) => !lessons || lessons.includes(deck.notes[c.noteIndex].lesson);

  // ③（意味を選ぶ）を一度卒業した語か（打ちこみの問題を出してよいか）
  function graduated(state, noteId) {
    const cs = state.cards[`${noteId}:w2m`];
    return !!cs && (cs.state === 'review' || cs.state === 'relearning');
  }

  // 次に出すカードを選ぶ
  // opts.mode: 'normal'（今日の練習）／'focus'（苦手語・★：opts.noteIds の語だけ・日付に関係なく）
  function pickNext(deck, state, now, opts) {
    opts = opts || {};
    // 仕分けずみの語は出さない（苦手・★をえらんだときは出す）
    const cards = buildCards(deck, state.settings.types).filter((c) => !(opts.mode !== 'focus' || opts.skipSorted) || !isSorted(state, c.noteId));
    const learnAheadMs = 20 * MIN;
    if (opts.mode === 'focus') {
      const ids = new Set(opts.noteIds || []);
      const seen = opts.seen || new Set();
      // 新しい語は③（意味を選ぶ）から。③を卒業した語だけ ①②④ を出す（仕様 13章）
      const cand = cards.filter((c) => ids.has(c.noteId) && !seen.has(c.id) && (c.type === 'w2m' || graduated(state, c.noteId)));
      cand.sort((a, b) => ((state.cards[a.id] || {}).last || 0) - ((state.cards[b.id] || {}).last || 0) || a.typeIndex - b.typeIndex);
      return cand.length ? { card: cand[0], queue: 'focus' } : null;
    }
    const touched = notesTouchedToday(state, now);
    const learning = [], reviews = [], fresh = [], ahead = [];
    for (const c of cards) {
      if (!inLessons(deck, c, opts.lessons)) continue;   // えらんだレッスンだけ（11/25 先生：ほかのレッスンの復習はホームで知らせる）
      const cs = state.cards[c.id];
      if (!cs) { fresh.push(c); continue; }
      if (cs.state === 'learning' || cs.state === 'relearning') {
        if (cs.due <= now) learning.push(c); else if (cs.due <= now + learnAheadMs) ahead.push(c);
      } else if (cs.state === 'review' && cs.due <= now && !touched.has(c.noteId)) reviews.push(c);
    }
    const byDue = (a, b) => state.cards[a.id].due - state.cards[b.id].due;
    if (learning.length) return { card: learning.sort(byDue)[0], queue: 'learning' };
    if (reviews.length) return { card: reviews.sort(byDue)[0], queue: 'review' };
    const quiz = quizDue(deck, state, now, opts.lessons);
    if (quiz) return quiz;
    const today = dayKey(now);
    const used = state.daily.day === today ? state.daily.newCount : 0;
    if (used < state.settings.newPerDay) {
      // 同じ語の前の種類のカードを、前の日までに見ていること（兄弟カードは同じ日に出さない）
      const ok = fresh.filter((c) => {
        if (touched.has(c.noteId)) return false;
        const sibs = cards.filter((s) => s.noteId === c.noteId && s.typeIndex < c.typeIndex);
        return sibs.every((s) => state.cards[s.id]);
      });
      // まだ一度も出ていない語（③）を先に（11/25 先生「まだ出してないものを優先」）→ そのあと、出たことのある語の ①②④
      ok.sort((a, b) => (a.typeIndex === 0 ? 0 : 1) - (b.typeIndex === 0 ? 0 : 1) || a.noteIndex - b.noteIndex || a.typeIndex - b.typeIndex);
      if (ok.length) return { card: ok[0], queue: 'new' };
    }
    if (ahead.length) return { card: ahead.sort(byDue)[0], queue: 'learning' };
    return null;
  }

  // えらんでいないレッスンで、期限が来ている復習・練習中の語の数（レッスンごと）。{ 6: 5 } のように返す
  function waitingElsewhere(deck, state, now, lessons) {
    const out = {};
    if (!lessons) return out;
    const touched = notesTouchedToday(state, now);
    const seen = new Set();
    for (const c of buildCards(deck, state.settings.types)) {
      const cs = state.cards[c.id], l = deck.notes[c.noteIndex].lesson;
      if (!cs || lessons.includes(l) || isSorted(state, c.noteId) || seen.has(c.noteId)) continue;
      const due = (cs.state === 'learning' || cs.state === 'relearning') ? cs.due <= now : cs.due <= now && !touched.has(c.noteId);
      if (due) { out[l] = (out[l] || 0) + 1; seen.add(c.noteId); }
    }
    return out;
  }

  function counts(deck, state, now, lessons) {
    const cards = buildCards(deck, state.settings.types).filter((c) => !isSorted(state, c.noteId));
    const touched = notesTouchedToday(state, now);
    let learning = 0, reviewDue = 0, later = null;
    for (const c of cards) {
      const cs = state.cards[c.id];
      if (!cs || !inLessons(deck, c, lessons)) continue;
      if (cs.state === 'learning' || cs.state === 'relearning') {
        if (cs.due <= now) learning++; else later = later == null ? cs.due : Math.min(later, cs.due);
      } else if (cs.due <= now && !touched.has(c.noteId)) reviewDue++;
    }
    const today = dayKey(now);
    const used = state.daily.day === today ? state.daily.newCount : 0;
    const left = Math.max(0, state.settings.newPerDay - used);
    // 今日出せる新しいカード（各語の次の1枚だけ）
    let freshAvail = 0;
    const seenNote = new Set();
    for (const c of cards) {
      if (state.cards[c.id] || touched.has(c.noteId) || seenNote.has(c.noteId) || !inLessons(deck, c, lessons)) continue;
      const sibs = cards.filter((s) => s.noteId === c.noteId && s.typeIndex < c.typeIndex);
      if (sibs.every((s) => state.cards[s.id])) { freshAvail++; seenNote.add(c.noteId); }
    }
    return { learning, review: reviewDue, fresh: Math.min(left, freshAvail), nextLearningAt: later };
  }

  // 語ごとのようす：new（まだ）／learning（練習中）／known（覚えた）／leech（苦手）
  function noteStatus(deck, state, noteId) {
    const cards = buildCards(deck, state.settings.types).filter((c) => c.noteId === noteId);
    const st = cards.map((c) => state.cards[c.id]).filter(Boolean);
    if (st.some((cs) => cs.leech)) return 'leech';
    if (isSorted(state, noteId)) return 'known';
    if (!st.length) return 'new';
    if (st.length === cards.length && st.every((cs) => cs.state === 'review' && cs.ivl >= 7)) return 'known';
    return 'learning';
  }

  function stats(deck, state, now) {
    const status = { new: 0, learning: 0, known: 0, leech: 0 };
    deck.notes.forEach((n) => { status[noteStatus(deck, state, n.id)]++; });
    const today = dayKey(now);
    const todayLog = state.log.filter((l) => dayKey(l.t) === today);
    const total = state.log.length;
    const correct = state.log.filter((l) => l.g > 1).length;
    const days = new Set(state.log.map((l) => dayKey(l.t)));
    let streak = 0;
    let t = now;
    if (!days.has(dayKey(t))) t -= DAY; // 今日まだでも、昨日まで続いていれば数える
    while (days.has(dayKey(t))) { streak++; t -= DAY; }
    return {
      status,
      todayCount: todayLog.length,
      accuracy: total ? Math.round((correct / total) * 100) : null,
      streak,
    };
  }

  function exportState(state) { return JSON.stringify(state); }
  function importState(text) {
    const s = JSON.parse(text);
    if (!s || s.version !== 1 || typeof s.cards !== 'object' || !Array.isArray(s.log)) {
      throw new Error('このアプリの記録ファイルではありません');
    }
    const base = newState();
    return Object.assign(base, s, { settings: Object.assign(defaultSettings(), s.settings || {}) });
  }

  const api = {
    MIN, HOUR, DAY, TYPES, TYPE_LABEL, LEECH_AGAINS, fsrs, dayKey, dayStart, buildCards,
    newState, defaultSettings, gradeTyped, gradeChoice, gradeRetry, sayable, letterHint, fallSeconds, normalize, checkTyped, review, answer,
    WEAK_CLEAR, QUIZ_AFTER, isSorted, sortCandidates, pickSort, sortAnswer, quizDue, quizAnswer,
    pickNext, graduated, counts, waitingElsewhere, noteStatus, stats, exportState, importState,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VocabCore = api;
})(typeof window !== 'undefined' ? window : this);
