# DesignDigest - プロジェクト指示

## プロジェクト概要

Figma デザインファイルの変更を1日1回自動検出し、Slack に通知する OSS ツール。
GitHub Actions の cron で定時実行し、Figma REST API からスナップショットを取得、前回との差分を検出して Slack Webhook で通知する。

## 技術スタック

- TypeScript (ESM, `tsx` で直接実行)
- deep-diff (JSON 差分検出)
- Figma REST API v1 / Figma MCP (アダプター層で切替)
- Claude API (オプション: AI による変更要約)
- GitHub Actions (schedule cron による定時実行)
- vitest (テスト)
- eslint (lint)
- npm (パッケージ管理)

## 開発ルール

### コード規約

- TypeScript strict モード (`tsconfig.json` で `strict: true`)
- `any` の使用を避け、厳密な型定義を維持する
- ESM (`"type": "module"`) で記述
- テストファイルは対象モジュールと同階層に `*.test.ts` として配置

### セキュリティ

- API トークン (`FIGMA_TOKEN`, `ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL` 等) は環境変数で管理し、コードにハードコードしない
- `.env` ファイルは `.gitignore` に含める。設定例は `.env.example` に記載
- GitHub Actions では GitHub Secrets を使用

### コミット

- コミットメッセージは日本語で記述可
- 機能単位で細かくコミット

## 重要なファイル

- `src/diff.ts` — メインエントリポイント
- `src/design-check.ts` — MCP 経由のデザインチェック
- `src/config.ts` — 環境変数のパース/検証と `Config` 型定義
- `src/figma-client.ts` — Figma REST API の低レベルラッパー
- `src/adapters/` — Figma データ取得のアダプター層 (REST / MCP)
- `src/diff-engine.ts` — スナップショット比較、レポート生成、Slack フォーマット
- `src/snapshot.ts` — JSON スナップショットの保存・読み込み
- `src/notify.ts` — Slack Webhook 送信
- `src/claude-summary.ts` — Claude API によるページ単位の変更要約
- `src/github-issue-client.ts` — GitHub Issue 自動作成・重複チェック
- `src/backlog-client.ts` — Backlog 課題自動作成・重複チェック
- `.github/workflows/figma-diff.yml` — 定時実行ワークフロー
- `.github/workflows/ci.yml` — CI ワークフロー

## 環境変数

```
# Required
FIGMA_TOKEN=          # Figma Personal Access Token
FIGMA_FILE_KEY=       # 監視対象の Figma ファイルキー (カンマ区切りで複数指定可)

# Optional: Slack 通知
SLACK_WEBHOOK_URL=    # Slack Incoming Webhook URL

# Optional: AI サマリー
ANTHROPIC_API_KEY=    # Claude API キー
CLAUDE_SUMMARY_ENABLED=true

# Optional: GitHub Issue 自動作成
GITHUB_ISSUE_ENABLED=false
GITHUB_ISSUE_TOKEN=   # GitHub トークン (未設定時 GITHUB_TOKEN にフォールバック)
GITHUB_ISSUE_REPO=    # owner/repo 形式
GITHUB_ISSUE_LABELS=  # カンマ区切り
GITHUB_ISSUE_ASSIGNEES= # カンマ区切り

# Optional: Backlog 連携
BACKLOG_ENABLED=false
BACKLOG_API_KEY=
BACKLOG_SPACE_ID=
BACKLOG_PROJECT_ID=
BACKLOG_ISSUE_TYPE_ID=
BACKLOG_PRIORITY_ID=
BACKLOG_ASSIGNEE_ID=

# Optional: Figma 取得の詳細設定
FIGMA_WATCH_PAGES=    # フィルタ対象ページ (カンマ区切り)
FIGMA_WATCH_NODE_IDS= # 特定ノードIDのみ監視 (カンマ区切り)
FIGMA_NODE_DEPTH=     # ノードツリーの取得深度
FIGMA_BATCH_SIZE=5    # チャンク分割時のバッチサイズ

# Defaults
SNAPSHOT_DIR=./snapshots
DRY_RUN=false
```
