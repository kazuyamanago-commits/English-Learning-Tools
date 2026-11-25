// アプリごとの設定（Word Ring 教科書版）。しくみ（core.js・app.js ほか）は速単版と共通。ちがうのはこのファイルと deck.js だけ
// 仕様：dev/projects/vocab-srs/multi-deck-plan.md（2026-11-25 先生：アプリは2つ・しくみは共通・レッスンは生徒が選ぶ）
window.WR_CONFIG = {
  id: 'textbook',
  name: 'Word Ring',
  sub: '教科書の単語',
  unit: 'Lesson',                 // 単位の呼び方
  units: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],   // 棚に並べる単位（データのないものは「準備中」）
  keys: { state: 'wordring-textbook-v1', ledger: 'wordring-textbook-vp-v1', home: 'wordring-textbook-home-v1' },
  // 前の試作の記録（あれば1回だけ引っこす）
  legacy: { state: 'vocab-srs-v0-L6', ledger: 'vocab-vp-v1', home: 'vocab-home-v1' },
};
