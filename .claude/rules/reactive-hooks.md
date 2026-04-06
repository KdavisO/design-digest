---
description: CwdChanged/FileChangedフックによるリアクティブ環境設定のベストプラクティス
globs: []
---

# リアクティブフック活用ベストプラクティス

## 概要

`CwdChanged` / `FileChanged` フックイベントを利用して、Claude Code のセッション中に環境を自動同期する。モノレポでサービスごとに異なる環境変数を使い分ける場合に特に有効。

## ユースケース

### モノレポでの環境分離

```
monorepo/
  services/
    api/        # DATABASE_URL=postgres://api-db/...
    worker/     # DATABASE_URL=postgres://worker-db/...
    web/        # NEXT_PUBLIC_API_URL=...
```

`CwdChanged` フックで direnv を連携すると、Claude が `services/api/` に移動した際に自動で `api` 用の環境変数がロードされ、間違った接続先でDB操作する事故を防止できる。

### 環境変数の変更検知

`FileChanged` フックで `.envrc` / `.env` を監視すると、ファイル編集後に手動で環境をリロードする必要がなくなる。

## 設計指針

- **タイムアウトは短く設定する**: フックはツール実行のたびに発火する可能性があるため、10秒以下を推奨
- **エラーを握りつぶさない**: `2>/dev/null` は direnv のインストール確認メッセージ等の抑制に限定し、実際のエラーは表面化させる
- **冪等性を保つ**: フックは何度実行されても同じ結果になるようにする
- **副作用を最小限にする**: 環境変数のリロードに留め、ファイルの書き換えやプロセスの起動は避ける

## direnv 未使用の場合

direnv を使わない場合は `CwdChanged` フックの代わりに、プロジェクト固有のスクリプトを用意する:

```json
{
  "hooks": {
    "CwdChanged": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "if [ -f .env ]; then set -a && . .env && set +a && sh -c 'for key in NODE_ENV PORT; do eval \"value=\\${$key}\"; [ -n \"$value\" ] && printf \"%s=%s\\n\" \"$key\" \"$value\"; done'; fi",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

## セキュリティ上の注意

- `.env` ファイルを直接 source する場合、ファイル内の任意のシェルコマンドが実行される点に注意
- フックコマンドから機密情報がログに出力されないようにする
- 信頼できないディレクトリの `.envrc` / `.env` を自動ロードする場合は `direnv allow` の許可範囲を限定する
