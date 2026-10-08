# デプロイ手順（スマホにインストールできるようにする）

このアプリは **端末ローカル完結**（サーバー不要・計算はすべてブラウザ内）なので、ビルドした静的ファイルを
置くだけで動きます。**リポジトリは非公開のまま** 配信できる **Cloudflare**（無料）で配ります
（pocket-ICM と同じ方法）。初回だけ下記の操作が必要です（数分）。

> GitHub Pages は無料プランだと非公開リポジトリから配信できないため使いません。

## 1. Cloudflare に取り込む（初回のみ）

配信設定 `wrangler.jsonc`（リポジトリ直下・`assets.directory=packages/app/dist`・Worker スクリプト無し）と
配信ヘッダー `packages/app/public/_headers` はコミット済みです。ダッシュボードでは取り込んで Deploy を押すだけです。

1. https://dash.cloudflare.com/ にログイン
2. **Workers & Pages** → **Create** → リポジトリ **`kagaribiICM`** を **Import**
   （GitHub アプリが kagaribiICM にアクセスできない場合は、表示に従ってこのリポジトリへのアクセスを許可）
3. セットアップ画面で：

   | 項目 | 値 |
   |------|-----|
   | Project name | `kagaribiicm` |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy`（初期表示のまま） |
   | Protect with Cloudflare Access | OFF（ON だと閲覧にログインが要る） |

   Node は `.node-version`（= 22）で固定済み。
4. **Deploy** → 1〜2 分でビルド＆デプロイされ、`https://kagaribiicm.<サブドメイン>.workers.dev` が発行されます（本番: https://kagaribiicm.wsk641.workers.dev ）。

以降は **`main` に push するたび自動で再デプロイ** されます。

## 2. インストール（ホーム画面に追加）

- **iPhone（Safari）**: 発行 URL を開く → 共有ボタン → **「ホーム画面に追加」**
- **Android（Chrome）**: 発行 URL を開く → メニュー → **「アプリをインストール」**
- **PC（Chrome / Edge）**: 発行 URL を開く → アドレスバー右の **インストール** アイコン

炎のアイコンで起動し、一度開けばオフラインでも動きます（PWA）。
4 人テーブル（約 11MB）と 3-way 結果テーブル（約 21MB）は、初めてその人数を計算したときにダウンロードして保存します。

## 更新が届くまで

新しい版を push すると、アプリは次に開いたときに新しい版を受け取り、
「新しいバージョンがあります」と出ます（タップで更新。操作していないときに裏へ回すと自動で入れ替わります）。

## PC だけで使う場合

Cloudflare を使わず、手元で `npm start` してもかまいません（`http://localhost:4180`）。
Chrome / Edge ならこの URL からもインストールできます（起動中のときだけ開けます）。
