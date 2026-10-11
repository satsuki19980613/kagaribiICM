# Kagaribi ICM

[![CI](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/ci.yml/badge.svg)](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/ci.yml)
[![Live](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/live.yml/badge.svg)](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/live.yml)
[![CodeQL](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/codeql.yml/badge.svg)](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/codeql.yml)
[![Secrets](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/secrets.yml/badge.svg)](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/secrets.yml)

ポーカーチェイスのスクリーンショットから、SIT & GO のプリフロップにおける ICM 最適解（オールインかフォールドか）を計算する Web アプリ。ポカチェクラブ「燎」向け。

2〜6 人に対応する。クラブマッチの 2〜5 人は事前計算テーブルにより即時に、それ以外はブラウザ内で直接解く（数秒〜数十秒）。スマートフォンにインストールでき、一度開けばオフラインでも動作する（PWA）。ポーカーチェイスの運営とは無関係の非公式ツールである。

**公開サイト**：https://kagaribiicm.wsk641.workers.dev/

## 機能

- **ICM** — ゲーム（クラブ／ランク STAGE Ⅲ〜Ⅴ／レジェンド）を選び、スクリーンショットを読み込む（または手入力する）→ 条件の確認 → 計算。PC ではドラッグ＆ドロップと貼り付け（Ctrl / ⌘ + V）にも対応する。
- **記録** — 計算した局面を自動で保存する。判定・EV・Action tree・13×13 のレンジ・ICM equity・バブルファクター表を閲覧でき、自分の選択（ALL IN / FOLD）を記録すると EV loss を集計する。記録は端末に保存する。
- **使い方** — アプリの「?」から、アニメーションによる説明を閲覧できる。

## 対応する局面

- プリフロップの画面（フロップ以降は対象外）
- スタックが BB 表示であること（チップ総額表示は不可）
- オールインとフォールドのみで進行した局面（3bet・リンプ・レイズへのコールを含む局面は対象外）
- 最初の参加者による 3bb までのレイズは可（以降は全員がオールインかフォールドのみのモデル。レイズする人のレンジは、ソルバーに決めさせるか、上位 10〜30% と仮定するかを選べる）
- 前の人がオールインしている局面は、そのオールインに対する判断として結果を表示する（手入力でも、HERO より前の席を ALL IN に切り替えられる）
- 自分の判断がある局面（BB のウォークは対象外）
- 自分のスタックが 25bb 以下の局面（それより深い場合、読み取りはできても計算は対象外）
- 切り抜いていない全画面のスクリーンショット
- 縮小や加工でぼけていない画像（軽度のぼけは読めるが、読み取った値はすべて「要確認」になる。強くぼけた画像は取り込まない）
- 公式ストラクチャーの Sit & Go

## セキュリティとプライバシー

### 要約

- **スクリーンショットはどこにも送信しない。** 画像の読み取りも計算も、端末のブラウザ内だけで行う。
- **サーバーもデータベースも無い。** 配信するのはアプリのファイルだけで、利用者のデータは運営者に届かない。
- **ログイン・アカウント・Cookie は無い。** 名前もメールアドレスも求めない。
- **課金・広告・アクセス解析は無い。** 自サイト以外からは何も読み込まず、自サイト以外へは通信できない設定である（フォントも自サイトから配信している）。
- **以上の内容は自動検証で継続的に確認している。** 結果は上部のバッジで公開している。

**制約**：記録は端末内にのみ存在する。ブラウザのデータを削除すると記録も失われ、他の端末には引き継げない。また、**計算結果の正しさは保証しない**（読み取りの誤りやモデルの近似がある）。

### 取り扱う情報

| 情報 | 端末外への送信 | 端末内への保存 | 運営者による閲覧 |
|---|---|---|---|
| 読み込んだスクリーンショット | **しない** | **保存しない**（ページ表示中のみメモリに保持） | 不可 |
| スクリーンショットに写る他プレイヤーの名前・アイコン | **しない** | **保存しない**（読み取りもしない。読み取るのは数字・カード・ボタンの位置のみ） | 不可 |
| 局面（スタック・ブラインド・ハンド・ポジション・ゲーム） | **しない** | 保存（ブラウザの IndexedDB。記録タブで 1 件ずつ削除できる） | 不可 |
| 計算結果と自分の選択（ALL IN / FOLD） | **しない** | 保存（同上） | 不可 |
| 設定（ライト／ダーク・選択したゲーム・表の開閉） | **しない** | 保存（ブラウザの localStorage） | 不可 |
| アプリのファイル（オフライン動作のため） | — | 保存（ブラウザのキャッシュ） | — |
| 名前・メールアドレス・パスワード | **扱わない** | — | — |
| Cookie | **発行しない** | — | — |
| IP アドレス・ブラウザの種類 | 配信元の Cloudflare に送信される（サイトを開くとき） | — | 不可（Cloudflare の管理画面に表示されるのはアクセス数などの集計のみ） |

外部サービスに送信される情報：

- **Cloudflare**（サイト配信） — アプリのファイルの取得時。通信を中継するため、接続情報（IP アドレスなど）が送信される。スクリーンショットや局面は送信されない。
- 上記以外には無い。フォントは自サイトから配信しており、ページを開くだけで Google に通信することはない。

### 保証範囲と制約

保証する事項：

- スクリーンショット・局面・記録が端末の外へ送信されない。
- アカウント無しで利用できる。利用内容を運営者や他の利用者に知られない。
- 一度開けば、オフラインでも利用できる。
- 他サイトへの埋め込みによるクリックジャッキングを受けない。

制約：

- **配信するファイルを信頼してもらう必要がある。** 外部に送信しないのは、配信するコードがそのように実装され、ブラウザに自サイト以外への通信を禁じる指示（CSP）を出しているためである。コードは公開しており、下記の自動検証が毎週確認しているが、運営者と配信元（Cloudflare）はファイルを差し替えられる。
- **記録は端末内にのみ存在する。** ブラウザのデータを削除すると失われ、端末を替えても引き継げない。ブラウザによっては、長期間開かないと削除されることがある（iPhone の Safari など。ホーム画面に追加すると削除されにくい）。バックアップや同期の機能は無い。
- **端末を操作できる人は記録を閲覧できる。** 記録は暗号化していない。ブラウザの拡張機能など、端末側で動作するものも防げない。
- **計算結果は目安である。** スクリーンショットの読み取りは誤ることがある（条件の確認画面で確認・修正できる）。計算は「オールインかフォールドのみ」「ICM（Malmuth-Harville）」「同時オールインは 3 人まで」などの近似に基づき、収束が不十分な場合はその旨を表示する。
- **第三者による監査は受けていない。** 個人による運営であり、検証は下記の自動検証に限られる。

### 脅威モデルと対策

想定する脅威は、利用者のデータを過剰に保持してしまう運営者自身と、一般的な Web 攻撃である。最大の対策は、データを受け取るサーバーを持たないことである。

| 対策目標 | 実装 | 根拠 |
|---|---|---|
| スクリーンショットや記録を外部に送信しない | 読み取りも計算もブラウザ内（Web Worker）で行う。サーバーのプログラムは無く、配信するのは静的ファイルのみ | [wrangler.jsonc](wrangler.jsonc)（Worker のスクリプトを持たない）・[packages/app/src/ocr/prefill.ts](packages/app/src/ocr/prefill.ts)・[packages/app/src/solver.worker.ts](packages/app/src/solver.worker.ts) |
| 送信処理が混入してもブラウザが遮断する | CSP で、自サイト以外への通信と自サイト以外からの読み込みを禁止する。スクリプトは自サイトのファイルに限る | [packages/app/public/_headers](packages/app/public/_headers)。本番への適用を毎週検証する [scripts/live-check.mjs](scripts/live-check.mjs) |
| ページを開くだけで第三者に通信しない | フォントも自サイトから配信する。アクセス解析や広告の部品を組み込まない | [packages/app/src/fonts.css](packages/app/src/fonts.css)・[packages/app/index.html](packages/app/index.html) |
| 記録を端末内に限定する | ブラウザの IndexedDB に保存する。送信処理は無い | [packages/app/src/records/store.ts](packages/app/src/records/store.ts) |
| XSS の防止 | 入力はスクリーンショットから読み取った数値と手入力のみで、表示は React がエスケープする。HTML を直接組み立てるのは使い方ガイドの固定文言のみ。確認用に表示する元画像は、選択されたファイルそのものではなく、ブラウザで再描画した画像を使う | [packages/app/src/components/guide/guideScript.ts](packages/app/src/components/guide/guideScript.ts)・[packages/app/src/ocr/decodeImage.ts](packages/app/src/ocr/decodeImage.ts)・[packages/app/public/_headers](packages/app/public/_headers) |
| クリックジャッキングの防止 | `frame-ancestors 'none'` と `X-Frame-Options: DENY` | [packages/app/public/_headers](packages/app/public/_headers) |
| 秘密情報の管理 | サーバーもデータベースも無く、秘密情報自体が存在しない。リポジトリにも置いていない | リポジトリ全体 |
| 計算の誤りの抑制 | 700 件を超えるテスト（ICM、ショーダウンの厳密計算、別実装のソルバー同士の照合、読み取り）をコード変更のたびに実行する | [packages/solver/test](packages/solver/test)・[packages/ocr/src](packages/ocr/src)・[.github/workflows/ci.yml](.github/workflows/ci.yml) |

### 自動検証

上部のバッジは、次の検証の結果を示す（安全性を保証するものではない）。

| 検証 | 内容 | 実行タイミング |
|---|---|---|
| [CI](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/ci.yml) | 型検査・テスト・ビルド | コード変更時 |
| [Live](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/live.yml) | 本番サイトの疎通。セキュリティヘッダーが付与され、自サイト以外へ通信できない設定であること。配信ファイルに外部の通信先が含まれないこと。Cookie を発行していないこと。Observatory の評価が A+ であること | 毎週・ヘッダーや検証内容の変更時 |
| [CodeQL](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/codeql.yml) | GitHub CodeQL による静的解析 | コード変更時・毎週 |
| [Secrets](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/secrets.yml) | gitleaks による秘密情報（API キー・トークン・パスワード・秘密鍵など）の検査。全ブランチの全履歴が対象 | コード変更時・毎週 |
| [Mozilla HTTP Observatory](https://developer.mozilla.org/en-US/observatory/analyze?host=kagaribiicm.wsk641.workers.dev) | 公開サイトのセキュリティヘッダー。**A+**（125 点、12 項目すべて合格。2026-10-10 測定） | リンク先で随時再測定できる |

このほか、依存パッケージの脆弱性を Dependabot で通知している。

### 脆弱性の報告

[SECURITY.md](SECURITY.md) を参照。リポジトリの Security タブから非公開で報告できる。

### 記載方針

本節は次の指針に基づいて構成している。

- 要点を先に、詳細を後に示す（英国 ICO の[段階的な情報提供](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-methods-can-we-use-to-provide-privacy-information/)）
- 取り扱う情報を定型の表で示す（カーネギーメロン大学の[プライバシーの「栄養成分表示」の研究](https://doi.org/10.1145/1753326.1753561)。Apple・Google のアプリストアの表示も同じ考え方）
- 保証範囲と制約、想定する脅威と対策の根拠を示す（[OpenSSF Best Practices](https://www.bestpractices.dev/en/criteria/1)）
- 報告窓口と実施中の検証を示す（[GitHub のリポジトリのベストプラクティス](https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories)）

## 開発

### 必要環境

- [Node.js](https://nodejs.org/) 20 以上

### コマンド

| コマンド | 内容 |
|---|---|
| `npm install` | 依存パッケージのインストール |
| `npm run dev` | 開発サーバー（http://localhost:5180/） |
| `npm start` | ビルドしてローカルで配信（http://localhost:4180/） |
| `npm run typecheck` | 型検査 |
| `npm test` | 単体テスト |
| `npm run build` | 本番ビルド |
| `node scripts/live-check.mjs` | 公開サイトの検証（Live と同じ） |
| `npm run ocr:eval` | 読み取りの評価。全画像を読み取り、項目・席・テーマごとの正答率と誤りの一覧を `ocr-local/report.md` に出力する |
| `npm run ocr:augment` | 正解付きの画像から、縮小・再圧縮・色ずれ・ぼけを加えた複製を生成する（頑健性の検査用）。`npm run ocr:augment -- holdout`（ほかに `fresh`・`check`・`blur`）で条件の異なる組に入れ替える |

読み取りの評価はローカル専用である。`ocr-local/images/` にスクリーンショット、`ocr-local/truth.json` に目視で決めた正解を置く（形式は [truth.example.json](scripts/ocr-eval/truth.example.json)）。`ocr-local/` は、他プレイヤーの名前が写った画像を公開しないため Git の管理対象外とする。`npm run dev` の実行中に http://localhost:5180/ocr-eval.html を開くと、**アプリと同じ経路**（ブラウザでのデコード → 読み取り → 局面の構築 → 計算用 Worker）で評価し、Node での結果との差分も表示する（開発サーバー専用のページで、ビルドには含まれない）。

依存パッケージの追加・更新は `npx npm@11 install <パッケージ>` で行う（npm 10 には vitest 4 の依存関係を解決できない不具合がある。通常の `npm install` / `npm ci` は npm 10 で動作する）。

### ディレクトリ構成

```
packages/
  core/    局面モデル・レンジ記法・ゲームモード（払い出し）
  ocr/     スクリーンショット → 局面（純粋 TS。テンプレートは assets/*.json）
  solver/  ICM・push/fold ソルバー（artifacts/ に事前計算テーブル）、ミニレイズ・ゲームのソルバー（raiseSolver.ts）
  app/     React + Vite の Web アプリ（PWA）
```

### 関連資料

- デプロイとスマートフォンへのインストール（Cloudflare。`main` への push で自動配信）：[DEPLOY.md](DEPLOY.md)
- 由来：[pocket-ICM](https://github.com/satsuki19980613/pocket-ICM) の読み取りと計算を抽出し、デザインを [privatematch](https://github.com/satsuki19980613/privatematch) の crystal / square に合わせたもの
