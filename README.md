# Kagaribi ICM

[![CI](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/ci.yml/badge.svg)](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/ci.yml)
[![Live](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/live.yml/badge.svg)](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/live.yml)
[![CodeQL](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/codeql.yml/badge.svg)](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/codeql.yml)

ポーカーチェイスのスクリーンショットから、SIT & GO のプリフロップ（オールインかフォールドか）の ICM 最適解を計算する Web アプリ。ポカチェクラブ「燎」向け。

サイト：https://kagaribiicm.wsk641.workers.dev/

- **ICM** — ゲーム（クラブ／ランク STAGE Ⅲ〜Ⅴ／レジェンド）を選び、スクショを読み込む（または手入力）→ 条件確認 → 計算。PC はドラッグ＆ドロップと貼り付け（Ctrl / ⌘ + V）でも読み込める。
- **記録** — 計算した局面が自動で残る。判定・EV・Action tree・13×13 のレンジ・ICM equity・バブルファクター表を見られ、自分の選択（ALL IN / FOLD）を記録すると EV loss を集計する。記録はこの端末に保存される。
- **使い方** — アプリの「?」から、アニメーションの説明を見られる。

2〜6 人に対応。クラブマッチの 2〜5 人は事前計算テーブルで即時、それ以外はブラウザの中で直接解く（数秒〜数十秒）。スマホにインストールでき、一度開けばオフラインでも動く（PWA）。

ポーカーチェイスの運営とは関係のない、非公式のツールです。

## 安全とプライバシー

### ひと目で

- **スクリーンショットは、どこにも送りません。** 画像の読み取りも計算も、あなたの端末のブラウザの中だけで行います。
- **サーバーもデータベースもありません。** 配っているのはアプリのファイルだけで、運営者の手元にあなたのデータは届きません。
- **ログイン・アカウント・Cookie はありません。** 名前もメールアドレスも聞きません。
- **課金・広告・アクセス解析はありません。** このサイト以外からは何も読み込まず、このサイト以外へは通信できない設定です（フォントもこのサイトから配っています）。
- **ここに書いたことは、自動の確認で確かめ続けています。** 結果は誰でも見られます（上のバッジ）。

一方で、**記録はあなたの端末の中にしかありません。** ブラウザのデータを消すと記録も消え、ほかの端末には引き継げません。また、**計算結果が正しいことは保証しません**（読み取りの間違いや、モデルの近似があります）。

以下は、その詳しい中身と根拠です。

### 扱う情報の一覧

| 情報 | 端末の外へ出るか | 端末に保存されるもの | 運営者が見られるか |
|---|---|---|---|
| 読み込んだスクリーンショット | **出ない** | **保存しない**（ページを開いている間だけメモリに置く） | 見られない |
| スクショに写っているほかの人の名前・アイコン | **出ない** | **保存しない**（読み取りもしない。読むのは数字・カード・ボタンの位置だけ） | 見られない |
| 局面（スタック・ブラインド・ハンド・ポジション・ゲーム） | **出ない** | 保存する（ブラウザの IndexedDB。記録タブで 1 件ずつ消せる） | 見られない |
| 計算結果と、自分の選択（ALL IN / FOLD） | **出ない** | 保存する（同上） | 見られない |
| 設定（ライト／ダーク・選んだゲーム・表の開閉） | **出ない** | 保存する（ブラウザの localStorage） | 見られない |
| アプリのファイル（オフラインで動かすため） | — | 保存する（ブラウザのキャッシュ） | — |
| 名前・メールアドレス・パスワード | **そもそも扱わない** | — | — |
| Cookie | **発行しない** | — | — |
| IP アドレス・ブラウザの種類 | 配信元の Cloudflare に届く（サイトを開くとき） | — | 見られない（Cloudflare の管理画面に出るのは、アクセスの回数などの集計だけ） |

外部のサービスに届くもの：

- **Cloudflare**（サイトの配信） — アプリのファイルを取りに行くので、接続の情報（IP アドレスなど）が届く。スクショや局面は届かない。
- それ以外には無い。フォントはこのサイトから配っているので、開いただけで Google に通信することはない。

### 期待できること・できないこと

期待できること：

- スクリーンショット・局面・記録が、端末の外へ送られない。
- アカウントを作らずに使える。使った内容が、運営者やほかの利用者に知られない。
- 一度開けば、通信の無い場所でも使える。
- ほかのサイトにこのアプリを埋め込まれて、だまされて操作させられることがない。

期待できないこと（限界）：

- **配っているファイルを信頼してもらう必要がある。** 外へ送らないのは、配っているコードがそう作られていて、ブラウザに「このサイト以外へ通信させない」と指示しているから。コードは公開していて、下の自動の確認が毎週確かめているが、運営者と配信元（Cloudflare）がファイルを差し替えれば変えられる。
- **記録は端末の中だけにある。** ブラウザのデータを消すと消え、端末を替えても引き継げない。ブラウザによっては、長く開かないでいると消すことがある（iPhone の Safari など。ホーム画面に追加すると消えにくい）。バックアップや同期は無い。
- **端末を触れる人は、記録を見られる。** 記録は暗号化していない。ブラウザの拡張機能など、端末の側で動くものも防げない。
- **計算結果は目安。** スクショの読み取りは間違えることがある（条件確認の画面で確かめ、直せる）。計算は「オールインかフォールドだけ」「ICM（Malmuth-Harville）」「同時オールインは 3 人まで」などの近似の上にあり、収束が不十分なときはそう表示する。
- **第三者による監査は受けていない。** 個人で運営していて、確かめているのは下の自動の確認だけ。

### 仕組みと根拠

想定している相手は、利用者のデータを持ちすぎてしまう運営者自身と、Web の一般的な攻撃です。いちばんの対策は、データを受け取る場所（サーバー）を持たないことです。

| 守ること | 仕組み | 根拠 |
|---|---|---|
| スクショや記録を外へ送らない | 読み取りも計算もブラウザの中（Web Worker）で行う。サーバーのプログラムは無く、配るのは静的なファイルだけ | [wrangler.jsonc](wrangler.jsonc)（Worker のスクリプトを持たない）・[packages/app/src/ocr/prefill.ts](packages/app/src/ocr/prefill.ts)・[packages/app/src/solver.worker.ts](packages/app/src/solver.worker.ts) |
| 万一コードに送る処理が紛れても、ブラウザが止める | 応答ヘッダの CSP で、このサイト以外への通信・このサイト以外からの読み込みを禁じる。スクリプトはこのサイトのファイルだけ | [packages/app/public/_headers](packages/app/public/_headers)。本番に付いているかを毎週確かめる [scripts/live-check.mjs](scripts/live-check.mjs) |
| 開いただけで第三者に通信しない | フォントもこのサイトから配る。アクセス解析や広告の部品を入れない | [packages/app/src/fonts.css](packages/app/src/fonts.css)・[packages/app/index.html](packages/app/index.html) |
| 記録は端末の中だけに置く | ブラウザの IndexedDB に書く。送る処理は無い | [packages/app/src/records/store.ts](packages/app/src/records/store.ts) |
| 画面を乗っ取られない | 入力はスクショから読んだ数値と手入力だけで、表示は React が無害化する。HTML を直接組み立てるのは、使い方ガイドの固定の文言だけ | [packages/app/src/components/guide/guideScript.ts](packages/app/src/components/guide/guideScript.ts)・[packages/app/public/_headers](packages/app/public/_headers) |
| ほかのサイトに埋め込まれない | `frame-ancestors 'none'` と `X-Frame-Options: DENY` | [packages/app/public/_headers](packages/app/public/_headers) |
| 鍵やパスワードを漏らさない | サーバーもデータベースも無いので、秘密の値がそもそも無い。リポジトリにも置いていない | このリポジトリ全体 |
| 計算を間違えにくくする | 700 件を超えるテスト（ICM・ショーダウンの厳密計算・別実装のソルバーどうしの照合・読み取り）を、コードを変えるたびに回す | [packages/solver/test](packages/solver/test)・[packages/ocr/src](packages/ocr/src)・[.github/workflows/ci.yml](.github/workflows/ci.yml) |

### 自動の確認

このページの上のバッジは、次の確認に通っていることを示します（安全を保証するものではありません）。

| 確認 | 何を確かめているか | いつ |
|---|---|---|
| [CI](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/ci.yml) | 型チェック・テスト・ビルド | コードを変えるたび |
| [Live](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/live.yml) | 本番のサイトに届くか。保護ヘッダが付いていて、このサイト以外へ通信できない設定になっているか。配っているファイルに外部の通信先が入っていないか。Cookie を発行していないか。Observatory の評価が A+ のままか | 毎週と、ヘッダや確認の中身を変えたとき |
| [CodeQL](https://github.com/satsuki19980613/kagaribiICM/actions/workflows/codeql.yml) | GitHub 公式のコードスキャン（危ない書き方が無いか） | コードを変えるたびと毎週 |
| [Mozilla HTTP Observatory](https://developer.mozilla.org/en-US/observatory/analyze?host=kagaribiicm.wsk641.workers.dev) | 公開しているサイトの保護ヘッダ。**A+**（OBS_SCORE 点、OBS_TESTS 項目すべて合格。OBS_DATE に測定） | リンク先でいつでも測り直せる |

ほかに、使っている部品に弱点が見つかったら GitHub から知らせが届くようにしています（Dependabot）。

### 問題を見つけたら

[SECURITY.md](SECURITY.md) を見てください。このリポジトリの Security タブから、公開されない形で運営者に知らせることができます。

### この節の書き方について

読む人が確かめやすいよう、次の考え方に沿って書いています。

- **大事なことを先に短く、詳しいことは後ろに**（英国の個人情報保護機関 ICO の「[段階的に示す](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-methods-can-we-use-to-provide-privacy-information/)」考え方）
- **扱う情報を決まった形の表にする**（カーネギーメロン大学の[プライバシーの「栄養成分表示」の研究](https://doi.org/10.1145/1753326.1753561)。Apple や Google のアプリストアの表示も同じ考え方）
- **期待できること・できないことを両方書き、想定する相手と対策の根拠を示す**（[OpenSSF Best Practices](https://www.bestpractices.dev/en/criteria/1) の基準）
- **知らせ方を用意し、動かしている検査を示す**（[GitHub のリポジトリのベストプラクティス](https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories)）

## 読み取れる条件

- プリフロップの画面（フロップ以降は対象外）
- スタックが BB 表示（チップ総額表示は不可）
- オールインとフォールドだけで進んだ場面（3bet・リンプ・レイズへのコールが入った局面は対象外）
- 最初に参加した人の 3bb までのレイズは可（その後は全員オールインかフォールドだけのモデルで、レイズする人のレンジもソルバーが決める）
- 自分の判断がある場面（BB のウォークは対象外）
- 切り抜いていない全画面のスクショ
- 公式ストラクチャーの Sit & Go

## 開発

- 開発：`npm install && npm run dev` → http://localhost:5180/ （[Node.js](https://nodejs.org/) 20 以上）
- 手元で使う：`npm start` → http://localhost:4180/ （ビルドして開く）
- 確認：`npm run typecheck`・`npm test`・`npm run build`。本番のサイトの確認は `node scripts/live-check.mjs`
- デプロイとスマホへのインストール（Cloudflare。`main` に push すると自動で配信）：[DEPLOY.md](DEPLOY.md)

```
packages/
  core/    局面モデル・レンジ記法・ゲームモード（払い出し）
  ocr/     スクショ → 局面（純 TS、テンプレートは assets/*.json）
  solver/  ICM・push/fold ソルバー（artifacts/ に事前計算テーブル）、ミニレイズ・ゲームのソルバー（raiseSolver.ts）
  app/     React + Vite の Web アプリ（PWA）
```

[pocket-ICM](https://github.com/satsuki19980613/pocket-ICM) の読み取りと計算を抜き出し、デザインを [privatematch](https://github.com/satsuki19980613/privatematch) の crystal / square に合わせたものです。
