# ImgCap Extension ( for Firefox )

## 機能

- 現在のタブまたは[私のツール](https://site.l-ituki8000.workers.dev/tools/iframe.html)などのiframe項目からURL リストから画像を一括抽出
- 表示されている指定された大きさ以上の画像すべてを自動スクロールして読み込みながらダウンロード

## インストール方法

1. Firefox で `https://addons.mozilla.org/ja/firefox/addon/imgcap` を開く
2. Firefoxへ追加をクリック
3. ツールバーにピン留めをクリック

### 動作環境

- Firefox 115 以降
  - `chrome.storage.session` API を使用するため 115 以上が必要です。
  - `chrome.scripting.executeScript` の `func` / `args` 形式を使用するため、実質 102 以上で動作します。

## 使い方

1. 画像を取得したいページを開き、ツールバーの ImgCap アイコンをクリック。または ImgCap アイコンをクリックpopupに URL を入力。
2. 最小サイズを設定。並列ダウンロード数はどの値でも良い。特殊画像取得はすべてチェックをつけることを推奨。

3. 抽出開始 をクリック
4. 新しいタブで抽出した画像が表示される。右上の保存ボタンを押せばダウンロード可能。

## 備考

* 画像は ダウンロードフォルダ/ImgCap/日時_ランダム/ 以下に保存されます。
* 取得には少し時間がかかります。

## Chrome 版との差分

* `manifest.json`
  * `browser_specific_settings.gecko` を追加 (Firefox 用の拡張機能IDと最小バージョン指定)
  * `background.service_worker` ではなく `background.scripts` を使用 (Firefox の event page モード)
* 各スクリプト (`background/background.js`, `popup/popup.js`, `preview/preview.js`)
  * 先頭に `chrome` ↔ `browser` API エイリアスを追加し、Firefox / Chrome 両環境で動作するようにしました。
  * それ以外は Chrome 版と同じコードです (Firefox は `chrome.*` API を Promise ベースでサポート)。

## ファイル構成

```
ImgCap-Extension-firefox/
├── manifest.json
├── background/background.js
├── content/
│   ├── extractor-core.js
│   ├── index.js
│   └── handlers/
│       ├── default.js
│       └── site-handlers.js
├── popup/
└── icons/
```
