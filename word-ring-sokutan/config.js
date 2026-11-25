// アプリごとの設定（Word Ring 速単版）。しくみ（core.js・app.js ほか）は教科書版と共通
// 公開用の写しでは、このファイルが config.js に、decks/sokutan.js が deck.js になる（tools/vocab_srs/publish_word_ring.py）
// 仕様：dev/projects/vocab-srs/multi-deck-plan.md（2026-11-25 先生：アプリは2つ・しくみは共通・レッスンは生徒が選ぶ）
window.WR_CONFIG = {
  id: 'sokutan',
  name: 'Word Ring',
  sub: '速単の単語',
  unit: 'Lesson',
  units: [63, 64, 65, 66, 67, 68, 69, 70, 71],   // Stage 7（いま学習中）。データのないものは「準備中」
  keys: { state: 'wordring-sokutan-v1', ledger: 'wordring-sokutan-vp-v1', home: 'wordring-sokutan-home-v1' },
  legacy: {},
};
