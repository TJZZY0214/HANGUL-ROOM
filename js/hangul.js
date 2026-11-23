/* HANGUL ROOM — 韓文音節的 Unicode 組合與拆解
 *
 * 公式（Unicode 標準，Hangul Syllables 區塊）：
 *   code point = 0xAC00 + (初聲索引 × 21 + 中聲索引) × 28 + 終聲索引
 * 初聲 19 個、中聲 21 個、終聲 28 個（索引 0 代表沒有終聲）。
 * 注意：這是技術實作；教學說明仍須遵守 Wiki 規則。
 */
(function (root) {
  'use strict';

  var CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  var JUNGSEONG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
  var JONGSEONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

  var BASE = 0xAC00;
  var LAST = 0xD7A3;

  function isInt(n, min, max) {
    return typeof n === 'number' && n % 1 === 0 && n >= min && n <= max;
  }

  /** 以索引組合音節。t 省略或 0 代表沒有終聲。 */
  function compose(l, v, t) {
    t = t || 0;
    if (!isInt(l, 0, 18) || !isInt(v, 0, 20) || !isInt(t, 0, 27)) {
      throw new RangeError('索引超出範圍：初聲 0–18、中聲 0–20、終聲 0–27');
    }
    return String.fromCharCode(BASE + (l * 21 + v) * 28 + t);
  }

  /** 以字母（相容字母，如 ㅎ ㅏ ㄴ）組合音節；找不到字母時回傳 null。 */
  function composeJamo(lJamo, vJamo, tJamo) {
    var l = CHOSEONG.indexOf(lJamo);
    var v = JUNGSEONG.indexOf(vJamo);
    var t = tJamo ? JONGSEONG.indexOf(tJamo) : 0;
    if (l < 0 || v < 0 || t < 0) return null;
    return compose(l, v, t);
  }

  /** 拆解音節，回傳索引與字母；不是韓文音節時回傳 null。 */
  function decompose(ch) {
    if (typeof ch !== 'string' || ch.length !== 1) return null;
    var code = ch.charCodeAt(0);
    if (code < BASE || code > LAST) return null;
    var c = code - BASE;
    var l = Math.floor(c / 588);
    var v = Math.floor((c % 588) / 28);
    var t = c % 28;
    return { l: l, v: v, t: t, lJamo: CHOSEONG[l], vJamo: JUNGSEONG[v], tJamo: JONGSEONG[t], code: code };
  }

  /** 收音讀法提示：只收 Wiki 第 4 章（S8）已有的項目；其餘回傳 null。 */
  var SEVEN = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅇ'];
  var FINAL_HINTS = {
    'ㄲ': { text: '讀 [ㄱ]（例：밖、닦다）', src: 'S8' },
    'ㅋ': { text: '讀 [ㄱ]（例：부엌、남녘）', src: 'S8' },
    'ㅅ': { text: '讀 [ㄷ]（빗、빚、빛 在子音前都是 [빋]）', src: 'S8' },
    'ㅆ': { text: '讀 [ㄷ]（例：있다→[읻따]）', src: 'S8' },
    'ㅈ': { text: '讀 [ㄷ]（빚 在子音前是 [빋]）', src: 'S8' },
    'ㅊ': { text: '讀 [ㄷ]（빛 在子音前是 [빋]）', src: 'S8' },
    'ㅌ': { text: '讀 [ㄷ]（例：밭도→[받또]）', src: 'S8' },
    'ㅍ': { text: '讀 [ㅂ]（例：앞、무릎）', src: 'S8' },
    'ㄳ': { text: '雙收音：發前一個音（例：넋→[넉]）', src: 'S8' },
    'ㄵ': { text: '雙收音：發前一個音（例：앉다→[안따]）', src: 'S8' },
    'ㄼ': { text: '雙收音：通常發前一個音（例：여덟→[여덜]）；밟다 是例外，讀 [ㅂ]', src: 'S8' },
    'ㄽ': { text: '雙收音：發前一個音', src: 'S8' },
    'ㄾ': { text: '雙收音：發前一個音（例：핥다→[할따]）', src: 'S8' },
    'ㅄ': { text: '雙收音：發前一個音（例：값→[갑]）', src: 'S8' },
    'ㄺ': { text: '雙收音：發後一個音（例：닭→[닥]）；動詞、形容詞語幹的 ㄺ 在 ㄱ 前讀 [ㄹ]（例：맑게→[말께]）', src: 'S8' },
    'ㄻ': { text: '雙收音：發後一個音（例：삶→[삼]）', src: 'S8' },
    'ㄿ': { text: '雙收音：發後一個音（例：읊다→[읍따]）', src: 'S8' }
  };

  function finalHint(tJamo) {
    if (!tJamo) return { kind: 'none', text: '沒有終聲。' };
    if (FINAL_HINTS[tJamo]) return { kind: 'sourced', text: FINAL_HINTS[tJamo].text, src: FINAL_HINTS[tJamo].src };
    if (SEVEN.indexOf(tJamo) >= 0) return { kind: 'seven', text: '屬於收音的七種代表音之一（ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅇ）', src: 'S8' };
    return { kind: 'missing', text: 'Wiki 尚無這個收音的讀法說明（待補來源），本教材不講解。' };
  }

  var api = {
    CHOSEONG: CHOSEONG,
    JUNGSEONG: JUNGSEONG,
    JONGSEONG: JONGSEONG,
    BASE: BASE,
    compose: compose,
    composeJamo: composeJamo,
    decompose: decompose,
    finalHint: finalHint
  };

  root.Hangul = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
