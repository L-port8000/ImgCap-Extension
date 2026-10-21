# ImgCap Extension ( for Firefox )

## 機能

- 現在のタブまたは[私のツール](https://site.l-ituki8000.workers.dev/tools/iframe.html)などのiframe項目からURL リストから画像を一括抽出
- 表示されている指定された大きさ以上の画像すべてを自動スクロールして読み込みながらダウンロード

## インストール方法

1. Firefox で `about:debugging#/runtime/this-firefox` を開く
2. 「一時的な拡張機能を読み込む…」(Load Temporary Add-on…) をクリック
3. このフォルダ `ImgCap-Extension-firefox` 内の `manifest.json` を選択

※ 一時的な拡張機能として読み込んだ場合、Firefox を終了すると無効になります。
   恒久的に使いたい場合は、Firefox Developer Edition / Nightly / Unbranded Build で
   `xpinstall.signatures.required = false` を設定して、本フォルダを ZIP 化して
   `.xpi` 拡張子でインストールするか、公式署名済みのパッケージを入手してください。

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
