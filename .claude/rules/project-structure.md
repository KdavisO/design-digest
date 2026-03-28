---
description: プロジェクト構造と品質ルール
globs: []
---

# プロジェクト構造・品質ルール

## ファイル配置

- エントリポイント: `src/diff.ts`（メイン実行）, `src/design-check.ts`（MCP経由のデザインチェック）
- 設定: `src/config.ts` — 環境変数のパース/検証と `Config` 型定義
- Figma API クライアント: `src/figma-client.ts` — REST API の低レベルラッパー
- アダプター層: `src/adapters/` — Figma データ取得の抽象化
  - `figma-data-adapter.ts` — 共通インターフェース（`FigmaDataAdapter`）
  - `figma-rest-adapter.ts` — REST API 実装
  - `figma-mcp-adapter.ts` — MCP 経由の実装
  - `index.ts` — アダプターの re-export
- 差分検出: `src/diff-engine.ts` — スナップショット比較、レポート生成、Slack フォーマット
- スナップショット管理: `src/snapshot.ts` — JSON スナップショットの保存・読み込み
- 通知: `src/notify.ts` — Slack Webhook 送信
- AI サマリー: `src/claude-summary.ts` — Claude API によるページ単位の変更要約
- 外部連携:
  - `src/github-issue-client.ts` — GitHub Issue 自動作成・重複チェック
  - `src/backlog-client.ts` — Backlog 課題自動作成・重複チェック
- テストファイル: 各モジュールと同階層に `*.test.ts` として配置（例: `src/diff-engine.test.ts`）
- GitHub Actions: `.github/workflows/figma-diff.yml`（定時実行）, `.github/workflows/ci.yml`（CI）
- ドキュメント: `docs/` — 設計ドキュメント・調査記録

## セキュリティ

- API トークン（`FIGMA_TOKEN`, `ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL` 等）は環境変数で管理し、コードにハードコードしない
- `.env` ファイルは `.gitignore` に含める。設定例は `.env.example` に記載
- GitHub Actions では GitHub Secrets を使用してトークンを注入する
- 外部 API へのリクエスト（Figma, Slack, Claude, GitHub, Backlog）には適切なエラーハンドリングを実装する

## コード品質

- パッケージ管理は `npm` を使用（`package-lock.json` をコミット）
- TypeScript は ESM（`"type": "module"`）で記述し、`tsx` で直接実行
- `any` の使用を避け、厳密な型定義を維持する（`tsconfig.json` で `strict: true`）
- テストは `vitest` を使用。テストファイルは対象モジュールと同階層に配置
- lint は `eslint` を使用（`eslint.config.js` で設定）
- 検証コマンド: `npm test`, `npm run lint`, `npm run typecheck`
