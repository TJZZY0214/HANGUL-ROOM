// js/hangul.js 的 Unicode 組合測試（node scripts/test_hangul.js）
// 獨立驗證：用 JavaScript 引擎內建的 Unicode 正規化（NFD）檢查公式，
// 不是拿同一份公式自己對自己。
const assert = require('assert');
const H = require('../js/hangul.js');

let n = 0;
function ok(cond, msg) { n++; assert.ok(cond, msg); }

// 1. 表長度
ok(H.CHOSEONG.length === 19 && H.JUNGSEONG.length === 21 && H.JONGSEONG.length === 28, '索引表長度');

// 2. 全部 19×21×28 = 11172 個音節：NFD 後必須等於 L(0x1100+l) V(0x1161+v) [T(0x11A7+t)]
let count = 0;
for (let l = 0; l < 19; l++) {
  for (let v = 0; v < 21; v++) {
    for (let t = 0; t < 28; t++) {
      const s = H.compose(l, v, t);
      const expect = [0x1100 + l, 0x1161 + v].concat(t > 0 ? [0x11A7 + t] : []);
      const got = Array.from(s.normalize('NFD')).map(c => c.codePointAt(0));
      assert.deepStrictEqual(got, expect, `compose(${l},${v},${t}) = ${s}`);
      const d = H.decompose(s);
      assert.strictEqual(d.l, l); assert.strictEqual(d.v, v); assert.strictEqual(d.t, t);
      count++;
    }
  }
}
ok(count === 11172, '音節總數 11172');

// 3. 已知範例（Wiki 第 1、5 章）
const known = [['ㅎ', 'ㅏ', 'ㄴ', '한'], ['ㅁ', 'ㅜ', 'ㄹ', '물'], ['ㅂ', 'ㅏ', 'ㅂ', '밥'], ['ㅈ', 'ㅣ', 'ㅂ', '집'], ['ㅊ', 'ㅐ', 'ㄱ', '책'], ['ㅇ', 'ㅏ', '', '아'], ['ㄱ', 'ㅏ', 'ㅄ', '값'], ['ㄷ', 'ㅏ', 'ㄺ', '닭']];
for (const [l, v, t, want] of known) ok(H.composeJamo(l, v, t) === want, `${l}${v}${t} → ${want}`);

// 4. 邊界與錯誤處理
ok(H.compose(0, 0, 0) === '가', '第一個音節 가');
ok(H.compose(18, 20, 27) === '힣', '最後一個音節 힣 (U+D7A3)');
ok(H.compose(18, 20, 27).charCodeAt(0) === 0xD7A3, 'U+D7A3');
assert.throws(() => H.compose(19, 0, 0), RangeError); n++;
assert.throws(() => H.compose(0, 21, 0), RangeError); n++;
assert.throws(() => H.compose(0, 0, 28), RangeError); n++;
assert.throws(() => H.compose(-1, 0, 0), RangeError); n++;
assert.throws(() => H.compose(1.5, 0, 0), RangeError); n++;
ok(H.composeJamo('A', 'ㅏ', '') === null, '不是韓文字母時回傳 null');
ok(H.decompose('A') === null && H.decompose('') === null && H.decompose('한글') === null, '非音節不拆解');

// 5. 終聲：16 個單子音 + 11 個雙子音（對照 S1）
const singles = 'ㄱㄲㄴㄷㄹㅁㅂㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
const finals = H.JONGSEONG.slice(1);
ok(finals.length === 27 && finals.filter(x => singles.includes(x)).length === 16, '終聲 16＋11');

// 6. 收音提示只包含 Wiki 有來源的項目
ok(H.finalHint('ㅅ').kind === 'sourced' && H.finalHint('ㄺ').kind === 'sourced', 'S8 項目有提示');
ok(H.finalHint('ㅎ').kind === 'missing', 'ㅎ 收音：待補來源，不給讀法');
ok(H.finalHint('ㄶ').kind === 'missing' && H.finalHint('ㅀ').kind === 'missing', 'ㄶ ㅀ：待補來源');
ok(H.finalHint('').kind === 'none', '無終聲');
ok(!/ㅎ.*讀 \[/.test(H.finalHint('ㅎ').text), 'ㅎ 的提示不含讀法');

console.log(`hangul.js 測試通過：${n} 項斷言，另含 11172 個音節的 NFD 對照`);
