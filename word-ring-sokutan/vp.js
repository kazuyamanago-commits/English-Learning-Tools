// VP（Vocabulary / Perseverance）の計算とランキング（画面なし・Node でもテストできる）
// 仕様：dev/projects/vocab-srs/vocab-power.md（v0.2・2026-11-25 先生承認）
//   V（語彙）＝ すべてのカードの（最大点 × いま思い出せる確率）の合計 × 10。覚えると増え、さぼると減る
//   P（ねばり）＝ 今週、正しく思い出した量。同じカードは1日1回・再挑戦は0・月曜0時にリセット
(function (root) {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;

  // ---------- 点の重さ（仮：先生「試してみないとわからない」→ ここだけ変えれば全部に効く） ----------
  const CONFIG = {
    vMax: { w2m: 2, listen: 3, cloze: 3, m2w: 4 },   // V：カード1枚の最大点（×10 して表示）
    vScale: 10,
    pPoint: { w2m: 1, listen: 2, cloze: 2, m2w: 3 }, // P：正解1回の点
    pDailyDone: 5,                                    // 「今日の分」を最後までやった（1日1回）
    pDayCap: 300,                                     // 1日の上限（目立つずるだけ止める）
    // スタジアムの遊び方 → どのカードとして数えるか（まずは同じ表で・試して決める）
    stadiumType: { choice: "w2m", spell: "m2w", dict: "listen", clause: "cloze" },
    levels: [[0, 'ルーキー'], [500, 'レギュラー'], [1500, 'エース'], [3000, 'キャプテン'], [6000, 'レジェンド']],
    recallR: 0.9,                                     // 「思い出せる語」：意味を選ぶカードが卒業ずみで、思い出せる確率がこれ以上
  };

  // ---------- 日付（P は月曜0時で区切る） ----------
  const pad = (n) => String(n).padStart(2, '0');
  const dayOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  function weekStart(t) {                 // その週の月曜 0:00
    const d = new Date(t); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  }
  function weekKey(t) {                   // ISO 週番号（例 2026-W48）
    const d = new Date(weekStart(t) + 3 * DAY);  // その週の木曜
    const y = d.getFullYear(), jan4 = new Date(y, 0, 4);
    const w = 1 + Math.round((weekStart(d.getTime()) - weekStart(jan4.getTime())) / (7 * DAY));
    return `${y}-W${pad(w)}`;
  }
  const weekDays = (t) => Array.from({ length: 7 }, (_, k) => dayOf(weekStart(t) + k * DAY + 12 * 3600 * 1000));

  // ---------- V（語彙） ----------
  const R = (cs, now) => Math.pow(1 + (19 / 81) * Math.max(0, (now - cs.last) / DAY) / cs.S, -0.5);  // core.js の FSRS と同じ式
  // 数えるのは卒業したカード（state=review）だけ。答えた直後の「思い出せる確率」は 1 なので、練習中のカードまで数えると、まちがえても V が増えてしまう
  // sorted（仕分けずみの語）は満点で固定（出さないので減らさない・仕様 14章）。deck があれば語句の種類も正しく数える
  function computeV(cards, now, sorted, deck) {
    let sum = 0;
    const isS = (id) => !!(sorted && sorted[id.split(':')[0]]);
    if (sorted) for (const nid of Object.keys(sorted)) {
      const n = deck && deck.notes.find((x) => x.id === nid);
      for (const t of n && n.kind === 'phrase' ? ['w2m', 'cloze'] : ['w2m', 'listen', 'cloze', 'm2w']) sum += CONFIG.vMax[t];
    }
    for (const [id, cs] of Object.entries(cards || {})) {
      if (isS(id) || !cs || cs.state !== 'review' || cs.S == null || cs.last == null) continue;
      const max = CONFIG.vMax[id.split(':')[1]];
      if (max) sum += max * R(cs, now);
    }
    return Math.floor(sum * CONFIG.vScale);
  }
  function maxV(deck) {
    let sum = 0;
    for (const n of deck.notes) for (const t of n.kind === 'phrase' ? ['w2m', 'cloze'] : ['w2m', 'listen', 'cloze', 'm2w']) sum += CONFIG.vMax[t];
    return sum * CONFIG.vScale;
  }
  function recallable(deck, cards, now, sorted) {   // 思い出せる語の数（ホームの主役の数字）。仕分けずみの語もふくむ
    let n = 0;
    for (const note of deck.notes) {
      if (sorted && sorted[note.id]) { n++; continue; }
      const cs = cards && cards[`${note.id}:w2m`];
      if (cs && cs.state === 'review' && cs.S != null && R(cs, now) >= CONFIG.recallR) n++;
    }
    return n;
  }
  function level(v) {
    let cur = CONFIG.levels[0], next = null;
    for (let k = 0; k < CONFIG.levels.length; k++) if (v >= CONFIG.levels[k][0]) { cur = CONFIG.levels[k]; next = CONFIG.levels[k + 1] || null; }
    return { name: cur[1], from: cur[0], next: next && { name: next[1], at: next[0] } };
  }

  // ---------- P（ねばり）：1日ごとのまとめ（ledger） ----------
  const newLedger = () => ({ version: 1, nick: '', days: {} });
  const dayRec = (lg, t) => (lg.days[dayOf(t)] = lg.days[dayOf(t)] || { p: 0, v: null, done: false, got: [] });
  // 正解1回ぶんの P を足す。もどり値＝足した点（0 のこともある）
  function awardP(lg, cardId, now, opts) {
    opts = opts || {};
    if (!opts.correct || opts.retry) return 0;
    const d = dayRec(lg, now);
    if (d.got.includes(cardId)) return 0;           // 同じカードは1日1回
    const pts = CONFIG.pPoint[cardId.split(':')[1]] || 0;
    const add = Math.max(0, Math.min(pts, CONFIG.pDayCap - d.p));
    d.got.push(cardId); d.p += add;
    return add;
  }
  function awardDailyDone(lg, now) {
    const d = dayRec(lg, now);
    if (d.done) return 0;
    d.done = true;
    const add = Math.max(0, Math.min(CONFIG.pDailyDone, CONFIG.pDayCap - d.p));
    d.p += add; return add;
  }
  function recordV(lg, now, v) { dayRec(lg, now).v = v; }
  // 今週のまとめ：P・やった日（月〜日）・V の伸び（先週の最後の V から）
  function week(lg, now, vNow) {
    const days = weekDays(now), ws = weekStart(now);
    let p = 0;
    const active = days.map((k) => { const d = lg.days[k]; if (d) p += d.p; return !!(d && (d.p > 0 || d.got.length)); });
    let vBefore = 0, best = '';
    for (const [k, d] of Object.entries(lg.days)) if (k < dayOf(ws) && d.v != null && k > best) { best = k; vBefore = d.v; }
    return { week: weekKey(now), p, active, days: active.filter(Boolean).length, vGain: Math.max(0, (vNow == null ? 0 : vNow) - vBefore) };
  }
  // 送るときの形（のちに。今は送らない）：答えの中身・名前・出席番号は入れない
  const toSend = (lg, now, vNow, cls) => { const w = week(lg, now, vNow); return { week: w.week, nick: lg.nick, class: cls || '', v: vNow, p: w.p, vGain: w.vGain, days: w.days }; };

  // ---------- 架空の相手（試作）：週と番号で決まる（開くたびに変わらない） ----------
  const A = ['Brave', 'Lucky', 'Quiet', 'Swift', 'Sunny', 'Misty', 'Clever', 'Happy', 'Silver', 'Golden', 'Rainy', 'Windy', 'Little', 'Mighty', 'Snowy'];
  const B = ['Fox', 'Owl', 'Panda', 'Tiger', 'Otter', 'Hawk', 'Koala', 'Wolf', 'Dolphin', 'Rabbit', 'Bear', 'Falcon', 'Penguin', 'Lion', 'Deer'];
  function rng(seed) {                    // 小さな乱数（同じ seed なら同じ並び）
    let h = 2166136261;
    for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h += 0x6D2B79F5; let x = h; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  }
  function rivals(now, n) {
    n = n || 29;
    const wk = weekKey(now), today = Math.min(6, Math.floor((now - weekStart(now)) / DAY));  // 0＝月曜
    const names = rng('names'), out = [], used = new Set();
    for (let k = 0; k < n; k++) {
      let nick; do { nick = A[Math.floor(names() * A.length)] + B[Math.floor(names() * B.length)]; } while (used.has(nick)); used.add(nick);
      const me = rng(nick);                                          // その人の性格（週がかわっても同じ）
      const kind = me() < .2 ? 'strong' : me() < .6 ? 'normal' : 'slow';
      const vBase = Math.floor((kind === 'strong' ? 1800 : kind === 'normal' ? 700 : 200) * (.6 + me() * .8));
      const wr = rng(nick + wk);                                       // その週の調子
      const rate = kind === 'strong' ? .85 : kind === 'normal' ? .6 : .3;
      const active = Array.from({ length: 7 }, (_, d) => d <= today && wr() < rate);
      const perDay = (kind === 'strong' ? 40 : kind === 'normal' ? 28 : 18) * (.7 + wr() * .6);
      const days = active.filter(Boolean).length;
      const p = Math.round(days * perDay);
      const vGain = Math.round(days * perDay * (1.5 + wr()));
      out.push({ nick, p, days, active, v: vBase + vGain, vGain, rival: true });
    }
    return out;
  }

  // ---------- ランキング：上位10名＋自分 ----------
  function board(entries, key, top) {
    top = top || 10;
    const sorted = entries.slice().sort((a, b) => b[key] - a[key] || (a.me ? -1 : b.me ? 1 : a.nick.localeCompare(b.nick)));
    let rank = 0, prev = null;
    sorted.forEach((e, k) => { if (e[key] !== prev) { rank = k + 1; prev = e[key]; } e.rank = rank; });
    const head = sorted.slice(0, top), me = sorted.find((e) => e.me);
    return { rows: head, me: me && !head.includes(me) ? me : null, myRank: me ? me.rank : null, total: sorted.length };
  }
  function awards(entries) {
    const grew = entries.slice().sort((a, b) => b.vGain - a.vGain)[0];
    return { grew: grew && grew.vGain > 0 ? grew : null, seven: entries.filter((e) => e.days >= 7) };
  }

  const api = { CONFIG, DAY, dayOf, weekStart, weekKey, weekDays, computeV, maxV, recallable, level, newLedger, awardP, awardDailyDone, recordV, week, toSend, rivals, board, awards };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VP = api;
})(typeof window !== 'undefined' ? window : this);
