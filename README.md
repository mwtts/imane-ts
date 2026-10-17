# IMANE (TypeScript 版)

IMANE-PC（コンピュータ演習形式のサイバーインシデント対応シミュレーション）を、Bun + Hono + React で作り直したものです。
シナリオデータ（`actions.json` / `replies.json` / `states.json` / `contacts.json` / `setting.json` / `points.json`）は Java 版と同じ形式のまま使えます。

## 構成

```
packages/
  shared/   型定義・ステート条件式の評価・特殊メンバ(サーバとクライアントで共有)
  server/   Bun + Hono の API と WebSocket、演習ワークフローエンジン
    data/scenarios/  シナリオセット(直下が既定、サブディレクトリが追加のシナリオセット)
    data/sys/        全シナリオ共通の既定データと product.json
  client/   React + Vite の画面(演習コンソール / 振り返り / ファシリテータ用コンソール)
```

## 使い方

前提: [Bun](https://bun.sh) 1.4 以降

```sh
bun install
bun run build          # クライアントをビルド (packages/client/dist)
bun run start          # http://localhost:8080/ で起動
```

開発時は `bun run dev:server` と `bun run dev:client`（Vite、`/api` をサーバに中継）を別々に起動します。

| 環境変数 | 既定値 | 説明 |
| --- | --- | --- |
| `PORT` | `8080` | 待ち受けポート |
| `DATA_DIR` | `packages/server/data` | シナリオデータの格納先 |
| `STATIC_DIR` | `packages/client/dist` | 配信するクライアント |
| `CHECK_INTERVAL` | `1000` | 自動アクション・トリガー・キューを評価する間隔(ミリ秒) |
| `ALLOW_PASSWORDLESS_ADMIN` | (未設定) | `true` で passwd 未設定のファシリテータのログインを許す(ローカル試用向け) |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

### ファシリテータのパスワード

`isadmin: true` のメンバは、`contacts.json` に `passwd` を設定しないとログインできません。ハッシュは次のように作れます。

```sh
bun run hash-password 'your-password'   # => {SHA256}....
```

`{SHA}` / `{MD5}` 形式（Java 版と同じ）や平文も使えます。同梱のサンプルシナリオを試すだけなら `ALLOW_PASSWORDLESS_ADMIN=true bun run start` で起動してください。

### 演習の流れ

1. ファシリテータでログインし、「ファシリテータ用コンソール」でフェーズを選んで開始する
2. 参加者はチームと役割を選んでログインし、「演習コンソール」でアクションを実行する
3. 「振り返り」でイベント履歴をシーケンス図として表示する

## テスト

```sh
bun run test        # サーバ(エンジン・シナリオ・API)とクライアント(シーケンス図生成)
bun run typecheck
```

## Storybook

```sh
bun run storybook         # http://localhost:6006/ で起動
bun run build-storybook   # 静的ビルド (packages/client/storybook-static)
```

## Java 版からの主な変更点

- ログインセションがユーザごとに独立した(旧版はサーバ全体で1つで、複数人が同時に使うと最後にログインしたユーザとして動作していた)
- アクションはIDで受け付け、カードの内容・実行可否・添付ステートの所有をサーバで検証する
- API に認証と権限(参加者/ファシリテータ)を設けた。応答にパスワードハッシュを含めない
- ポイントカードの `before`/`after` の判定が逆になっていたのを修正
- `from` のないトリガーイベント、`AND(...)` 形式のユーザステート条件、中断後に発火する自動アクションなどの不具合を修正
- シナリオのアップロードは検証に通った場合だけ配置する
- 演出効果は sandbox 付きの iframe で表示する(`javascript:` 形式は廃止)
- 状態の保存形式は新しい形式(`imane-workflow` v1)で、Java 版の保存データとは互換性がない
- 操業レベル(`operationstate.json`)と未実装だった `resource` API は移植していない