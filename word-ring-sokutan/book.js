// アプリ（教科書版／速単版）の共通のつなぎ：記録の名前・前の記録の引っこし・レッスンの選択
// 先に deck.js・config.js を読みこむ。画面のどのページ（index・stadium・ranking）でも使う
(function () {
  'use strict';
  const cfg = window.WR_CONFIG;
  const D = window.DECK;
  const K = cfg.keys;
  // 前の試作の記録を、このアプリの記録へ1回だけ引っこす（新しい記録がまだないときだけ）
  try {
    for (const k of Object.keys(cfg.legacy || {})) {
      const old = cfg.legacy[k], now = K[k];
      if (old && now && localStorage.getItem(now) == null && localStorage.getItem(old) != null) localStorage.setItem(now, localStorage.getItem(old));
    }
  } catch (e) { /* 保存できない端末 */ }

  // データのある単位（レッスン）
  const have = [...new Set(D.notes.map((n) => n.lesson))].sort((a, b) => a - b);
  function loadHome() { try { return JSON.parse(localStorage.getItem(K.home) || '{}'); } catch (e) { return {}; } }
  function saveHome(h) { try { localStorage.setItem(K.home, JSON.stringify(h)); } catch (e) { /* */ } }
  // 生徒がえらんだレッスン（はじめは、データのあるレッスンぜんぶ）
  function lessons(home) {
    const sel = ((home || loadHome()).lessons || []).filter((l) => have.includes(l));
    return sel.length ? sel : have.slice();
  }
  const label = (ls) => (ls.length === have.length && have.length > 1 ? `${cfg.unit} ${have.join('・')}`
    : `${cfg.unit} ${ls.join('・')}`);
  const noteIn = (ls) => { const s = new Set(ls); return (n) => s.has(n.lesson); };

  window.WR = { cfg, keys: K, have, loadHome, saveHome, lessons, label, noteIn };
})();
