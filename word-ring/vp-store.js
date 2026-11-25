// VP のつなぎ役（ブラウザ用）：練習の記録（core.js の FSRS）と P の記録を、この端末に読み書きする
// 先に deck.js・core.js・vp.js を読みこんでおく。記録はこの端末だけ（先生には送らない）
(function () {
  'use strict';
  const C = window.VocabCore, V = window.VP;
  const STATE_KEY = window.WR.keys.state;   // アプリごとの記録（config.js・book.js）
  const LEDGER_KEY = window.WR.keys.ledger;

  function loadState() {
    try { const t = localStorage.getItem(STATE_KEY); if (t) return C.importState(t); } catch (e) { /* こわれていたら新しく */ }
    return C.newState();
  }
  function loadLedger() {
    try { const o = JSON.parse(localStorage.getItem(LEDGER_KEY) || 'null'); if (o && o.version === 1 && o.days) return o; } catch (e) { /* 新しく */ }
    return V.newLedger();
  }
  const save = (k, v) => { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) { /* 保存できない端末 */ } };

  // 1回答えた：練習の記録（次に出す日）を進め、正解なら P を足す。もどり値 { p: 足した点, v: いまの V }
  function record({ noteId, type, correct, retry, ms }) {
    const now = Date.now(), state = loadState(), lg = loadLedger();
    const card = { id: `${noteId}:${type}`, noteId, type };
    C.answer(state, card, correct ? 3 : 1, now, ms || 0);
    const p = V.awardP(lg, card.id, now, { correct, retry });
    const v = V.computeV(state.cards, now, state.sorted, DECK);
    V.recordV(lg, now, v);
    save(STATE_KEY, C.exportState(state)); save(LEDGER_KEY, lg);
    return { p, v };
  }
  function dailyDone() {
    const now = Date.now(), lg = loadLedger();
    const p = V.awardDailyDone(lg, now); save(LEDGER_KEY, lg); return p;
  }
  // 画面に出す数をまとめて
  function snapshot() {
    const now = Date.now(), state = loadState(), lg = loadLedger();
    const v = V.computeV(state.cards, now, state.sorted, DECK);
    const c = C.counts(DECK, state, now);
    return {
      now, v, level: V.level(v), maxV: V.maxV(DECK), recall: V.recallable(DECK, state.cards, now, state.sorted), all: DECK.notes.length,
      week: V.week(lg, now, v), nick: lg.nick, fresh: c.fresh, review: c.review + c.learning,
      weak: DECK.notes.filter((n) => C.noteStatus(DECK, state, n.id) === 'leech').length, stars: (state.stars || []).length,
    };
  }
  // 練習1回ぶん（試合1試合）を数える（仕分けずみの語の抜き打ちは 10回後）
  function bumpSession() { const st = loadState(); st.sessions = (st.sessions || 0) + 1; save(STATE_KEY, C.exportState(st)); }
  function setNick(nick) { const lg = loadLedger(); lg.nick = String(nick || '').trim().slice(0, 16); save(LEDGER_KEY, lg); return lg.nick; }

  window.VPStore = { loadState, loadLedger, bumpSession, record, dailyDone, snapshot, setNick, STATE_KEY, LEDGER_KEY };
})();
