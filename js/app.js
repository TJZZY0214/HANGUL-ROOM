/* HANGUL ROOM — 教學簡報主程式（純 HTML／CSS／JavaScript，無建置步驟）
 * 資料來源：data/slides.json、data/quiz.json、sources/sources.json、data/workflow.json
 * 所有教學內容皆由 Wiki 整理而來；每張投影片都標示 Wiki 檔案與來源 ID。 */
(function () {
  'use strict';

  var H = window.Hangul;
  var app = document.getElementById('app');
  var D = null;          // { slides, quiz, sources, workflow }
  var SRC = {};          // source_id -> source record
  var CH = {};           // chapter id -> chapter
  var SLIDES = [];       // flat list
  var current = { view: null, slideIndex: 0 };

  /* ------------------------------------------------------------------ 儲存（localStorage，失敗則用記憶體） */
  var memoryStore = {};
  var storageOK = (function () {
    try {
      var k = '__hangul_room_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();
  function sget(k) {
    try { if (storageOK) return window.localStorage.getItem(k); } catch (e) { storageOK = false; }
    return Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null;
  }
  function sset(k, v) {
    try { if (storageOK) { window.localStorage.setItem(k, v); return; } } catch (e) { storageOK = false; }
    memoryStore[k] = v;
  }

  var PROG_KEY = 'hangulRoom.progress.v1';
  var progress = (function () {
    var empty = { visited: {}, answers: {}, last: null };
    try {
      var raw = sget(PROG_KEY);
      if (!raw) return empty;
      var p = JSON.parse(raw);
      if (p && typeof p === 'object') return { visited: p.visited || {}, answers: p.answers || {}, last: p.last || null };
    } catch (e) { /* 損毀的資料就重新開始 */ }
    return empty;
  })();
  function saveProgress() { sset(PROG_KEY, JSON.stringify(progress)); }

  /* ------------------------------------------------------------------ 工具 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function go(path) { window.location.hash = '#/' + path; }
  var toastTimer = null;
  function toast(msg, ms) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 4800);
  }

  function chip(id, cross) {
    var s = SRC[id];
    var cls = 'chip';
    var title = id;
    if (s) {
      cls += s.status === 'success' ? ' ok' : (s.status === 'partial' ? ' part' : '');
      title = id + '｜' + s.title + '｜擷取：' + s.status + '｜人工核對：' + (s.verification ? s.verification.human_check : '?');
    }
    if (cross) cls += ' cross';
    return '<span class="' + cls + '" title="' + esc(title) + '">' + esc(id) + '</span>';
  }
  function chips(list, cross) { return '<span class="chips">' + (list || []).map(function (i) { return chip(i, cross); }).join('') + '</span>'; }

  /* ------------------------------------------------------------------ 語音（Web Speech API，ko-KR；不支援時安全降級） */
  var Speech = {
    supported: function () {
      try { return !!(window.speechSynthesis && typeof window.SpeechSynthesisUtterance !== 'undefined'); } catch (e) { return false; }
    },
    koVoice: function () {
      try {
        var vs = window.speechSynthesis.getVoices() || [];
        return { count: vs.length, voice: vs.filter(function (v) { return /^ko([-_]|$)/i.test(v.lang || ''); })[0] || null };
      } catch (e) { return { count: 0, voice: null }; }
    },
    say: function (text) {
      try {
        if (!text) return;
        if (!Speech.supported()) {
          toast('這個瀏覽器不支援語音播放（Web Speech API），但其他功能都可以正常使用。');
          return;
        }
        var info = Speech.koVoice();
        if (info.count > 0 && !info.voice) {
          toast('沒有偵測到韓文（ko-KR）語音，無法播放。可以在系統設定安裝韓文語音；其他功能不受影響。');
          return;
        }
        window.speechSynthesis.cancel();
        var u = new window.SpeechSynthesisUtterance(text);
        u.lang = 'ko-KR';
        u.rate = 0.9;
        try { if (info.voice) u.voice = info.voice; } catch (e) { /* 指定語音失敗時仍以 lang=ko-KR 播放 */ }
        u.onerror = function () { toast('語音播放失敗，可能是此裝置沒有可用的韓文語音。其他功能不受影響。'); };
        window.speechSynthesis.speak(u);
      } catch (e) {
        toast('語音播放發生問題，已安全略過。其他功能不受影響。');
      }
    }
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-say]') : null;
    if (b) { e.preventDefault(); Speech.say(b.getAttribute('data-say')); }
  });
  function speakBtn(text, label) {
    return '<button class="speak" type="button" data-say="' + esc(text) + '" aria-label="播放發音：' + esc(label || text) + '" title="播放韓文發音（瀏覽器合成語音）">🔊</button>';
  }

  /* ------------------------------------------------------------------ 進度與測驗統計 */
  function chapterStats() {
    return D.slides.chapters.map(function (c) {
      var list = SLIDES.filter(function (s) { return s.chapter === c.id; });
      var seen = list.filter(function (s) { return progress.visited[s.id]; }).length;
      return { id: c.id, total: list.length, seen: seen, done: list.length > 0 && seen === list.length };
    });
  }
  function scoreInfo() {
    var qs = D.quiz.questions;
    var answered = 0, correct = 0;
    qs.forEach(function (q) {
      var a = progress.answers[q.id];
      if (a) { answered++; if (a.ok) correct++; }
    });
    return { total: qs.length, answered: answered, correct: correct };
  }
  function updatePill() {
    var cs = chapterStats().filter(function (c) { return c.done; }).length;
    var sc = scoreInfo();
    var el = document.getElementById('topPill');
    if (el) el.textContent = '章節 ' + cs + '/6 · 測驗 ' + sc.correct + '/' + sc.total + (storageOK ? '' : ' · 記憶體模式');
  }

  /* ------------------------------------------------------------------ 載入資料 */
  function getJSON(url) {
    // 單檔版（hangul-room.html）會把資料內嵌在 window.__HANGUL_DATA__，優先使用，不需 fetch
    if (window.__HANGUL_DATA__ && window.__HANGUL_DATA__[url]) return Promise.resolve(window.__HANGUL_DATA__[url]);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return r.json();
    });
  }
  function showLoadError(err) {
    var isFile = location.protocol === 'file:';
    app.innerHTML = '<div class="loadfail"><h2>資料載入失敗</h2>' +
      '<p>' + esc(err && err.message ? err.message : err) + '</p>' +
      (isFile
        ? '<p>你是用 <b>file://</b> 直接開啟網頁。瀏覽器基於安全限制，通常不允許網頁讀取本機的 JSON 檔（fetch 會被擋下）。請改用本機 HTTP 伺服器：</p>'
        : '<p>請確認 data/、sources/ 資料夾與檔案都有一併上傳，且網址路徑正確。</p>') +
      '<pre>cd hangul-room\npython3 -m http.server 8000\n# 然後開啟 http://localhost:8000/</pre>' +
      '<p class="small-note">部署到 GitHub Pages 時是以 HTTP(S) 提供檔案，不會有這個問題。</p></div>';
  }

  /* ------------------------------------------------------------------ 路由 */
  function parseHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var p = h.split('/');
    return { view: p[0] || 'home', arg: p.slice(1).join('/') };
  }
  function route() {
    if (!D) return;
    var r = parseHash();
    var view = ['home', 'slides', 'quiz', 'knowledge'].indexOf(r.view) >= 0 ? r.view : 'home';
    current.view = view;
    $$('.nav button').forEach(function (b) {
      if (b.getAttribute('data-nav') === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
    if (view === 'home') renderHome();
    else if (view === 'slides') renderSlides(r.arg);
    else if (view === 'quiz') renderQuizView();
    else renderKnowledge();
    if (view !== 'slides') window.scrollTo(0, 0);
    updatePill();
  }

  /* ------------------------------------------------------------------ 首頁 */
  function renderHome() {
    var M = D.slides.meta;
    var cs = chapterStats();
    var doneN = cs.filter(function (c) { return c.done; }).length;
    var sc = scoreInfo();
    var last = progress.last && SLIDES.filter(function (s) { return s.id === progress.last; })[0];
    var html = '<div class="view">' +
      '<section class="hero"><div class="hero-deco" aria-hidden="true"><i>ㄱ</i><i>ㅏ</i><i>ㄴ</i><i>ㅓ</i></div>' +
      '<div class="hero-inner"><h1>HANGUL ROOM</h1>' +
      '<p class="tag">' + esc(M.tagline) + '</p>' +
      '<p class="sub">' + esc(M.subtitle) + '</p>' +
      '<div class="hero-actions"><button class="btn primary" id="startBtn">開始學習</button>' +
      (last ? '<button class="btn" id="resumeBtn">繼續：' + esc(last.title) + '</button>' : '') +
      '<button class="btn ghost" id="kwBtn">Knowledge &amp; Workflow</button></div></div></section>' +
      '<div class="container" style="padding-top:0">' +
      '<div class="section-title"><h2>學習進度</h2><small>' + (storageOK ? '儲存在這個瀏覽器（localStorage）' : '此瀏覽器無法儲存，改用記憶體；重新整理後會歸零') + '</small></div>' +
      '<div class="progress-card">' +
      '<div class="stat"><div class="num">' + doneN + ' / 6</div><div class="lab">完成章節</div><div class="bar"><span style="width:' + Math.round(doneN / 6 * 100) + '%"></span></div><div class="sm">看完一章所有投影片才算完成</div></div>' +
      '<div class="stat"><div class="num">' + sc.correct + ' / ' + sc.total + '</div><div class="lab">測驗答對題數</div><div class="bar"><span style="width:' + Math.round(sc.answered / sc.total * 100) + '%"></span></div><div class="sm">已作答 ' + sc.answered + ' 題</div></div>' +
      '<div class="stat"><div class="num" style="font-size:1.2rem">' + (last ? esc(last.title) : '尚未開始') + '</div><div class="lab">目前學習位置</div>' +
      (last ? '<div class="sm">' + esc(CH[last.chapter].code) + '｜' + esc(CH[last.chapter].title) + '</div>' : '') + '</div></div>' +
      '<div class="section-title"><h2>六個教學章節</h2><small>內容皆來自專案 Wiki</small></div><div class="chapter-grid">' +
      D.slides.chapters.map(function (c) {
        var st = cs.filter(function (x) { return x.id === c.id; })[0];
        var first = SLIDES.filter(function (s) { return s.chapter === c.id; })[0];
        return '<button class="chapter-card" data-go="slides/' + first.id + '"><span class="code">' + esc(c.code) + '</span>' +
          '<span class="ttl"><span>' + esc(c.title) + '</span><span class="ko">' + esc(c.ko) + '</span></span>' +
          '<span class="bl">' + esc(c.blurb) + '</span>' +
          '<span class="meta"><span>' + st.seen + '/' + st.total + ' 頁' + (st.done ? ' <span class="done-badge">✓ 完成</span>' : '') + '</span>' + chips(c.sources) + '</span></button>';
      }).join('') + '</div></div></div>';
    app.innerHTML = html;
    $('#startBtn').onclick = function () { go('slides/' + (last ? last.id : SLIDES[0].id)); };
    var rb = $('#resumeBtn'); if (rb) rb.onclick = function () { go('slides/' + last.id); };
    $('#kwBtn').onclick = function () { go('knowledge'); };
    $$('[data-go]', app).forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-go')); }; });
  }

  /* ------------------------------------------------------------------ 簡報檢視 */
  function renderSlides(arg) {
    var idx = -1;
    if (arg) SLIDES.forEach(function (s, i) { if (s.id === arg) idx = i; });
    if (idx < 0) {
      var li = progress.last ? SLIDES.map(function (s) { return s.id; }).indexOf(progress.last) : -1;
      idx = li >= 0 ? li : 0;
    }
    current.slideIndex = idx;
    var s = SLIDES[idx];
    progress.visited[s.id] = true;
    progress.last = s.id;
    saveProgress();

    var toc = '<aside class="toc" id="toc" aria-label="章節目錄"><h3>章節目錄</h3>' +
      D.slides.chapters.map(function (c) {
        var list = SLIDES.filter(function (x) { return x.chapter === c.id; });
        var seen = list.filter(function (x) { return progress.visited[x.id]; }).length;
        return '<details' + (c.id === s.chapter ? ' open' : '') + '><summary><span>' + esc(c.code.replace('Chapter ', 'Ch')) + ' ' + esc(c.title) + '</span><span class="cnt">' + seen + '/' + list.length + '</span></summary><ol>' +
          list.map(function (x) {
            return '<li><button data-slide="' + x.id + '"' + (x.id === s.id ? ' aria-current="true"' : '') + (progress.visited[x.id] ? ' class="seen"' : '') + '>' + esc(x.title) + '</button></li>';
          }).join('') + '</ol></details>';
      }).join('') + '</aside>';

    app.innerHTML = '<div class="view deck">' + toc +
      '<section class="stage-wrap" aria-label="投影片">' +
      '<div class="stage-head"><button class="btn small toc-toggle" id="tocBtn" aria-expanded="false" aria-controls="toc">☰ 目錄</button>' +
      '<span class="where">' + esc(CH[s.chapter].code) + '｜' + esc(CH[s.chapter].title) + ' · 第 ' + (idx + 1) + ' / ' + SLIDES.length + ' 張</span>' +
      '<div class="progressbar" role="progressbar" aria-valuemin="1" aria-valuemax="' + SLIDES.length + '" aria-valuenow="' + (idx + 1) + '"><span style="width:' + Math.round((idx + 1) / SLIDES.length * 100) + '%"></span></div></div>' +
      '<article class="slide" id="slide" aria-live="polite"></article>' +
      '<div class="nav-row"><button class="btn" id="prevBtn"' + (idx === 0 ? ' disabled' : '') + '>← 上一頁</button>' +
      '<span class="mid">' + esc(s.title) + '</span>' +
      '<button class="btn primary" id="nextBtn"' + (idx === SLIDES.length - 1 ? ' disabled' : '') + '>下一頁 →</button></div>' +
      '<p class="hint">鍵盤 ← → 可切換；手機可左右滑動。</p></section></div>';

    renderSlideInto($('#slide'), s);

    $('#prevBtn').onclick = function () { stepSlide(-1); };
    $('#nextBtn').onclick = function () { stepSlide(1); };
    $$('#toc [data-slide]').forEach(function (b) { b.onclick = function () { go('slides/' + b.getAttribute('data-slide')); }; });
    var tb = $('#tocBtn');
    tb.onclick = function () {
      var t = $('#toc'); var open = t.classList.toggle('open');
      tb.setAttribute('aria-expanded', open ? 'true' : 'false');
      var sc = $('#scrim'); if (sc) sc.remove();
      if (open) {
        var d = document.createElement('div'); d.className = 'scrim'; d.id = 'scrim';
        d.onclick = function () { t.classList.remove('open'); d.remove(); tb.setAttribute('aria-expanded', 'false'); };
        document.body.appendChild(d);
      }
    };
    bindSwipe($('#slide'));
    updatePill();
  }
  function stepSlide(d) {
    var n = current.slideIndex + d;
    if (n < 0 || n >= SLIDES.length) return;
    var sc = $('#scrim'); if (sc) sc.remove();
    go('slides/' + SLIDES[n].id);
    window.scrollTo(0, 0);
  }
  document.addEventListener('keydown', function (e) {
    if (current.view !== 'slides') return;
    var t = e.target;
    if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight') { stepSlide(1); }
    else if (e.key === 'ArrowLeft') { stepSlide(-1); }
  });
  function bindSwipe(el) {
    var x0 = null, y0 = null;
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { x0 = null; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (x0 == null) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 50) stepSlide(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function footHtml(s) {
    var srcs = s.sources || [];
    var pend = srcs.some(function (id) { var x = SRC[id]; return x && x.verification && x.verification.human_check !== 'verified'; });
    return '<div class="slide-foot"><span>Wiki：<code>wiki/' + esc(s.wiki) + '</code></span><span>來源 ' + chips(srcs) + '</span>' +
      (s.crosscheck ? '<span>交叉比對 ' + chips(s.crosscheck, true) + '（韓文待人工核對，不作為主要依據）</span>' : '') +
      (pend ? '<span>人工核對：尚未完成</span>' : '') + '</div>';
  }

  function renderSlideInto(box, s) {
    var head = '<div class="ch">' + esc(CH[s.chapter].code) + '</div><h2>' + esc(s.title) + '</h2>';
    var body = '';
    switch (s.type) {
      case 'objectives':
        body = '<ol class="obj-list">' + s.items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>'; break;
      case 'bullets':
        body = '<ul class="points">' + s.items.map(function (i) { return '<li><span>' + esc(i.t) + '</span>' + chips(i.s) + '</li>'; }).join('') + '</ul>'; break;
      case 'table':
        body = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + s.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          s.rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>'; break;
      case 'syllable':
        var p = s.parts;
        body = '<div class="syl-demo"><div class="box"><div class="big ko">' + esc(p.l) + '</div><div class="cap">初聲</div></div><span class="op">＋</span>' +
          '<div class="box"><div class="big ko">' + esc(p.v) + '</div><div class="cap">中聲</div></div><span class="op">＋</span>' +
          '<div class="box"><div class="big ko">' + esc(p.t) + '</div><div class="cap">終聲（可有可無）</div></div><span class="op">＝</span>' +
          '<div class="box"><div class="big res ko">' + esc(p.result) + '</div><div class="cap">音節方塊</div></div>' + speakBtn(p.result) + '</div>' +
          '<ul class="points">' + s.items.map(function (i) { return '<li><span>' + esc(i.t) + '</span>' + chips(i.s) + '</li>'; }).join('') + '</ul>'; break;
      case 'timeline':
        body = '<div class="timeline">' + s.events.map(function (e) { return '<div class="ev"><div class="when">' + esc(e.when) + ' ' + chips(e.s) + '</div><div>' + esc(e.text) + '</div></div>'; }).join('') + '</div>'; break;
      case 'notice':
        body = '<div class="notice ' + esc(s.tone || 'info') + '">' + esc(s.text) + '</div>'; break;
      case 'cards': case 'vocab':
        body = '<div class="deck-viewer" id="deckBox"></div>'; break;
      case 'combiner':
        body = '<div id="combBox"></div>'; break;
      case 'practice':
        body = '<div id="pracBox"></div>'; break;
      case 'dialogue':
        body = '<div class="dlg">' + s.lines.map(function (l) {
          return '<div class="line"><div class="txt"><div class="k ko">' + esc(l.ko) + '</div>' +
            (l.roman ? '<div class="r">' + esc(l.roman) + '（羅馬字，輔助）</div>' : '<div class="r">（來源沒有提供羅馬字）</div>') +
            '<div class="z">' + esc(l.zh) + '</div><div class="meta">' + chips(l.s) + (l.cross ? ' ' + chips(l.cross, true) : '') + '</div></div>' +
            (l.ko.indexOf('___') >= 0 ? '' : speakBtn(l.ko.replace(/\s*\/\s*.*$/, ''))) + '</div>';
        }).join('') + '</div>' + (s.single_source ? '<p class="small-note" style="margin-top:10px">⚠ 單一來源：這一組只有 S9 收錄。</p>' : ''); break;
      case 'scenario':
        body = '<div id="scnBox"></div>'; break;
      case 'quiz':
        body = '<div id="chQuiz"></div>'; break;
      default: body = '<p>（未知的投影片類型）</p>';
    }
    var note = s.note ? '<div class="note">' + esc(s.note) + '</div>' : '';
    box.innerHTML = head + body + note + footHtml(s);
    box.classList.remove('slide'); void box.offsetWidth; box.classList.add('slide');

    if (s.type === 'cards' || s.type === 'vocab') mountDeck($('#deckBox', box), s.deck);
    if (s.type === 'combiner') mountCombiner($('#combBox', box));
    if (s.type === 'practice') mountPractice($('#pracBox', box));
    if (s.type === 'scenario') {
      var c = $('#scnBox', box);
      D.quiz.practice.dialogue.forEach(function (q) { c.appendChild(buildQuestion(q, { practice: true })); });
    }
    if (s.type === 'quiz') {
      var cq = $('#chQuiz', box);
      var list = D.quiz.questions.filter(function (q) { return q.chapter === s.quiz_chapter; });
      var banner = document.createElement('p');
      banner.className = 'small-note';
      cq.appendChild(banner);
      var refresh = function () {
        var a = list.filter(function (q) { return progress.answers[q.id]; }).length;
        var ok = list.filter(function (q) { return progress.answers[q.id] && progress.answers[q.id].ok; }).length;
        banner.textContent = '本章 ' + list.length + ' 題：已作答 ' + a + ' 題，答對 ' + ok + ' 題。成績會計入「小測驗」總分。';
      };
      refresh();
      list.forEach(function (q) { cq.appendChild(buildQuestion(q, { onAnswer: function () { refresh(); updatePill(); } })); });
    }
  }

  /* ------------------------------------------------------------------ 卡片（子音、母音、單字） */
  function mountDeck(box, kind) {
    var all = D.slides.decks[kind];
    var groups = {
      consonants: [['all', '全部 19'], ['basic', '基本子音 14'], ['tense', '緊音 5']],
      vowels: [['all', '全部 21'], ['basic', '基本母音 10'], ['compound', '複合母音 11']],
      vocab: [['all', '全部 20'], ['飲食', '飲食'], ['人物', '人物'], ['地點', '地點'], ['物品與時間', '物品與時間']]
    }[kind];
    var st = { g: 'all', i: 0, flipped: false };
    function list() { return all.filter(function (c) { return st.g === 'all' || (kind === 'vocab' ? c.cat === st.g : c.group === st.g); }); }
    function draw() {
      var L = list();
      if (st.i >= L.length) st.i = 0;
      var c = L[st.i];
      var front = '<span class="glyph ko' + (kind === 'vocab' ? ' word' : '') + '">' + esc(c.ko) + '</span><span class="tapnote">點擊翻面</span>';
      var back;
      if (kind === 'vocab') {
        back = '<div class="zh">' + esc(c.zh) + '</div><div class="rom">' + esc(c.roman) + '</div>' +
          '<div class="small">' + esc(c.en) + '・名詞（명사）</div>' + (c.note ? '<div class="small">' + esc(c.note) + '</div>' : '') +
          '<div class="tiny">羅馬字為依字母表推導，詞典頁面沒有提供・' + c.src.join(' ') + '</div>';
      } else {
        back = '<div class="rom">' + esc(c.roman) + '</div><div class="small">' + esc(c.note) + '</div>' +
          '<div class="tiny">羅馬字是輔助，不是英文發音・' + c.src.join(' ') + '</div>';
      }
      box.innerHTML = '<div class="tabs" role="group" aria-label="分類">' + groups.map(function (g) {
        return '<button type="button" data-g="' + esc(g[0]) + '" aria-pressed="' + (st.g === g[0]) + '">' + esc(g[1]) + '</button>';
      }).join('') + '</div>' +
        '<button type="button" class="flip' + (st.flipped ? ' flipped' : '') + '" id="flipBtn" aria-label="翻面：' + esc(c.ko) + '" aria-pressed="' + st.flipped + '">' +
        '<span class="flip-in"><span class="face front">' + front + '</span><span class="face back">' + back + '</span></span></button>' +
        '<div class="deck-ctrl"><button class="btn small" type="button" id="dPrev">← 上一張</button><span>' + (st.i + 1) + ' / ' + L.length + '</span>' +
        '<button class="btn small" type="button" id="dNext">下一張 →</button>' + speakBtn(c.ko) + '</div>' +
        '<div class="mini-grid">' + L.map(function (x, k) { return '<button type="button" class="ko" data-k="' + k + '"' + (k === st.i ? ' aria-current="true"' : '') + ' aria-label="' + esc(x.ko) + '">' + esc(x.ko) + '</button>'; }).join('') + '</div>';
      $$('[data-g]', box).forEach(function (b) { b.onclick = function () { st.g = b.getAttribute('data-g'); st.i = 0; st.flipped = false; draw(); }; });
      $('#flipBtn', box).onclick = function () { st.flipped = !st.flipped; var f = $('#flipBtn', box); f.classList.toggle('flipped', st.flipped); f.setAttribute('aria-pressed', st.flipped); };
      $('#dPrev', box).onclick = function () { st.i = (st.i - 1 + L.length) % L.length; st.flipped = false; draw(); };
      $('#dNext', box).onclick = function () { st.i = (st.i + 1) % L.length; st.flipped = false; draw(); };
      $$('[data-k]', box).forEach(function (b) { b.onclick = function () { st.i = +b.getAttribute('data-k'); st.flipped = false; draw(); }; });
    }
    draw();
  }

  /* ------------------------------------------------------------------ 字母組合器 */
  function mountCombiner(box) {
    var DEF = { l: 18, v: 0, t: 4 };          // ㅎ ㅏ ㄴ = 한（Wiki 第 1 章示例）
    var st = { l: DEF.l, v: DEF.v, t: DEF.t };
    function pickRow(label, arr, key, withNone) {
      return '<div class="pick-row"><div class="lab">' + label + '</div><div class="grid" role="group" aria-label="' + label + '">' +
        (withNone ? '<button type="button" class="none" data-key="t" data-i="0" aria-pressed="' + (st.t === 0) + '">無終聲</button>' : '') +
        arr.map(function (j, i) {
          if (withNone && i === 0) return '';
          return '<button type="button" class="ko" data-key="' + key + '" data-i="' + i + '" aria-pressed="' + (st[key] === i) + '">' + esc(j) + '</button>';
        }).join('') + '</div></div>';
    }
    function draw() {
      var ready = st.l !== null && st.v !== null;
      var out;
      if (ready) {
        var ch = H.compose(st.l, st.v, st.t);
        var lj = H.CHOSEONG[st.l], vj = H.JUNGSEONG[st.v], tj = H.JONGSEONG[st.t];
        var code = ch.charCodeAt(0);
        var hint = H.finalHint(tj);
        var extra = (lj === 'ㅇ') ? '初聲的 ㅇ 不發音，只是佔位（S1）。 ' : '';
        out = '<div class="res ko" id="combRes" aria-live="polite">' + esc(ch) + '</div><div><div class="formula ko">' + esc(lj) + ' ＋ ' + esc(vj) + (tj ? ' ＋ ' + esc(tj) : '') + ' ＝ <b>' + esc(ch) + '</b></div>' +
          '<div class="code">Unicode U+' + code.toString(16).toUpperCase() + ' ＝ 0xAC00 ＋ (' + st.l + '×21 ＋ ' + st.v + ')×28 ＋ ' + st.t + '</div>' +
          '<div class="hintbox">' + esc(extra) + '收音提示：' + esc(hint.text) + (hint.src ? '（' + hint.src + '）' : '') + '</div></div>' + speakBtn(ch);
      } else {
        out = '<div class="res ko" id="combRes">？</div><div><div class="formula">請至少選擇一個初聲與一個中聲。</div><div class="code">終聲可以不選。</div></div>';
      }
      box.innerHTML = '<div class="comb"><div class="comb-out">' + out + '</div>' +
        pickRow('初聲（19）', H.CHOSEONG, 'l', false) + pickRow('中聲（21）', H.JUNGSEONG, 'v', false) + pickRow('終聲（可選，27 個＋無）', H.JONGSEONG, 't', true) +
        '<div class="comb-actions"><button class="btn small" type="button" id="cClear">清除</button><button class="btn small primary" type="button" id="cReset">重新組合（回到 한）</button></div></div>';
      $$('[data-key]', box).forEach(function (b) {
        b.onclick = function () { st[b.getAttribute('data-key')] = +b.getAttribute('data-i'); draw(); };
      });
      $('#cClear', box).onclick = function () { st.l = null; st.v = null; st.t = 0; draw(); };
      $('#cReset', box).onclick = function () { st.l = DEF.l; st.v = DEF.v; st.t = DEF.t; draw(); };
    }
    draw();
  }

  /* ------------------------------------------------------------------ 拼音組合練習 */
  function mountPractice(box) {
    var T = D.slides.practice_targets;
    var st = { i: 0, score: 0, answered: false };
    function opts(arr, withNone) {
      return '<option value="">' + (withNone ? '（無終聲）' : '選擇') + '</option>' + arr.map(function (j, i) { return (withNone && i === 0) ? '' : '<option value="' + i + '">' + esc(j) + '</option>'; }).join('');
    }
    function draw() {
      var t = T[st.i];
      box.innerHTML = '<div class="practice"><div class="target"><span class="t ko">' + esc(t.target) + '</span>' + speakBtn(t.target) + '<span>' + esc(t.hint) + '</span></div>' +
        '<div class="sels"><label>初聲 <select id="pl" class="ko">' + opts(H.CHOSEONG) + '</select></label>' +
        '<label>中聲 <select id="pv" class="ko">' + opts(H.JUNGSEONG) + '</select></label>' +
        '<label>終聲 <select id="pt" class="ko">' + opts(H.JONGSEONG, true) + '</select></label></div>' +
        '<div class="comb-actions"><button class="btn small primary" type="button" id="pCheck">檢查</button><button class="btn small" type="button" id="pNext"' + (st.i === T.length - 1 ? ' disabled' : '') + '>下一題</button>' +
        '<span class="small-note">第 ' + (st.i + 1) + ' / ' + T.length + ' 題・答對 ' + st.score + ' 題</span></div><div id="pFb" aria-live="polite"></div></div>';
      $('#pCheck', box).onclick = function () {
        var l = $('#pl', box).value, v = $('#pv', box).value, tt = $('#pt', box).value;
        var fb = $('#pFb', box);
        if (l === '' || v === '') { fb.innerHTML = '<div class="feedback bad">請先選好初聲與中聲。</div>'; return; }
        var made = H.compose(+l, +v, tt === '' ? 0 : +tt);
        var d = H.decompose(t.target);
        var ans = d.lJamo + ' ＋ ' + d.vJamo + (d.tJamo ? ' ＋ ' + d.tJamo : '') + ' ＝ ' + t.target;
        if (made === t.target) {
          if (!st.answered) { st.score++; st.answered = true; }
          fb.innerHTML = '<div class="feedback ok">✔ 正確！' + esc(ans) + '</div>';
        } else {
          st.answered = true;
          fb.innerHTML = '<div class="feedback bad">✘ 你拼出的是「' + esc(made) + '」。正確答案：' + esc(ans) + '</div>';
        }
      };
      $('#pNext', box).onclick = function () { st.i++; st.answered = false; draw(); };
    }
    draw();
  }

  /* ------------------------------------------------------------------ 測驗引擎 */
  function buildQuestion(q, opt) {
    opt = opt || {};
    var wrap = document.createElement('div');
    wrap.className = 'q';
    var rec = opt.practice ? null : progress.answers[q.id];
    var isMatch = q.kind === 'match';
    var kindLabel = { concept: '概念', letter: '字母', spelling: '拼音', vocab: '單字', dialogue: '會話', match: '配對' }[q.kind] || '';
    var head = '<div class="qh"><span>' + (opt.practice ? '練習' : esc(q.id.toUpperCase())) + (kindLabel ? '・' + kindLabel : '') + '</span><span>' + (q.chapter ? '第 ' + q.chapter + ' 章' : '') + '</span></div>';
    var scene = q.scene ? '<p class="small-note">情境：' + esc(q.scene) + '</p>' : '';
    var form = '';
    if (isMatch) {
      form = q.pairs.map(function (p, i) {
        return '<div class="match-row"><span class="ko">' + esc(p.ko) + '</span><select data-m="' + i + '" aria-label="' + esc(p.ko) + ' 的意思"><option value="">選擇意思</option>' +
          q.options.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') + '</select></div>';
      }).join('') + '<button class="btn small primary" type="button" data-check>檢查答案</button>';
    } else {
      form = '<div class="choices">' + q.choices.map(function (c, i) { return '<button type="button" class="ko" data-c="' + i + '">' + esc(c) + '</button>'; }).join('') + '</div>';
    }
    wrap.innerHTML = head + scene + '<div class="qp">' + esc(q.prompt) + '</div>' + form + '<div data-res></div>';

    function answerText() {
      return isMatch ? q.pairs.map(function (p) { return p.ko + '＝' + p.zh; }).join('；') : q.choices[q.answer];
    }
    function showResult(ok) {
      var traceId = (q.chapter ? '第 ' + q.chapter + ' 章' : '第 6 章');
      $('[data-res]', wrap).innerHTML = '<div class="result ' + (ok ? 'ok' : 'bad') + '"><b>' + (ok ? '✔ 正確' : '✘ 錯誤') + '</b>　正確答案：' + esc(answerText()) +
        '<div>' + esc(q.explain) + '</div><div class="trace">對應 Wiki：wiki/' + esc(q.wiki) + '（' + traceId + '）・來源 ' + esc(q.sources.join('、')) + '</div></div>';
    }
    function lock() { $$('button,select', wrap).forEach(function (b) { b.disabled = true; }); }
    function record(ok, pick) {
      if (opt.practice) return;
      progress.answers[q.id] = { ok: ok, pick: pick };
      saveProgress();
      updatePill();
      if (opt.onAnswer) opt.onAnswer(ok);
    }
    if (!isMatch) {
      $$('[data-c]', wrap).forEach(function (b) {
        b.onclick = function () {
          var i = +b.getAttribute('data-c');
          var ok = i === q.answer;
          b.classList.add(ok ? 'correct' : 'wrong');
          var right = $('[data-c="' + q.answer + '"]', wrap); if (right) right.classList.add('correct');
          lock(); showResult(ok); record(ok, i);
        };
      });
    } else {
      $('[data-check]', wrap).onclick = function () {
        var sels = $$('[data-m]', wrap);
        if (sels.some(function (s) { return !s.value; })) { toast('請先為每一句選好意思。'); return; }
        var ok = sels.every(function (s, i) { return s.value === q.pairs[i].zh; });
        sels.forEach(function (s, i) { s.style.borderColor = s.value === q.pairs[i].zh ? 'var(--ok)' : 'var(--bad)'; });
        lock(); showResult(ok); record(ok, sels.map(function (s) { return s.value; }));
      };
    }
    if (rec) {  // 已作答：還原畫面
      if (!isMatch) {
        var pb = $('[data-c="' + rec.pick + '"]', wrap); if (pb) pb.classList.add(rec.ok ? 'correct' : 'wrong');
        var rb = $('[data-c="' + q.answer + '"]', wrap); if (rb) rb.classList.add('correct');
      } else if (rec.pick) {
        $$('[data-m]', wrap).forEach(function (s, i) { s.value = rec.pick[i]; s.style.borderColor = rec.pick[i] === q.pairs[i].zh ? 'var(--ok)' : 'var(--bad)'; });
      }
      lock(); showResult(rec.ok);
    }
    return wrap;
  }

  function renderQuizView() {
    app.innerHTML = '<div class="view"><div class="container"><div class="section-title"><h2>韓文小測驗</h2><small>' + D.quiz.questions.length + ' 題・題目與答案皆來自 Wiki</small></div>' +
      '<div class="stat" id="qSummary" style="margin-bottom:20px"></div><div id="qList"></div></div></div>';
    var list = $('#qList');
    function refresh() {
      var sc = scoreInfo();
      var per = D.slides.chapters.map(function (c) {
        var qs = D.quiz.questions.filter(function (q) { return q.chapter === c.id; });
        var ok = qs.filter(function (q) { return progress.answers[q.id] && progress.answers[q.id].ok; }).length;
        var a = qs.filter(function (q) { return progress.answers[q.id]; }).length;
        return '<span class="chip">第 ' + c.id + ' 章 ' + ok + '/' + qs.length + (a < qs.length ? '（已答 ' + a + '）' : '') + '</span>';
      }).join(' ');
      $('#qSummary').innerHTML = '<div class="num">' + sc.correct + ' / ' + sc.total + '</div><div class="lab">答對題數・已作答 ' + sc.answered + ' 題' + (sc.answered === sc.total ? '（全部完成）' : '') + '</div>' +
        '<div class="bar"><span style="width:' + Math.round(sc.answered / sc.total * 100) + '%"></span></div><div class="sm" style="margin-top:10px">' + per + '</div>' +
        '<div style="margin-top:12px"><button class="btn small" type="button" id="qReset">重新作答（清除測驗成績）</button></div>';
      $('#qReset').onclick = function () {
        progress.answers = {}; saveProgress(); updatePill();
        list.innerHTML = ''; build(); refresh();
      };
    }
    function build() {
      D.quiz.questions.forEach(function (q) { list.appendChild(buildQuestion(q, { onAnswer: refresh })); });
    }
    build(); refresh();
  }

  /* ------------------------------------------------------------------ Knowledge & Workflow */
  function badge(status, label) { return '<span class="badge ' + esc(status) + '">' + esc(label || status) + '</span>'; }
  var STATUS_ZH = { success: '成功', partial: '部分', failed: '失敗', pending: '待處理', done: '已完成', not_started: '未開始', reserved: '保留給下一階段', passed: '通過', not_run: '未執行', fixed: '已修正' };

  function graphSvg(W) {
    var pos = {};
    var xs1 = [100, 300, 500, 700, 900], y1 = 90, y2 = 270;
    W.nodes.forEach(function (n, i) {
      if (i < 5) pos[n.no] = { x: xs1[i], y: y1 };
      else pos[n.no] = { x: xs1[9 - i], y: y2 };
    });
    var fill = { done: '#D9D0F0', partial: '#F6F1E4', reserved: '#FFFFFF', not_started: '#FFFFFF' };
    var svg = '<svg class="flow-svg" viewBox="0 0 1000 380" role="img" aria-label="Loop / Graph 工作流程圖：十個節點與失敗返回路徑">' +
      '<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#555"/></marker>' +
      '<marker id="arrL" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#7a6aa8"/></marker></defs>';
    // 主流程箭頭
    for (var i = 0; i < 9; i++) {
      var a = pos[W.nodes[i].no], b = pos[W.nodes[i + 1].no];
      if (i < 4) svg += '<line x1="' + (a.x + 75) + '" y1="' + a.y + '" x2="' + (b.x - 77) + '" y2="' + b.y + '" stroke="#555" stroke-width="1.6" marker-end="url(#arr)"/>';
      else if (i === 4) svg += '<line x1="' + a.x + '" y1="' + (a.y + 30) + '" x2="' + b.x + '" y2="' + (b.y - 32) + '" stroke="#555" stroke-width="1.6" marker-end="url(#arr)"/>';
      else svg += '<line x1="' + (a.x - 75) + '" y1="' + a.y + '" x2="' + (b.x + 77) + '" y2="' + b.y + '" stroke="#555" stroke-width="1.6" marker-end="url(#arr)"/>';
    }
    // 失敗返回路徑
    var loopPaths = {
      '③→②': { d: 'M 500,60 C 500,8 300,8 300,60', lx: 400, ly: 16 },
      '⑦→④': { d: 'M 690,238 L 690,120', lx: 640, ly: 180, anchor: 'end' },
      '⑦→⑥': { d: 'M 720,302 C 720,352 880,352 880,302', lx: 800, ly: 366 },
      '⑨→⑧': { d: 'M 320,302 C 320,352 480,352 480,302', lx: 400, ly: 366 },
      '⑩→⑨': { d: 'M 120,302 C 120,352 280,352 280,302', lx: 200, ly: 366 }
    };
    W.loops.forEach(function (lp) {
      var p = loopPaths[lp.from + '→' + lp.to];
      if (!p) return;
      svg += '<path d="' + p.d + '" fill="none" stroke="#7a6aa8" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#arrL)"/>' +
        '<text x="' + p.lx + '" y="' + p.ly + '" font-size="12" fill="#7a6aa8" text-anchor="' + (p.anchor || 'middle') + '">' + esc(lp.label) + '</text>';
    });
    // 節點
    W.nodes.forEach(function (n) {
      var p = pos[n.no];
      var dash = (n.status === 'partial' || n.status === 'reserved' || n.status === 'not_started') ? ' stroke-dasharray="5 4"' : '';
      svg += '<g><rect x="' + (p.x - 75) + '" y="' + (p.y - 30) + '" width="150" height="60" rx="14" fill="' + (fill[n.status] || '#fff') + '" stroke="#888" stroke-width="1.2"' + dash + '/>' +
        '<text x="' + p.x + '" y="' + (p.y - 4) + '" font-size="15" font-weight="600" text-anchor="middle" fill="#333">' + esc(n.no + ' ' + n.short) + '</text>' +
        '<text x="' + p.x + '" y="' + (p.y + 18) + '" font-size="11" text-anchor="middle" fill="#666">' + esc(STATUS_ZH[n.status] || n.status) + (n.check ? '・✓檢查' : '') + (n.repeat ? '・↻' : '') + '</text></g>';
    });
    return svg + '</svg>';
  }

  function renderKnowledge() {
    var W = D.workflow, S = D.sources;
    var cnt = { success: 0, partial: 0 };
    S.sources.forEach(function (s) { cnt[s.status] = (cnt[s.status] || 0) + 1; });
    var h = '<div class="view"><div class="container">' +
      '<div class="section-title"><h2>Knowledge &amp; Workflow</h2><small>以下內容依專案的真實紀錄產生，沒有虛構</small></div>';

    // 1. LLM Wiki
    h += '<section class="kw-section"><h2>1. LLM Wiki 是什麼 <small>wiki/</small></h2>' +
      '<p>LLM Wiki 是由 AI 協助整理、但每一項知識都要標示來源的結構化知識庫。本專案先把資料來源整理進 Wiki，再從 Wiki 取材製作簡報；AI 不可以用自己的記憶補寫教學內容。</p>' +
      '<div class="cols"><div><h3>六個章節</h3><p class="small-note">' + D.slides.chapters.map(function (c) { return esc(c.code.replace('Chapter ', 'Ch') + ' ' + c.title); }).join('・') + '</p></div>' +
      '<div><h3>統一格式</h3><p class="small-note">學習目標、基本概念、詳細教學、初學者範例、常見錯誤、來源與引用、簡報摘要</p></div>' +
      '<div><h3>標記規則</h3><p class="small-note"><b>[S#]</b> 來源 ID；<b>待補來源</b> 不得進入簡報；<b>推論</b> 查證前不使用；<b>教學設計</b> 為教學編排，不是事實。</p></div></div></section>';

    // 2. 來源
    h += '<section class="kw-section"><h2>2. 知識來源與擷取狀態 <small>sources/sources.json（第二階段紀錄）</small></h2>' +
      '<p>共 ' + S.sources.length + ' 筆 ingest：成功 ' + (cnt.success || 0) + '、部分 ' + (cnt.partial || 0) + '。所有擷取皆為 WebFetch 的<b>工具摘要</b>，不是逐字原文；<b>人工核對狀態：全部尚未完成</b>，簡報不宣稱已人工驗證。</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>來源</th><th>標題</th><th>擷取</th><th>人工核對</th><th>對應章節</th></tr></thead><tbody>' +
      S.sources.map(function (s) {
        return '<tr><td>' + esc(s.source_id) + '<br><span class="small-note">' + esc(s.ingest_id) + '</span></td><td><a href="' + esc(s.url.indexOf('<') >= 0 ? 'https://krdict.korean.go.kr/eng/mainAction' : s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>' +
          '<details><summary class="small-note">取得範圍與限制</summary><p class="small-note">取得範圍：' + esc(s.content_range) + '<br>限制：' + esc(s.usage_restrictions) + '<br>查證備註：' + esc(s.verification.note) + '</p></details></td>' +
          '<td>' + badge(s.status, STATUS_ZH[s.status] || s.status) + '</td><td>' + badge(s.verification.human_check === 'required' ? 'failed' : 'pending', s.verification.human_check === 'required' ? '需人工核對' : '待核對') + '</td><td>' + esc(s.wiki_chapters.join('、')) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<h3>失敗與待處理</h3><ul>' + S.failed_or_pending.map(function (f) { return '<li><b>' + esc(f.id) + '</b> ' + esc(f.target) + ' — ' + badge(f.status === 'failed' ? 'failed' : 'pending', f.status) + ' ' + esc(f.reason) + '（處理：' + esc(f.resolution) + '）</li>'; }).join('') + '</ul>' +
      '<h3>被排除的候選來源</h3><ul>' + S.rejected_candidates.map(function (r) { return '<li class="small-note">' + esc(r.url) + ' — ' + esc(r.reason) + '</li>'; }).join('') + '</ul></section>';

    // 3. Wiki → 簡報
    h += '<section class="kw-section"><h2>3. Wiki 如何產生教學簡報 <small>節點 ⑤⑥⑦⑧</small></h2><ol class="steps">' +
      '<li><span><b>⑤ 查詢 Wiki：</b>逐章讀取可用內容，記錄用了什麼、排除了什麼（共 ' + W.wiki_queries.length + ' 筆查詢）。</span></li>' +
      '<li><span><b>⑥ 整理教學摘要：</b>寫入 <code>data/slides.json</code> 與 <code>data/quiz.json</code>；每張投影片與每題都記錄 Wiki 檔案、來源 ID，以及必須能在 Wiki 找到的 evidence 字串。</span></li>' +
      '<li><span><b>⑦ 內容驗證：</b><code>scripts/validate.py</code> 逐項檢查可追溯性、單字一致、是否誤用待補來源、測驗答案；失敗就退回修正。</span></li>' +
      '<li><span><b>⑧ 生成 HTML：</b>頁面只讀取驗證過的 JSON，不在程式裡另外寫教學文字。</span></li></ol>' +
      '<h3>⑤ Wiki 查詢紀錄</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>查詢</th><th>使用</th><th>排除</th></tr></thead><tbody>' +
      W.wiki_queries.map(function (q) { return '<tr><td>' + esc(q.id) + '</td><td>' + esc(q.query) + '</td><td>' + esc(q.used) + '</td><td>' + esc(q.excluded) + '</td></tr>'; }).join('') + '</tbody></table></div></section>';

    // 4. Graph
    h += '<section class="kw-section"><h2>4. Loop / Graph 工作流程 <small>workflow/graph.md</small></h2>' + graphSvg(W) +
      '<div class="legend"><span><i style="background:#D9D0F0"></i>已完成</span><span><i style="background:#F6F1E4;border:1px dashed #888"></i>部分完成</span><span><i style="background:#fff;border:1px dashed #888"></i>未開始／保留</span><span>✓檢查節點</span><span>↻ 會重複執行</span><span style="color:#7a6aa8">┄ 虛線＝失敗返回</span></div>' +
      '<h3>節點職責</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>節點</th><th>輸入</th><th>處理</th><th>輸出</th><th>檢查</th><th>失敗返回</th><th>狀態</th></tr></thead><tbody>' +
      W.nodes.map(function (n) { return '<tr><td>' + esc(n.no + ' ' + n.name) + '</td><td>' + esc(n.input) + '</td><td>' + esc(n.process) + '</td><td>' + esc(n.output) + '</td><td>' + (n.check ? '✓' : '—') + '</td><td>' + esc(n.fail_return || '—') + '</td><td>' + badge(n.status, STATUS_ZH[n.status]) + (n.note ? '<br><span class="small-note">' + esc(n.note) + '</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="cols"><div><h3>會反覆執行的節點</h3><ul>' + W.nodes.filter(function (n) { return n.repeat; }).map(function (n) { return '<li>' + esc(n.no + ' ' + n.name) + '</li>'; }).join('') + '</ul></div>' +
      '<div><h3>進行內容驗證的節點</h3><ul>' + W.nodes.filter(function (n) { return n.check; }).map(function (n) { return '<li>' + esc(n.no + ' ' + n.name) + '</li>'; }).join('') + '</ul></div></div>' +
      '<h3>失敗返回路徑</h3><ul>' + W.loops.map(function (l) { return '<li><b>' + esc(l.from + ' → ' + l.to) + '</b>：' + esc(l.when) + '</li>'; }).join('') + '</ul></section>';

    // 5. 驗證
    h += '<section class="kw-section"><h2>5. 內容驗證結果 <small>scripts/validate.py（實際執行）</small></h2><div class="timeline-log">' +
      W.validation_runs.map(function (v) {
        return '<div class="log-item"><span class="id">' + esc(v.id) + '</span><span><b>' + esc(v.title) + '</b>　' + badge(v.fail === 0 ? 'success' : 'failed', 'PASS ' + v.pass + '・FAIL ' + v.fail + (v.warn ? '・WARN ' + v.warn : '')) +
          '<br><span class="small-note">' + esc(v.note) + '</span>' + (v.issues && v.issues.length ? '<ul>' + v.issues.map(function (i) { return '<li class="small-note">' + esc(i) + '</li>'; }).join('') + '</ul>' : '') + '</span></div>';
      }).join('') + '</div><p class="small-note">驗證腳本只檢查格式、對應與可追溯性，無法證明內容本身正確。</p></section>';

    // 6. 測試
    h += '<section class="kw-section"><h2>6. 功能測試結果 <small>workflow/test-report.md</small></h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>測試項目</th><th>方式</th><th>結果</th></tr></thead><tbody>' +
      W.tests.map(function (t) { return '<tr><td>' + esc(t.id) + '</td><td>' + esc(t.name) + '</td><td>' + esc(t.method) + '</td><td>' + badge(t.status === 'passed' ? 'success' : (t.status === 'failed' ? 'failed' : 'pending'), STATUS_ZH[t.status] || t.status) + '<br><span class="small-note">' + esc(t.result) + '</span></td></tr>'; }).join('') + '</tbody></table></div></section>';

    // 7. 記錄
    h += '<section class="kw-section"><h2>7. 執行與修正紀錄 <small>logs/run-20261123.md</small></h2><div class="timeline-log">' +
      W.log.map(function (l) { return '<div class="log-item"><span class="id">' + esc(l.phase) + '<br>' + esc(l.no) + '</span><span><b>' + esc(l.step) + '</b>　' + badge(l.result === '成功' ? 'success' : (l.result === '失敗' ? 'failed' : 'partial'), l.result) + '<br><span class="small-note">' + esc(l.note) + '</span></span></div>'; }).join('') + '</div></section>';

    // 8. 排除
    h += '<section class="kw-section"><h2>8. 未納入簡報的內容 <small>待補來源・推論・未核對</small></h2><ul>' +
      W.excluded.map(function (x) { return '<li><b>' + esc(x.item) + '</b>：' + esc(x.reason) + '</li>'; }).join('') + '</ul></section>';

    h += '</div></div>';
    app.innerHTML = h;
  }

  /* ------------------------------------------------------------------ 啟動 */
  function init() {
    document.getElementById('brandBtn').onclick = function () { go('home'); };
    $$('.nav button').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-nav')); }; });
    Promise.all([getJSON('data/slides.json'), getJSON('data/quiz.json'), getJSON('sources/sources.json'), getJSON('data/workflow.json')])
      .then(function (r) {
        D = { slides: r[0], quiz: r[1], sources: r[2], workflow: r[3] };
        D.sources.sources.forEach(function (s) { SRC[s.source_id] = s; });
        D.slides.chapters.forEach(function (c) { CH[c.id] = c; });
        SLIDES = D.slides.slides;
        window.addEventListener('hashchange', route);
        route();
      })
      .catch(showLoadError);
  }
  init();
})();
