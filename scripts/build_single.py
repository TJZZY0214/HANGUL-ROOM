#!/usr/bin/env python3
"""把 index.html、CSS、JS 與所有 JSON 資料內嵌成單一檔案 hangul-room.html（可直接雙擊開啟，無需伺服器）。
用法：python3 -I scripts/build_single.py
"""
import json, pathlib, re
R = pathlib.Path(__file__).resolve().parent.parent
rd = lambda f: (R / f).read_text(encoding="utf-8")
html = rd("index.html")
data = {f: json.loads(rd(f)) for f in ["data/slides.json", "data/quiz.json", "data/workflow.json", "sources/sources.json"]}
blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/").replace("<!--", "<\\!--")
css = rd("css/style.css").replace("</style", "<\\/style")
def js(f): return rd(f).replace("</script", "<\\/script")
html = html.replace('<link rel="stylesheet" href="css/style.css">', "<style>\n" + css + "\n</style>")
html = html.replace('<script src="js/hangul.js"></script>', "<script>\nwindow.__HANGUL_DATA__ = " + blob + ";\n</script>\n<script>\n" + js("js/hangul.js") + "\n</script>")
html = html.replace('<script src="js/app.js"></script>', "<script>\n" + js("js/app.js") + "\n</script>")
assert 'href="css/' not in html and 'src="js/' not in html
(R / "hangul-room.html").write_text(html, encoding="utf-8")
print("hangul-room.html", len(html.encode()), "bytes")
