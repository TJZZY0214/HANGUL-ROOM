# HANGUL ROOM — 韓文入門教室

Learn Korean, One Letter at a Time. 純靜態網站（HTML／CSS／JS），無需 Node 建置或後端。教學內容只來自 `wiki/`，來源見 `sources/sources.json`。

## 本機執行
網站用 `fetch` 讀取 `data/*.json`。瀏覽器基於安全限制，**不允許 `file://` 直接開啟時讀取本機 JSON**，會顯示說明畫面。請用 HTTP 靜態伺服器：

```bash
cd hangul-room
python3 -m http.server 8000
# 瀏覽器開啟 http://localhost:8000/
```
所有路徑皆為相對路徑，可放在子路徑（例如 GitHub Pages 專案頁面）。

## 驗證與測試
```bash
python3 -I scripts/validate.py          # 內容與靜態檢查（node 需可用）
pip install playwright && playwright install chromium
python3 -I scripts/browser_test.py --shots   # Chromium 功能測試，截圖存入 screenshots/
```
測試範圍與未執行項目見 `workflow/test-report.md`。

## 注意
- 所有來源的人工核對（human_check）仍為待處理，S10 的韓文尚未人工確認。
- 語音使用瀏覽器 Web Speech API（ko-KR），不代表標準發音；不支援時會顯示提示。
- GitHub Pages 部署尚未進行（第四階段）。

## 單檔版
`hangul-room.html` 是把 HTML、CSS、JS 與所有資料內嵌的單一檔案，可直接雙擊開啟（`file://` 可用，不需伺服器）。由 `python3 -I scripts/build_single.py` 從現有檔案產生；修改任何檔案後請重新執行。
