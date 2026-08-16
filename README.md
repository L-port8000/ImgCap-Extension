# ImgCap Extension

## 機能

- 現在のタブまたは[私のツール](https://site.l-ituki8000.workers.dev/tools/iframe.html)などのiframe項目からURL リストから画像を一括抽出
- 表示されている指定された大きさ以上の画像すべてを自動スクロールして読み込みながらダウンロード

## インストール方法

1. Chrome で `chrome://extensions` を開く
2. 右上の デベロッパーモード を ON
3. パッケージ化されていない拡張機能を読み込むをおす
4. このフォルダ `ImgCap-Extension-main` を選択

## 使い方

1. 画像を取得したいページを開き、ツールバーの ImgCap アイコンをクリック。または ImgCap アイコンをクリックpopupに URL を入力。
2. 最小サイズを設定。並列ダウンロード数はどの値でも良い。特殊画像取得はすべてチェックをつけることを推奨。

3. 抽出開始 をクリック
4. 新しいタブで抽出した画像が表示される。右上の保存ボタンを押せばダウンロード可能。

## 備考

* 画像は **ダウンロードフォルダ/ImgCap/日時_ランダム/** 以下に保存されます。
* 取得には少し時間がかかります。

## ファイル構成

```
chrome-extension/
├── manifest.json
├── background/background.js   # ダウンロード orchestration
├── content/
│   ├── extractor-core.js      # 共通抽出ロジック
│   ├── index.js               # ハンドラ解決・エントリ
│   └── handlers/
│       ├── default.js
│       └── site-handlers.js   # pixiv / rawlazy
├── popup/                     # UI
└── icons/
```
