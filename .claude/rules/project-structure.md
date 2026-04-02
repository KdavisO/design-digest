---
description: プロジェクト構造と品質ルール
globs: []
---

# プロジェクト構造・品質ルール

## ファイル配置

```
src/
├── diff.ts                  # メインエントリポイント（REST API 経由の差分検出）
├── design-check.ts          # MCP レスポンス JSON 経由の差分検出エントリポイント
├── config.ts                # 環境変数の読み込み・バリデーション
├── figma-client.ts          # Figma REST API クライアント
├── figma-schemas.ts         # Figma API レスポンスの Zod スキーマ定義
├── diff-engine.ts           # deep-diff ベースの差分検出エンジン
├── snapshot.ts              # スナップショットの読み書き（アトミック書き込み対応）
├── notify.ts                # Slack 通知送信
├── claude-summary.ts        # Claude API による差分サマリー生成（オプション）
├── github-issue-client.ts   # GitHub Issue 自動作成（オプション）
├── backlog-client.ts        # Backlog 課題自動作成（オプション）
├── json-utils.ts            # JSON ファイル読み書きユーティリティ
├── adapters/                # Figma データ取得の抽象化レイヤー
│   ├── index.ts             # アダプターのエクスポート
│   ├── figma-data-adapter.ts      # 共通インターフェース定義
│   ├── figma-rest-adapter.ts      # REST API アダプター
│   ├── figma-mcp-adapter.ts       # MCP レスポンスアダプター
│   └── sanitize-helpers.ts        # ノードのサニタイズ処理
└── *.test.ts                # テストファイル（ソースと同階層に配置）
```

- テストファイルはソースファイルと同じディレクトリに `*.test.ts` として配置する
- `assets/` にアイコン画像（SVG, PNG）を配置
- `docs/` にプロジェクトドキュメントを配置
- `.github/workflows/` に GitHub Actions ワークフローを配置

## セキュリティ

- API キー・トークン（`FIGMA_TOKEN`, `SLACK_WEBHOOK_URL`, `ANTHROPIC_API_KEY` 等）は環境変数で管理し、コードにハードコードしない
- `.env` ファイルは `.gitignore` で追跡対象外にする（`.env.example` のみコミット）
- GitHub Actions では GitHub Secrets を使用してトークンを管理する
- `GITHUB_ISSUE_TOKEN` は未設定時に `GITHUB_TOKEN` へフォールバックする設計（`config.ts` 参照）

## コード品質

- パッケージ管理は `pnpm` を使用
- TypeScript strict モードを有効化（`tsconfig.json`: `"strict": true`）
- ESM（`"type": "module"`）で統一、`tsx` で直接実行
- lint: `eslint` + `typescript-eslint`（`npm run lint`）
  - `@typescript-eslint/no-unused-vars`: `_` プレフィックスの引数・変数は許可
- 型チェック: `tsc --noEmit`（`npm run typecheck`）
- テスト: `vitest`（`npm test`）
- `any` の使用を避け、型安全性を重視する
