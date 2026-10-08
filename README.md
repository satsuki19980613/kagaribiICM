# Kagaribi ICM

ポーカーチェイスのスクリーンショットから、push/fold の ICM 最適解を計算するローカル Web アプリです。
画像の解析（OCR）も計算も **すべて端末内で完結** し、どこにも送信しません。記録は端末のブラウザ（IndexedDB）に保存されます。

[pocket-ICM](https://github.com/satsuki19980613/pocket-ICM) の ICM 読み取り・計算機能だけを抜き出し、
デザインを [privatematch](https://github.com/satsuki19980613/privatematch) の crystal / square に置き換えたものです。

## 機能

- **ICM タブ**: ゲーム（クラブ／ランク STAGE Ⅲ〜Ⅴ／レジェンド）を選び、スクショを読み込む（または手入力）→ 条件確認 → 計算
  - PC ではドラッグ＆ドロップ、貼り付け（Ctrl / ⌘ + V）でも読み込めます
  - 読み取り結果は元画像と照合でき、ゲームを選び直しての読み直し・人数の補正・手入力での修正ができます
- **記録タブ**: 計算した局面が自動で残ります（計算中／完了／失敗・中断）。結果画面では判定・EV・Action tree と 13×13 レンジ・ICM equity を確認し、自分の選択（ALL IN / FOLD）を記録すると EV loss を集計します
- 2〜6 人に対応。クラブマッチの 2〜5 人は事前計算テーブルで即時、それ以外は Web Worker 並列の直接求解（数秒〜十数秒）
- ライト／ダーク（背景に焚き火の炎がゆらめく）、PWA（インストール可・オフライン動作）

## 起動（Windows / macOS / Linux 共通）

[Node.js](https://nodejs.org/) 20 以上が必要です。

```bash
npm install
```

```bash
npm start
```

ビルドしてブラウザで `http://localhost:4180` を開きます。同じネットワークのスマホから使う場合は `npm run preview -- --host` で表示される URL を開いてください。

開発用（ホットリロード）は `npm run dev`（`http://localhost:5180`）。

## スマホで使う（インストール）

非公開リポジトリのまま Cloudflare（無料）から配信します。初回の取り込み手順とインストール方法は [DEPLOY.md](DEPLOY.md) を参照してください。
取り込み後は `main` に push するたび自動で再デプロイされます。

## 読み取れる条件

- プリフロップの画面（フロップ以降は対象外）
- スタックが BB 表示（チップ総額表示は不可）
- オールインとフォールドだけで進んだ場面（レイズ・リンプが入った局面は対象外）
- 自分の判断がある場面（BB のウォークは対象外）
- 切り抜いていない全画面のスクショ
- 公式ストラクチャーの Sit & Go

## 構成

```
packages/
  core/    局面モデル・レンジ記法・ゲームモード（払い出し）
  ocr/     スクショ → 局面（純 TS、テンプレートは assets/*.json）
  solver/  ICM・push/fold ソルバー（artifacts/ に事前計算テーブル）
  app/     React + Vite の Web アプリ（PWA）
```

| コマンド | 内容 |
| --- | --- |
| `npm test` | 単体テスト（Vitest） |
| `npm run typecheck` | 型チェック |
| `npm run icons` | `packages/app/public/icon.svg` から PWA アイコン PNG を生成 |
