#!/usr/bin/env python3
"""HANGUL ROOM 瀏覽器功能測試（Workflow 節點 ⑨）

需求：Python Playwright 與 Chromium（pip install playwright && playwright install chromium）
用法：python3 -I scripts/browser_test.py [--shots]
說明：
- 以本機 HTTP 伺服器提供網站，並用真的 Chromium 操作頁面；結果寫入 workflow/browser-test-results.json。
- 只測試 Chromium（桌機與手機尺寸／觸控模擬）。Firefox、Safari、真實手機與真實韓文語音「不在」測試範圍。
- 語音測試使用 speechSynthesis 的替身物件，驗證程式的呼叫與降級流程，不是驗證發音品質。
"""
import functools, http.server, json, pathlib, re, socketserver, sys, threading, time, traceback

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "screenshots"
TAKE_SHOTS = "--shots" in sys.argv

SL = json.loads((ROOT / "data/slides.json").read_text(encoding="utf-8"))
QZ = json.loads((ROOT / "data/quiz.json").read_text(encoding="utf-8"))
SLIDES = SL["slides"]
QS = QZ["questions"]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve(directory):
    handler = functools.partial(Quiet, directory=str(directory))
    srv = socketserver.TCPServer(("127.0.0.1", 0), handler)
    srv.allow_reuse_address = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


srv_a, PA = serve(ROOT)            # 網站在根路徑
srv_b, PB = serve(ROOT.parent)     # 網站在子路徑 /hangul-room/（模擬 GitHub Pages 專案頁面）
BASE = f"http://127.0.0.1:{PA}/index.html"

results = []


def run(tid, name, fn):
    t0 = time.time()
    try:
        detail = fn() or ""
        results.append({"id": tid, "name": name, "status": "passed", "detail": detail})
        print(f"PASS  {tid} {name}" + (f"  ({detail})" if detail else ""))
    except Exception as e:  # noqa: BLE001
        msg = f"{type(e).__name__}: {str(e)[:300]}"
        results.append({"id": tid, "name": name, "status": "failed", "detail": msg})
        print(f"FAIL  {tid} {name}  ({msg})")
        if "--trace" in sys.argv:
            traceback.print_exc()


def check(cond, msg="斷言失敗"):
    if not cond:
        raise AssertionError(msg)


def goto_slide(page, sid):
    page.evaluate("id => { location.hash = '#/slides/' + id }", sid)
    page.wait_for_function("id => document.querySelector('#slide') && document.querySelector('#toc [data-slide=\"' + id + '\"][aria-current=\"true\"]')", arg=sid)


def open_toc_chapter(page, sid):
    """目錄只展開目前章節；要點其他章節的項目前，先把該章節展開（使用者也要這樣操作）。"""
    page.evaluate("id => { document.querySelector('#toc [data-slide=\"' + id + '\"]').closest('details').open = true }", sid)


import unicodedata


def expected_syllable(l, v, t):
    """以 Unicode 資料庫（字元名稱 + NFC 正規化）獨立算出預期音節，不依賴 app 的公式或表格。"""
    def conj(jamo, kind):
        name = unicodedata.name(jamo).replace("HANGUL LETTER ", f"HANGUL {kind} ")
        return unicodedata.lookup(name)
    s = conj(l, "CHOSEONG") + conj(v, "JUNGSEONG") + (conj(t, "JONGSEONG") if t else "")
    return unicodedata.normalize("NFC", s)


def shot(page, name, full=False):
    if TAKE_SHOTS:
        SHOTS.mkdir(exist_ok=True)
        page.screenshot(path=str(SHOTS / name), full_page=full)


class Env:
    """每個測試用獨立的瀏覽器 context，localStorage 互不影響。"""

    def __init__(self, browser, **kw):
        self.ctx = browser.new_context(**kw)
        self.errors = []
        self.requests = []

    def page(self, init_scripts=()):
        for s in init_scripts:
            self.ctx.add_init_script(s)
        p = self.ctx.new_page()
        p.set_default_timeout(8000)
        p.on("pageerror", lambda e: self.errors.append("pageerror: " + str(e)))
        p.on("console", lambda m: self.errors.append("console.error: " + m.text) if m.type == "error" else None)
        p.on("request", lambda r: self.requests.append(r.url))
        return p

    def close(self):
        self.ctx.close()


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    DESK = dict(viewport={"width": 1280, "height": 820})
    MOB = dict(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2,
               user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")

    # ------------------------------------------------------------------ T01 首頁
    def t01():
        e = Env(browser, **DESK); p = e.page()
        p.goto(BASE); p.wait_for_selector(".hero h1")
        check("HANGUL ROOM" in p.title(), "title")
        check(p.inner_text(".hero h1") == "HANGUL ROOM")
        check("Learn Korean, One Letter at a Time." in p.inner_text(".hero .tag"))
        check("從零開始，探索韓文字母的世界" in p.inner_text(".hero .sub"))
        check(p.locator("#startBtn").inner_text() == "開始學習")
        check(p.locator(".chapter-card").count() == 6, "章節卡不是 6 張")
        check(p.locator(".hero-deco i").count() == 4)
        check(p.locator(".progress-card .stat").count() == 3)
        shot(p, "01-home-desktop.png", full=True)
        check(not e.errors, str(e.errors)); e.close()
        return "6 張章節卡、標語、副標題、進度區皆存在"
    run("T01", "首頁內容與無錯誤載入", t01)

    # ------------------------------------------------------------------ T02/T03 投影片切換
    def t02():
        e = Env(browser, **DESK); p = e.page()
        p.goto(BASE); p.click("#startBtn"); p.wait_for_selector("#slide h2")
        first = p.inner_text("#slide h2")
        check(first == SLIDES[0]["title"])
        w0 = p.eval_on_selector(".progressbar span", "e => e.style.width")
        p.click("#nextBtn"); p.wait_for_function("t => document.querySelector('#slide h2').innerText !== t", arg=first)
        check(p.inner_text("#slide h2") == SLIDES[1]["title"])
        w1 = p.eval_on_selector(".progressbar span", "e => e.style.width")
        check(w0 != w1, "進度條沒有變化")
        p.click("#prevBtn"); p.wait_for_function("t => document.querySelector('#slide h2').innerText === t", arg=first)
        check(p.is_disabled("#prevBtn"), "第一頁的上一頁應停用")
        check(p.locator("#toc [data-slide]").count() == len(SLIDES), "目錄項目數不符")
        check(p.locator("#toc details").count() == 6)
        open_toc_chapter(p, SLIDES[10]["id"])
        p.click(f"#toc [data-slide='{SLIDES[10]['id']}']"); p.wait_for_function("t => document.querySelector('#slide h2').innerText === t", arg=SLIDES[10]["title"])
        shot(p, "02-slide-desktop.png")
        check(not e.errors, str(e.errors)); e.close()
        return f"共 {len(SLIDES)} 張；上一頁／下一頁／進度條／章節目錄皆可用"
    run("T02", "投影片：上一頁、下一頁、進度條、章節目錄", t02)

    def t03():
        e = Env(browser, **DESK); p = e.page()
        p.goto(BASE + "#/slides/" + SLIDES[3]["id"]); p.wait_for_selector("#slide h2")
        p.keyboard.press("ArrowRight"); p.wait_for_function("t => document.querySelector('#slide h2').innerText === t", arg=SLIDES[4]["title"])
        p.keyboard.press("ArrowLeft"); p.wait_for_function("t => document.querySelector('#slide h2').innerText === t", arg=SLIDES[3]["title"])
        check(not e.errors, str(e.errors)); e.close()
        return "← → 方向鍵切換正常"
    run("T03", "鍵盤左右方向鍵切換", t03)

    # ------------------------------------------------------------------ T04 逐張走訪
    def t04():
        e = Env(browser, **DESK); p = e.page()
        p.goto(BASE); p.wait_for_selector(".hero")
        bad = []
        for s in SLIDES:
            goto_slide(p, s["id"])
            txt = p.inner_text("#slide")
            if p.inner_text("#slide h2") != s["title"]: bad.append((s["id"], "標題不符"))
            if "undefined" in txt or "[object" in txt or "NaN" in txt: bad.append((s["id"], "出現 undefined/NaN"))
            if f"wiki/{s['wiki']}" not in txt: bad.append((s["id"], "沒有顯示 Wiki 檔名"))
            if not p.locator("#slide .slide-foot .chip").count(): bad.append((s["id"], "沒有來源標籤"))
        check(not bad, str(bad[:5]))
        p.evaluate("location.hash = '#/home'"); p.wait_for_selector(".hero")
        check("6 / 6" in p.inner_text(".progress-card"), "走訪全部投影片後，完成章節應為 6/6：" + p.inner_text(".progress-card")[:60])
        check(not e.errors, str(e.errors)); e.close()
        return f"{len(SLIDES)} 張投影片逐張載入、顯示 Wiki 與來源；首頁顯示完成章節 6/6"
    run("T04", "所有投影片逐張載入與章節完成進度", t04)

    # ------------------------------------------------------------------ T05/T06 卡片
    def cards(deck_slide, n_all, tabs, sample_ko, sample_back):
        e = Env(browser, **DESK); p = e.page()
        p.goto(BASE); p.wait_for_selector(".hero"); goto_slide(p, deck_slide)
        check(p.locator(".mini-grid button").count() == n_all, f"卡片數不是 {n_all}")
        check("flipped" not in (p.get_attribute("#flipBtn", "class") or ""))
        p.click("#flipBtn"); check("flipped" in p.get_attribute("#flipBtn", "class"), "點擊後沒有翻面")
        first_front = p.inner_text("#flipBtn .face.front")
        p.click("#dNext"); check(p.inner_text("#flipBtn .face.front") != first_front, "下一張沒有換卡")
        check("flipped" not in p.get_attribute("#flipBtn", "class"), "換卡後應回到正面")
        p.click("#dPrev"); check(p.inner_text("#flipBtn .face.front").startswith(first_front.split("\n")[0]))
        for label, n in tabs:
            p.click(f".tabs button:has-text('{label}')")
            check(p.locator(".mini-grid button").count() == n, f"{label} 應為 {n}")
        p.click(".tabs button:first-child")
        p.click(f".mini-grid button[aria-label='{sample_ko}']"); p.click("#flipBtn")
        back = p.inner_text("#flipBtn .face.back")
        check(sample_back in back, f"{sample_ko} 背面應含 {sample_back}：{back[:60]}")
        check(p.locator(".deck-ctrl .speak").count() == 1, "沒有喇叭按鈕")
        return e, p
    def t05():
        e, p = cards("c2-cards", 19, [("基本子音", 14), ("緊音", 5)], "ㄱ", "g/k")
        p.click(".tabs button:first-child"); p.click(".mini-grid button[aria-label='ㄲ']"); p.click("#flipBtn")
        shot(p, "03-consonant-card-desktop.png")
        check(not e.errors, str(e.errors)); e.close()
        return "19 張（基本 14／緊音 5）；翻面、上一張／下一張、分類、背面羅馬字"
    run("T05", "子音卡片：翻面、切換、分類", t05)
    def t06():
        e, p = cards("c3-cards", 21, [("基本母音", 10), ("複合母音", 11)], "ㅏ", "a")
        check(not e.errors, str(e.errors)); e.close()
        return "21 張（基本 10／複合 11）"
    run("T06", "母音卡片：翻面、切換、分類", t06)

    # ------------------------------------------------------------------ T07 組合器
    def pick(p, key, jamo):
        p.click(f"[data-key='{key}']:text-is('{jamo}')")
    def t07():
        e = Env(browser, **DESK); p = e.page()
        p.goto(BASE); p.wait_for_selector(".hero"); goto_slide(p, "c4-combiner")
        check(p.inner_text("#combRes") == "한", "預設應為 한")
        cases = [("ㅁ", "ㅜ", "ㄹ", "물"), ("ㅂ", "ㅏ", "ㅂ", "밥"), ("ㅈ", "ㅣ", "ㅂ", "집"), ("ㅊ", "ㅐ", "ㄱ", "책"),
                 ("ㄱ", "ㅏ", "ㅄ", "값"), ("ㄷ", "ㅏ", "ㄺ", "닭"), ("ㅇ", "ㅏ", None, "아"), ("ㄲ", "ㅢ", "ㅎ", None)]
        for l, v, t, want in cases:
            want = expected_syllable(l, v, t)      # 一律用 unicodedata 獨立計算
            pick(p, "l", l); pick(p, "v", v)
            if t: pick(p, "t", t)
            else: p.click("[data-key='t'][data-i='0']")
            got = p.inner_text("#combRes")
            check(got == want, f"{l}+{v}+{t} 應為 {want}，實際 {got}")
        # 全面比對：在瀏覽器內取出 app 的三張索引表，與 unicodedata 獨立算出的 11172 個音節逐一比較
        tables = p.evaluate("({L: Hangul.CHOSEONG, V: Hangul.JUNGSEONG, T: Hangul.JONGSEONG})")
        exp = "".join(expected_syllable(l, v, t or None) for l in tables["L"] for v in tables["V"] for t in tables["T"])
        got_all = p.evaluate("(() => { let s=''; for (let l=0;l<19;l++) for (let v=0;v<21;v++) for (let t=0;t<28;t++) s+=Hangul.compose(l,v,t); return s; })()")
        check(len(exp) == 11172 and got_all == exp, "11172 個音節與 unicodedata 不一致")
        pick(p, "l", "ㅎ"); pick(p, "v", "ㅏ"); pick(p, "t", "ㄴ")
        check("U+D55C" in p.inner_text(".comb-out"), "한 的 Unicode 應為 U+D55C")
        # 終聲提示：ㅅ 有 S8；ㅎ 必須顯示『待補來源』而非讀法
        pick(p, "t", "ㅅ"); check("[ㄷ]" in p.inner_text(".hintbox"), "ㅅ 收音提示應含 [ㄷ]")
        pick(p, "t", "ㅎ"); hb = p.inner_text(".hintbox")
        check("待補來源" in hb and "[ㄷ]" not in hb, "ㅎ 收音不應給出讀法：" + hb)
        pick(p, "l", "ㅇ"); check("不發音" in p.inner_text(".hintbox"), "初聲 ㅇ 應提示不發音")
        # 清除與重新組合
        p.click("#cClear"); check(p.inner_text("#combRes") == "？", "清除後應為 ？")
        check(p.locator("[data-key][aria-pressed='true']").count() == 1, "清除後只剩『無終聲』被選取")
        p.click("#cReset"); check(p.inner_text("#combRes") == "한", "重新組合應回到 한")
        shot(p, "04-combiner-desktop.png")
        pick(p, "l", "ㅁ"); pick(p, "v", "ㅜ"); pick(p, "t", "ㄹ")
        check(not e.errors, str(e.errors)); e.close()
        return f"{len(cases)} 組點選結果與 unicodedata 一致；11172 個音節全數一致；U+D55C；清除／重新組合；ㅎ 收音不給讀法"
    run("T07", "字母組合器：Unicode 組合、清除、重新組合", t07)

    # ------------------------------------------------------------------ T08 拼音練習
    def t08():
        e = Env(browser, **DESK); p = e.page()
        p.goto(BASE); p.wait_for_selector(".hero"); goto_slide(p, "c4-practice")
        check(p.inner_text(".practice .t") == "한")
        p.click("#pCheck"); check("請先選好" in p.inner_text("#pFb"))
        p.select_option("#pl", label="ㅎ"); p.select_option("#pv", label="ㅏ"); p.select_option("#pt", label="ㄴ"); p.click("#pCheck")
        check("正確" in p.inner_text("#pFb"), p.inner_text("#pFb"))
        p.click("#pNext"); check(p.inner_text(".practice .t") == "물")
        p.select_option("#pl", label="ㅁ"); p.select_option("#pv", label="ㅜ"); p.select_option("#pt", label="ㅁ"); p.click("#pCheck")
        fb = p.inner_text("#pFb"); check("錯誤" in fb or "✘" in fb, fb); check("ㅁ ＋ ㅜ ＋ ㄹ ＝ 물" in fb, "錯誤時應顯示正確拆解：" + fb)
        # 焦點在下拉選單時，方向鍵不應切換投影片
        p.focus("#pl"); title = p.inner_text("#slide h2"); p.keyboard.press("ArrowRight")
        check(p.inner_text("#slide h2") == title, "選單內按方向鍵不應換頁")
        check(not e.errors, str(e.errors)); e.close()
        return "正確／錯誤回饋、顯示正確拆解、選單內方向鍵不換頁"
    run("T08", "拼音組合練習", t08)

    # ------------------------------------------------------------------ T09 單字
    def t09():
        e = Env(browser, **DESK); p = e.page()
        p.goto(BASE); p.wait_for_selector(".hero"); goto_slide(p, "c5-cards")
        check(p.locator(".mini-grid button").count() == 20)
        for label, n in [("飲食", 6), ("人物", 5), ("地點", 4), ("物品與時間", 5)]:
            p.click(f".tabs button:text-is('{label}')"); check(p.locator(".mini-grid button").count() == n, f"{label} 應為 {n}")
        p.click(".tabs button:first-child")
        words = SL["decks"]["vocab"]
        for w in words:
            p.click(f".mini-grid button[aria-label='{w['ko']}']")
            check(p.inner_text("#flipBtn .face.front").split("\n")[0] == w["ko"], "正面不符：" + w["ko"])
            p.click("#flipBtn")
            back = p.inner_text("#flipBtn .face.back")
            check(w["zh"] in back and w["roman"] in back, f"{w['ko']} 背面應含 {w['zh']} 與 {w['roman']}")
            check("推導" in back, "背面應標示羅馬字為推導")
        p.click(".mini-grid button[aria-label='물']"); p.click("#flipBtn")
        shot(p, "05-vocab-card-desktop.png")
        check(not e.errors, str(e.errors)); e.close()
        return "20 張單字逐張翻面，中文與羅馬字皆與資料一致；四個分類數量 6／5／4／5"
    run("T09", "單字翻牌（20 個）", t09)

    # ------------------------------------------------------------------ T10/T11 測驗與進度
    def answer(p, q, correct=True):
        box = p.locator(".q").filter(has_text=q["prompt"]).first
        if q["kind"] == "match":
            for i, pr in enumerate(q["pairs"]):
                zh = pr["zh"] if correct else [o for o in q["options"] if o != pr["zh"]][0]
                box.locator(f"select[data-m='{i}']").select_option(label=zh)
            box.locator("[data-check]").click()
        else:
            i = q["answer"] if correct else (q["answer"] + 1) % len(q["choices"])
            box.locator(f"[data-c='{i}']").click()
        return box
    def t10():
        e = Env(browser, **DESK); p = e.page()
        p.goto(BASE + "#/quiz"); p.wait_for_selector(".q")
        check(p.locator("#qList .q").count() == len(QS) == 15, "題數應為 15")
        # 先答錯一題，檢查回饋
        q1 = QS[0]; box = answer(p, q1, correct=False)
        res = box.locator(".result").inner_text()
        check("錯誤" in res and q1["choices"][q1["answer"]] in res and q1["explain"] in res, "錯誤回饋缺少項目：" + res)
        check(f"wiki/{q1['wiki']}" in res and q1["sources"][0] in res, "沒有顯示對應 Wiki 與來源：" + res)
        check(box.locator("button.wrong").count() == 1 and box.locator("button.correct").count() == 1)
        check(box.locator("button:not([disabled])").count() == 0, "作答後應鎖定")
        check("0 / 15" in p.inner_text("#qSummary"), p.inner_text("#qSummary")[:40])
        # 重新作答後全部答對
        p.click("#qReset"); p.wait_for_function("document.querySelectorAll('#qList .q .result').length === 0")
        for q in QS:
            b = answer(p, q, True)
            check("✔ 正確" in b.locator(".result").inner_text(), q["id"])
        check("15 / 15" in p.inner_text("#qSummary") and "全部完成" in p.inner_text("#qSummary"), p.inner_text("#qSummary")[:60])
        shot(p, "06-quiz-desktop.png", full=False)
        check(not e.errors, str(e.errors)); e.close()
        return "15 題；答錯顯示『錯誤、正確答案、解釋、Wiki 章節與來源』；全部答對顯示 15/15"
    run("T10", "小測驗：作答、回饋、計分、重新作答", t10)

    def t11():
        e = Env(browser, **DESK); p = e.page()
        p.goto(BASE + "#/slides/c2-design"); p.wait_for_selector("#slide")
        goto_slide(p, "c1-quiz")
        for q in [q for q in QS if q["chapter"] == 1][:2]: answer(p, q, True)
        p.reload(); p.wait_for_selector("#slide")
        check(p.evaluate("localStorage.getItem('hangulRoom.progress.v1') !== null"), "localStorage 沒有進度資料")
        check(p.get_attribute("#toc [data-slide='c1-quiz']", "aria-current") == "true", "重新整理後應回到上次位置（hash）")
        p.evaluate("location.hash = '#/home'"); p.wait_for_selector(".hero")
        txt = p.inner_text(".progress-card")
        check("2 / 15" in txt, "重新整理後測驗成績應保留：" + txt[:80])
        check(p.locator("#resumeBtn").count() == 1, "應顯示『繼續』按鈕")
        shot(p, "07-progress-home.png", full=True)
        check(not e.errors, str(e.errors)); e.close()
        return "章節小測成績計入總分；重新整理後進度與位置保留（localStorage）"
    run("T11", "學習進度：localStorage 保存與還原", t11)

    # ------------------------------------------------------------------ T12 儲存降級
    def t12():
        e = Env(browser, **DESK)
        p = e.page(["Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')},configurable:true});"])
        p.goto(BASE + "#/quiz"); p.wait_for_selector(".q")
        q = QS[0]; answer(p, q, True)
        check("記憶體模式" in p.inner_text("#topPill"), "頂部應顯示記憶體模式：" + p.inner_text("#topPill"))
        p.evaluate("location.hash = '#/home'"); p.wait_for_selector(".hero")
        check("1 / 15" in p.inner_text(".progress-card"), "同一次瀏覽內成績應保留")
        check("無法儲存" in p.inner_text(".section-title small"), "首頁應說明改用記憶體")
        check(not e.errors, str(e.errors)); e.close()
        return "localStorage 拋出 SecurityError 時，網站仍可作答；進度改存記憶體並提示"
    run("T12", "儲存降級：localStorage 不可用", t12)

    # ------------------------------------------------------------------ T13-T15 語音
    def t13():
        e = Env(browser, **DESK)
        p = e.page(["Object.defineProperty(window,'speechSynthesis',{get(){return undefined},configurable:true});"])
        p.goto(BASE); p.wait_for_selector(".hero"); goto_slide(p, "c2-cards")
        p.click(".deck-ctrl .speak")
        p.wait_for_selector("#toast.show")
        check("不支援" in p.inner_text("#toast"), p.inner_text("#toast"))
        p.click("#flipBtn"); p.click("#dNext"); goto_slide(p, "c4-combiner"); p.click("[data-key='l']:text-is('ㅁ')")
        check(p.inner_text("#combRes") != "", "語音失敗後其他功能仍可用")
        check(not e.errors, str(e.errors)); e.close()
        return "不支援 Web Speech API 時顯示提示，翻牌與組合器仍正常，無 JS 錯誤"
    run("T13", "語音降級：瀏覽器不支援 Web Speech API", t13)

    STUB = """
      window.__spoken = [];
      const stub = { getVoices: () => %s, cancel(){}, speak(u){ window.__spoken.push({text:u.text, lang:u.lang}); } };
      Object.defineProperty(window,'speechSynthesis',{get(){return stub},configurable:true});
    """
    def t14():
        e = Env(browser, **DESK); p = e.page([STUB % "[{lang:'en-US',name:'English'}]"])
        p.goto(BASE); p.wait_for_selector(".hero"); goto_slide(p, "c2-cards")
        p.click(".deck-ctrl .speak"); p.wait_for_selector("#toast.show")
        check("沒有偵測到韓文" in p.inner_text("#toast"), p.inner_text("#toast"))
        check(p.evaluate("window.__spoken.length") == 0, "沒有韓文語音時不應播放")
        check(not e.errors, str(e.errors)); e.close()
        return "有語音引擎但沒有韓文語音時，顯示提示且不播放"
    run("T14", "語音降級：沒有韓文（ko）語音", t14)

    def t15():
        e = Env(browser, **DESK); p = e.page([STUB % "[{lang:'ko-KR',name:'Korean'}]"])
        p.goto(BASE); p.wait_for_selector(".hero"); goto_slide(p, "c2-cards")
        p.click(".deck-ctrl .speak")
        sp = p.evaluate("window.__spoken")
        check(len(sp) == 1 and sp[0]["lang"] == "ko-KR" and sp[0]["text"] == "ㄱ", str(sp))
        goto_slide(p, "c6-g1"); p.locator(".dlg .speak").first.click()
        sp = p.evaluate("window.__spoken"); check(sp[-1]["text"] == "안녕하세요" and sp[-1]["lang"] == "ko-KR", str(sp))
        goto_slide(p, "c6-g2")
        check(p.locator(".dlg .line").nth(2).locator(".speak").count() == 0, "含空格的句子（___）不應提供播放")
        goto_slide(p, "c4-combiner"); p.locator(".comb-out .speak").click()
        sp = p.evaluate("window.__spoken"); check(sp[-1]["text"] == "한", str(sp[-1]))
        check(not e.errors, str(e.errors)); e.close()
        return "有 ko-KR 語音時，utterance.lang 為 ko-KR，且播放的文字正確（以替身物件驗證，非真實發音）"
    run("T15", "語音：ko-KR 呼叫正確", t15)

    # ------------------------------------------------------------------ T16/T17 手機
    def t16():
        e = Env(browser, **MOB); p = e.page()
        p.goto(BASE); p.wait_for_selector(".hero")
        def no_overflow(tag):
            w = p.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
            check(w[0] <= w[1] + 1, f"{tag} 橫向溢出：scrollWidth {w[0]} > {w[1]}")
        no_overflow("首頁")
        shot(p, "08-home-mobile.png", full=True)
        p.click("#startBtn"); p.wait_for_selector("#slide")
        check(p.evaluate("document.querySelector('#toc').getBoundingClientRect().right") <= 1, "手機版目錄預設應收起")
        p.click("#tocBtn"); p.wait_for_timeout(450)
        check(p.evaluate("document.querySelector('#toc').getBoundingClientRect().left") >= -1, "按目錄後應展開")
        open_toc_chapter(p, "c2-cards")
        p.click("#toc [data-slide='c2-cards']"); p.wait_for_selector("#slide h2:has-text('子音卡片')")
        bad = []
        for s in SLIDES:
            goto_slide(p, s["id"])
            w = p.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
            if w[0] > w[1] + 1: bad.append((s["id"], w[0]))
        check(not bad, "以下投影片在 390px 寬度橫向溢出：" + str(bad))
        for sid, name in [("c2-cards", "09-cards-mobile.png"), ("c4-combiner", "10-combiner-mobile.png"), ("c5-cards", "11-vocab-mobile.png"), ("c6-g1", "12-dialogue-mobile.png")]:
            goto_slide(p, sid); shot(p, name, full=True)
        goto_slide(p, "c4-combiner")
        sizes = p.evaluate("[...document.querySelectorAll('.pick-row .grid button')].map(b => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))")
        check(min(sizes) >= 40, f"組合器按鈕太小：{min(sizes)}")
        p.evaluate("location.hash = '#/quiz'"); p.wait_for_selector(".q"); no_overflow("測驗")
        shot(p, "13-quiz-mobile.png")
        p.evaluate("location.hash = '#/knowledge'"); p.wait_for_selector(".kw-section"); no_overflow("Knowledge")
        shot(p, "14-knowledge-mobile.png", full=True)
        check(not e.errors, str(e.errors)); e.close()
        return f"390px 寬：首頁、{len(SLIDES)} 張投影片、測驗、Knowledge 頁皆無橫向溢出；目錄可收合；觸控目標 ≥ 40px"
    run("T16", "手機版（390×844 模擬）版面與目錄", t16)

    def t17():
        e = Env(browser, **MOB); p = e.page()
        p.goto(BASE + "#/slides/" + SLIDES[3]["id"]); p.wait_for_selector("#slide")
        js = """(dx) => { const el=document.querySelector('#slide');
          const mk=(t,x,y)=>new TouchEvent(t,{bubbles:true,cancelable:true,touches:t==='touchend'?[]:[new Touch({identifier:1,target:el,clientX:x,clientY:y})],changedTouches:[new Touch({identifier:1,target:el,clientX:x,clientY:y})]});
          el.dispatchEvent(mk('touchstart',200,300)); el.dispatchEvent(mk('touchend',200+dx,306)); }"""
        p.evaluate(js, -140); p.wait_for_function("t => document.querySelector('#slide h2').innerText === t", arg=SLIDES[4]["title"])
        p.evaluate(js, 140); p.wait_for_function("t => document.querySelector('#slide h2').innerText === t", arg=SLIDES[3]["title"])
        t0 = p.inner_text("#slide h2"); p.evaluate(js, -20)
        check(p.inner_text("#slide h2") == t0, "短距離滑動不應換頁")
        check(not e.errors, str(e.errors)); e.close()
        return "左滑下一頁、右滑上一頁、短距離不換頁（以合成 TouchEvent 驗證，非真實手指）"
    run("T17", "手機觸控滑動切換", t17)

    # ------------------------------------------------------------------ T18 Knowledge
    def t18():
        e = Env(browser, **DESK); p = e.page()
        p.goto(BASE + "#/knowledge"); p.wait_for_selector(".kw-section")
        check(p.locator(".kw-section").count() == 8, "應有 8 個區塊")
        check(p.locator(".kw-section").nth(1).locator("tbody tr").count() == 11, "來源表應有 11 列")
        check(p.locator("svg.flow-svg g").count() == 10, "流程圖應有 10 個節點")
        check(p.locator("svg.flow-svg path[stroke-dasharray]").count() == 5, "應有 5 條失敗返回路徑")
        txt = p.inner_text("#app")
        for must in ["全部尚未完成", "S10", "待處理", "P-01", "⑩", "保留給下一階段", "ㅎ 收音"]:
            check(must in txt, "Knowledge 頁缺少：" + must)
        shot(p, "15-knowledge-desktop.png", full=True)
        check(not e.errors, str(e.errors)); e.close()
        return "8 個區塊、來源表 11 列、流程圖 10 節點與 5 條返回路徑、人工核對狀態與排除項目"
    run("T18", "Knowledge & Workflow 頁面", t18)

    # ------------------------------------------------------------------ T19 file://
    def t19():
        e = Env(browser, **DESK); p = e.page()
        p.goto("file://" + str(ROOT / "index.html")); p.wait_for_timeout(1500)
        if p.locator(".loadfail").count():
            txt = p.inner_text(".loadfail")
            check("http.server" in txt and "file://" in txt, "錯誤畫面應說明原因與解法")
            shot(p, "16-file-protocol-error.png")
            e.close(); return "file:// 開啟：fetch 被瀏覽器擋下，網站顯示友善錯誤與『python3 -m http.server』解法（非空白頁）"
        if p.locator(".hero").count():
            e.close(); return "file:// 開啟：此瀏覽器允許讀取本機 JSON，網站正常載入"
        raise AssertionError("file:// 開啟後既沒有錯誤說明，也沒有載入")
    run("T19", "以 file:// 直接開啟", t19)

    def t20():
        e = Env(browser, **DESK); p = e.page()
        p.goto(f"http://127.0.0.1:{PB}/{ROOT.name}/index.html"); p.wait_for_selector(".hero")
        check(p.locator(".chapter-card").count() == 6)
        p.click("#startBtn"); p.wait_for_selector("#slide")
        p.evaluate("location.hash = '#/knowledge'"); p.wait_for_selector(".kw-section")
        check(not [r for r in e.requests if r.endswith(".json") and f"/{ROOT.name}/" not in r], "JSON 應從子路徑載入")
        check(not e.errors, str(e.errors)); e.close()
        return f"網站放在 /{ROOT.name}/ 子路徑時，所有資料以相對路徑載入成功（模擬 GitHub Pages 專案頁面，非真實部署）"
    run("T20", "子路徑部署模擬（相對路徑）", t20)

    # ------------------------------------------------------------------ T21 內容規則
    def t21():
        e = Env(browser, **DESK); p = e.page()
        p.goto(BASE); p.wait_for_selector(".hero")
        corpus = ""
        for s in SLIDES:
            goto_slide(p, s["id"]); corpus += "\n" + p.inner_text("#slide")
        p.evaluate("location.hash = '#/quiz'"); p.wait_for_selector(".q"); corpus += p.inner_text("#qList")
        forbidden = ["【待補來源】", "【推論】", "【教學設計】", "만나서 반갑습니다", "…입니다", "처음 뵙겠습니다", "김 선생님", "천만에요", "합쇼체 是", "해요체 是", "ㅎ → [ㄷ]"]
        hit = [f for f in forbidden if f in corpus]
        check(not hit, "畫面出現不應使用的內容：" + str(hit))
        check("已人工驗證" not in corpus and "人工驗證完成" not in corpus, "不得宣稱人工驗證完成")
        check("人工核對：尚未完成" in corpus, "應標示人工核對尚未完成")
        check("S10" in corpus and "交叉比對" in corpus, "S10 應只以交叉比對方式出現")
        e.close()
        return "全部投影片與測驗文字中，沒有待補來源標記、S10 單獨句子，也沒有宣稱已人工驗證"
    run("T21", "畫面內容規則（待補、推論、S10、人工核對）", t21)

    def t22():
        e = Env(browser, **DESK); p = e.page()
        p.goto(BASE); p.wait_for_selector(".hero"); p.evaluate("location.hash = '#/knowledge'"); p.wait_for_selector(".kw-section")
        ext = [r for r in e.requests if not r.startswith(f"http://127.0.0.1:{PA}") and not r.startswith("data:")]
        check(not ext, "出現外部請求：" + str(ext))
        e.close()
        return f"共 {len(e.requests)} 個請求，全部來自本機站點，沒有 CDN／外部字型"
    run("T22", "沒有外部資源依賴", t22)

    browser.close()

srv_a.shutdown(); srv_b.shutdown()

p_ = sum(r["status"] == "passed" for r in results)
f_ = sum(r["status"] == "failed" for r in results)
out = {"run_at": time.strftime("%Y-%m-%d %H:%M:%S"), "browser": "Chromium（Playwright，headless）", "passed": p_, "failed": f_, "results": results}
(ROOT / "workflow").mkdir(exist_ok=True)
(ROOT / "workflow/browser-test-results.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\n總結：通過 {p_}／{len(results)}，失敗 {f_}")
sys.exit(1 if f_ else 0)
