#!/usr/bin/env python3
"""HANGUL ROOM 內容驗證（Workflow 節點 ⑦，並在 ⑧ 之後再執行一次）

用法：
  python3 -I scripts/validate.py              # 預設 stage=full（含 HTML／JS 靜態檢查）
  python3 -I scripts/validate.py --stage data # 只驗證資料（生成 HTML 之前）

說明：
- 這支腳本只檢查「格式、對應關係與可追溯性」，不能證明內容本身正確。
- 瀏覽器行為（載入、翻牌、手機版、語音降級）由 scripts/browser_test.py 測試，不在此檢查。
- 結果以 PASS / FAIL / WARN 逐行輸出；有任何 FAIL 時結束碼為 1。
"""
import argparse, hashlib, json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--stage", choices=["data", "full"], default="full")
args = ap.parse_args()

fails = 0
passes = 0
warns = 0


def check(name, cond, detail=""):
    global fails, passes
    if cond:
        passes += 1
        print(f"PASS  {name}" + (f"  ({detail})" if detail else ""))
    else:
        fails += 1
        print(f"FAIL  {name}" + (f"  ({detail})" if detail else ""))


def warn(name, detail=""):
    global warns
    warns += 1
    print(f"WARN  {name}" + (f"  ({detail})" if detail else ""))


def section(title):
    print(f"\n== {title} ==")


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def sha(b):
    return hashlib.sha256(b).hexdigest()


# ---------------------------------------------------------------- A. 既有資料（第二階段檢查）
section("A. 第二階段資料與 Wiki（沿用原檢查）")
src = json.loads(read("sources/sources.json"))
srcs = src["sources"]
ids = [s["source_id"] for s in srcs]
check("sources.json 可解析且有 11 筆 ingest", len(srcs) == 11, f"{len(srcs)} 筆")
check("source_id 不重複", len(set(ids)) == len(ids))
vocab_src = src["vocabulary_entries"]
check("sources.json 有 20 個單字條目且皆 success", len(vocab_src) == 20 and all(v["status"] == "success" for v in vocab_src))

wiki_names = ["index", "01-introduction", "02-consonants", "03-vowels", "04-syllables", "05-vocabulary", "06-conversation"]
wiki = {n + ".md": read(f"wiki/{n}.md") for n in wiki_names}
for n in wiki_names[1:]:
    heads = re.findall(r"^## (\d)\.", wiki[n + ".md"], re.M)
    check(f"{n}.md 具備七段格式", heads == list("1234567"))
    refs = set(re.findall(r"\[(S\d+)\]", wiki[n + ".md"]))
    check(f"{n}.md 來源 ID 皆已定義", refs <= set(ids), str(sorted(refs - set(ids))))

# ---------------------------------------------------------------- B. 既有檔案保護
section("B. 既有檔案保護（不得覆蓋第二階段成果）")
base = json.loads(read("scripts/baseline-hashes.json"))
for f, h in base["locked"].items():
    check(f"未被修改：{f}", sha((ROOT / f).read_bytes()) == h)
for f, info in base["append_only"].items():
    cur = (ROOT / f).read_bytes()
    ok = len(cur) >= info["bytes"] and sha(cur[: info["bytes"]]) == info["sha256"]
    check(f"原內容保留（只可追加）：{f}", ok, f"原 {info['bytes']} bytes，現 {len(cur)} bytes")

# ---------------------------------------------------------------- C. 教學資料可追溯性
section("C. 投影片可追溯性（教學內容 → Wiki → 來源 ID）")
S = json.loads(read("data/slides.json"))
Q = json.loads(read("data/quiz.json"))
slides = S["slides"]
check("slides.json 可解析，且有 6 個章節", len(S["chapters"]) == 6)
check("投影片 id 不重複", len({s["id"] for s in slides}) == len(slides), f"{len(slides)} 張")
check("每章都有投影片", {s["chapter"] for s in slides} == set(range(1, 7)))

MARKERS = ["【待補來源】", "【推論】", "【教學設計】"]


def find_evidence(default_file, needle):
    if "::" in needle:
        f, n = needle.split("::", 1)
    else:
        f, n = default_file, needle
    return f in wiki and n in wiki[f]


bad_ev, bad_src, bad_file = [], [], []
for s in slides:
    if s["wiki"] not in wiki:
        bad_file.append(s["id"])
    for x in s.get("sources", []):
        if x not in ids:
            bad_src.append((s["id"], x))
    if s["type"] != "quiz" and not s.get("evidence"):
        bad_ev.append((s["id"], "沒有 evidence"))
    for e in s.get("evidence", []):
        if not find_evidence(s["wiki"], e):
            bad_ev.append((s["id"], e))
check("每張投影片都指向存在的 Wiki 檔案", not bad_file, str(bad_file))
check("投影片引用的來源 ID 皆已定義", not bad_src, str(bad_src))
check("每張教學投影片都有 evidence，且 evidence 都能在 Wiki 找到", not bad_ev, str(bad_ev[:5]))


def strip_evidence(obj):
    if isinstance(obj, dict):
        return {k: strip_evidence(v) for k, v in obj.items() if k != "evidence"}
    if isinstance(obj, list):
        return [strip_evidence(v) for v in obj]
    return obj


shown_slides = json.dumps(strip_evidence(S), ensure_ascii=False)
shown_quiz = json.dumps(strip_evidence(Q), ensure_ascii=False)
for m in MARKERS:
    check(f"顯示內容不含 Wiki 標記 {m}", m not in shown_slides and m not in shown_quiz)

# 逐一檢查 ch2-ch4 中「待補來源」的項目是否被誤用
section("D. 是否誤用待補來源／推論／S10 單一來源內容")
forbidden_taught = {
    "ㅎ 收音讀法": ["ㅎ → [ㄷ]", "ㅎ→[ㄷ]", "[ㄷ] ㅎ"],
    "排版規則": ["母音放右側", "直式母音", "橫式母音"],
    "完整配對表": ["ㄷ | ㅌ | ㄸ", "ㅂ | ㅍ | ㅃ", "ㅈ | ㅊ | ㅉ"],
    "敬語等級": ["합쇼체 是", "해요체 是", "存待語"],
}
for label, toks in forbidden_taught.items():
    hit = [t for t in toks if t in shown_slides or t in shown_quiz]
    check(f"未講解待補內容：{label}", not hit, str(hit))

s10_only = ["만나서 반갑습니다", "…입니다", "처음 뵙겠습니다", "김 선생님", "천만에요", "또 뵙겠습니다", "수고하세요", "여보세요"]
hit = [t for t in s10_only if t in shown_slides or t in shown_quiz]
check("教學與測驗未使用 S10 單獨出現的句子", not hit, str(hit))

# 對話句：羅馬字須與 Wiki 表一致；空白羅馬字必須對應 Wiki 的【推論】
w6 = wiki["06-conversation.md"]
bad_lines = []
n_lines = 0
for s in slides:
    if s["type"] != "dialogue":
        continue
    for ln in s["lines"]:
        n_lines += 1
        ko, ro, zh = ln["ko"], ln["roman"], ln["zh"]
        if ko not in w6:
            bad_lines.append((ko, "韓文不在 Wiki 第 6 章"))
            continue
        row = [l for l in w6.splitlines() if l.startswith(f"| {ko} |")]
        if not row:
            bad_lines.append((ko, "找不到 Wiki 表格列"))
            continue
        cells = [c.strip() for c in row[0].strip("|").split("|")]
        if ro:
            if cells[1] != ro:
                bad_lines.append((ko, f"羅馬字不符：{cells[1]} ≠ {ro}"))
        else:
            if "【推論】" not in cells[1]:
                bad_lines.append((ko, "省略羅馬字但 Wiki 沒有標推論"))
        if cells[2] != zh:
            bad_lines.append((ko, f"中文不符：{cells[2]} ≠ {zh}"))
check("會話句子（韓文、羅馬字、中文）與 Wiki 第 6 章一致", not bad_lines and n_lines == 13, f"{n_lines} 句；{bad_lines}")
groups = [s for s in slides if s["type"] == "dialogue"]
check("會話為 5 組", len(groups) == 5)
check("S10 僅作交叉比對，未列為主要來源", all("S10" not in s["sources"] for s in groups))

# ---------------------------------------------------------------- E. 20 個單字
section("E. 20 個單字：Wiki、sources.json、投影片三方一致")
vocab = S["decks"]["vocab"]
check("投影片單字為 20 個且不重複", len(vocab) == 20 and len({v["ko"] for v in vocab}) == 20)
w5 = wiki["05-vocabulary.md"]
srcmap = {v["headword"]: v for v in vocab_src}
bad = []
for v in vocab:
    e = srcmap.get(v["ko"])
    if not e:
        bad.append((v["ko"], "sources.json 沒有此單字"))
        continue
    # 同形異義詞（사과）在 sources.json 合併列出兩義，Wiki 表格與投影片只列第一義，故用「子集合」比較
    if not set(v["zh"].split("；")) <= set(e["zh"].split("；")):
        bad.append((v["ko"], f"中文 {e['zh']} ≠ {v['zh']}"))
    if e["romanization_derived"] != v["roman"]:
        bad.append((v["ko"], "羅馬字不符"))
    if v["en"].split(";")[0].strip().lower() not in e["english_gloss"].lower():
        bad.append((v["ko"], f"英文釋義 {e['english_gloss']} ≠ {v['en']}"))
    if f"| {v['ko']} | {v['roman']} | {v['zh']} |" not in w5:
        bad.append((v["ko"], "Wiki 第 5 章表格沒有這一列"))
check("每個單字的韓文、羅馬字、中文與 sources.json／Wiki 一致", not bad, str(bad))
check("四個分類皆出現", {v["cat"] for v in vocab} == {"飲食", "人物", "地點", "物品與時間"})
check("單字詞性皆為名詞（來源 S11）", all(e["pos"].startswith("명사") for e in vocab_src))

section("F. 子音與母音卡片與 Wiki 的羅馬字一致")
w2, w3 = wiki["02-consonants.md"], wiki["03-vowels.md"]
cons, vow = S["decks"]["consonants"], S["decks"]["vowels"]
check("子音卡片 19 張（14 基本＋5 緊音）", len(cons) == 19 and sum(c["group"] == "tense" for c in cons) == 5)
check("母音卡片 21 張（10 基本＋11 複合）", len(vow) == 21 and sum(c["group"] == "basic" for c in vow) == 10)
bad = [c["ko"] for c in cons if not re.search(re.escape(c["ko"] + " " + c["roman"]) + r"(?![a-zA-Z])", w2)]
check("每張子音卡的羅馬字都在 Wiki 第 2 章", not bad, str(bad))
bad = [c["ko"] for c in vow if not re.search(re.escape(c["ko"] + " " + c["roman"]) + r"(?![a-zA-Z])", w3)]
check("每張母音卡的羅馬字都在 Wiki 第 3 章", not bad, str(bad))
bad = [(c["ko"], x) for c in cons + vow + vocab for x in c["src"] if x not in ids]
check("卡片來源 ID 皆已定義", not bad, str(bad))

# ---------------------------------------------------------------- G. 測驗
section("G. 測驗題：答案、來源與 Wiki 一致")
qs = Q["questions"]
check("測驗題數在 10～15 題", 10 <= len(qs) <= 15, f"{len(qs)} 題")
check("題目 id 不重複", len({q["id"] for q in qs}) == len(qs))
check("六個章節都有題目", {q["chapter"] for q in qs} == set(range(1, 7)))
bad = []
for q in qs:
    if q["kind"] != "match":
        if not (0 <= q["answer"] < len(q["choices"])):
            bad.append((q["id"], "答案索引超出範圍"))
        if len(set(q["choices"])) != len(q["choices"]):
            bad.append((q["id"], "選項重複"))
    for x in q["sources"]:
        if x not in ids:
            bad.append((q["id"], f"來源 {x} 未定義"))
    if not q.get("explain"):
        bad.append((q["id"], "沒有解釋"))
    for e in q["evidence"]:
        if not find_evidence(q["wiki"], e):
            bad.append((q["id"], f"evidence 找不到：{e}"))
check("每題答案索引、來源、解釋、Wiki evidence 皆有效", not bad, str(bad))

vz = {v["ko"]: v["zh"] for v in vocab}
bad = []
for q in qs:
    if q["kind"] == "vocab" and "中文意思" in q["prompt"]:
        m = re.search(r"「(.+?)」", q["prompt"])
        ko = m.group(1)
        ans = q["choices"][q["answer"]]
        if ko not in vz or not (ans == vz[ko] or ans in vz[ko].split("；")):
            bad.append((q["id"], ko, ans))
check("單字題的正確答案與單字表一致", not bad, str(bad))

dl = {ln["ko"]: ln["zh"] for s in slides if s["type"] == "dialogue" for ln in s["lines"]}
bad = []
for q in qs:
    if q["kind"] == "match":
        for p in q["pairs"]:
            hit = [k for k in dl if p["ko"] in k.split(" / ")]
            if not hit or dl[hit[0]] != p["zh"]:
                bad.append((q["id"], p))
            if p["zh"] not in q["options"]:
                bad.append((q["id"], "選項缺少", p["zh"]))
check("配對題與會話頁一致", not bad, str(bad))

# 單選題的正確選項在題目中的唯一性：確認非答案的選項沒有與正確答案同義重複
bad = []
for q in qs:
    if q["kind"] != "match":
        ans = q["choices"][q["answer"]]
        if q["choices"].count(ans) != 1:
            bad.append(q["id"])
check("正確選項唯一", not bad, str(bad))

pr = Q["practice"]["dialogue"]
bad = []
for p in pr:
    if not (0 <= p["answer"] < len(p["choices"])):
        bad.append((p["id"], "索引"))
    for e in p["evidence"]:
        if not find_evidence(p["wiki"], e):
            bad.append((p["id"], e))
check("對話練習 4 題：答案與 Wiki evidence 有效", len(pr) == 4 and not bad, str(bad))

# ---------------------------------------------------------------- H. 組合器練習與 Unicode
section("H. 拼音練習與 Unicode 組合規則")
L = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
V = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
T = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"]
check("Unicode 索引表長度（19 初聲、21 中聲、28 終聲含無）", len(L) == 19 and len(V) == 21 and len(T) == 28)
check("終聲 27 個 = 16 單子音 + 11 雙子音（對照 S1）", len(T) - 1 == 27 and sum(1 for t in T[1:] if t in "ㄱㄲㄴㄷㄹㅁㅂㅅㅆㅇㅈㅊㅋㅌㅍㅎ") == 16)


def decompose(ch):
    c = ord(ch) - 0xAC00
    return L[c // 588], V[(c % 588) // 28], T[c % 28]


bad = []
for p in S["practice_targets"]:
    l, v, t = decompose(p["target"])
    if p["target"] not in w5 and p["target"] not in wiki["01-introduction.md"]:
        bad.append((p["target"], "不在 Wiki"))
check("練習目標音節都來自 Wiki 第 1、5 章，並可由公式拆解", len(S["practice_targets"]) == 5 and not bad, str(bad))

if (ROOT / "js/hangul.js").exists():
    r = subprocess.run(["node", str(ROOT / "scripts/test_hangul.js")], capture_output=True, text=True)
    print(r.stdout.rstrip())
    check("js/hangul.js 的 Unicode 組合與 Unicode 正規化結果一致（node 測試）", r.returncode == 0, r.stderr.strip()[:200])
else:
    warn("js/hangul.js 尚未建立，略過 node 組合測試（stage=data）")

# ---------------------------------------------------------------- I. 流程資料
if (ROOT / "data/workflow.json").exists():
    section("I. 流程展示資料")
    W = json.loads(read("data/workflow.json"))
    check("workflow.json 可解析，節點 ①～⑩ 俱全", [n["no"] for n in W["nodes"]] == list("①②③④⑤⑥⑦⑧⑨⑩"))
    allowed = {"done", "partial", "not_started", "reserved"}
    check("節點狀態值合法", all(n["status"] in allowed for n in W["nodes"]))
    check("⑩ 部署未標為已完成", [n for n in W["nodes"] if n["no"] == "⑩"][0]["status"] in ("not_started", "reserved"))

# ---------------------------------------------------------------- J. HTML／JS 靜態檢查
if args.stage == "full":
    section("J. 網站檔案靜態檢查（不能取代瀏覽器測試）")
    files = ["index.html", "css/style.css", "js/app.js", "js/hangul.js", "data/slides.json", "data/quiz.json"]
    missing = [f for f in files if not (ROOT / f).exists()]
    check("必要檔案都存在", not missing, str(missing))
    if not missing:
        html, js, css = read("index.html"), read("js/app.js"), read("css/style.css")
        check("HTML 引用 css/style.css、js/hangul.js、js/app.js（相對路徑）", all(x in html for x in ['href="css/style.css"', 'src="js/hangul.js"', 'src="js/app.js"']))
        ext = re.findall(r"""(?:src|href)\s*=\s*["'](https?:)?//""", html)
        check("HTML 沒有外部資源（無 CDN、無外部字型）", not ext)
        check("CSS 沒有外部網址", "http://" not in css and "https://" not in css and "@import" not in css)
        bad = re.findall(r"""fetch\(\s*["'`]/""", js)
        check("fetch 使用相對路徑（可在 GitHub Pages 子路徑執行）", not bad)
        check("JS 以相對路徑載入資料", all(p in js for p in ["data/slides.json", "data/quiz.json", "sources/sources.json", "data/workflow.json"]))
        check("localStorage 存取包在 try/catch 內，並有記憶體降級", "try" in js and "localStorage" in js and "memoryStore" in js)
        check("語音使用 ko-KR 並有 speechSynthesis 偵測", "ko-KR" in js and "speechSynthesis" in js)
        check("沒有使用 eval 或 document.write", "eval(" not in js and "document.write" not in js)
        check("HTML 含 viewport（RWD）", 'name="viewport"' in html)
        for color in ["#FAF9F6", "#E8E7E4", "#D9D0F0", "#333333", "#FFFFFF"]:
            check(f"CSS 使用指定配色 {color}", color.lower() in css.lower())
        # JS 語法檢查
        for f in ["js/app.js", "js/hangul.js"]:
            r = subprocess.run(["node", "--check", str(ROOT / f)], capture_output=True, text=True)
            check(f"{f} 語法檢查（node --check）", r.returncode == 0, r.stderr.strip()[:200])

print(f"\n總結：PASS {passes}　FAIL {fails}　WARN {warns}")
sys.exit(1 if fails else 0)
