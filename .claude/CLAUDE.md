# DesignDigest - プロジェクト指示

## プロジェクト概要

Figma デザインファイルの変更を定時ポーリングで自動検出し、Slack・GitHub Issues・Backlog に通知する OSS ツール。
GitHub Actions の schedule cron で平日 10:00 JST に実行される。

## 技術スタック

- TypeScript (ESM, `tsx` で直接実行)
- Node.js >= 18
- npm（パッケージ管理）
- deep-diff（JSON 差分検出）
- zod（バリデーション）
- dotenv（環境変数読み込み）
- Figma REST API v1（デザインデータ取得）
- @anthropic-ai/sdk（AI サマリー生成、オプション）
- GitHub Actions（schedule cron による定時実行）
- vitest（テスト）
- ESLint + typescript-eslint（lint）

## 開発ルール

### コード規約

- ESM（`"type": "module"`）で統一。インポートは `.js` 拡張子付き
- `tsx` で直接実行（ビルドステップなし）
- テストファイルはソースと同階層に `*.test.ts` として配置
- 環境変数の読み込みは `src/config.ts` の `loadConfig()` に集約

### セキュリティ

- API トークン・Webhook URL は環境変数で管理（`.env` はコミット禁止）
- `.env.example` に必要な環境変数の一覧を記載

### コミット

- コミットメッセージは日本語で記述可
- 機能単位で細かくコミット

## 重要なファイル

- `src/diff.ts` — メインエントリポイント（定時差分検出フロー）
- `src/design-check.ts` — MCP レスポンス JSON を入力とするデザイン差分チェック
- `src/config.ts` — 環境変数の読み込み・Config 型定義
- `src/figma-client.ts` — Figma REST API クライアント
- `src/diff-engine.ts` — 差分検出エンジン（deep-diff ベース）
- `src/snapshot.ts` — スナップショットの保存・読み込み（アトミック書き込み）
- `src/notify.ts` — Slack 通知送信
- `src/claude-summary.ts` — Claude API による差分サマリー生成
- `src/github-issue-client.ts` — GitHub Issue 自動作成
- `src/backlog-client.ts` — Backlog 課題自動作成
- `src/adapters/` — Figma データ取得のアダプター層（REST / MCP）
- `src/json-utils.ts` — JSON ファイル読み書きユーティリティ
- `.github/workflows/figma-diff.yml` — 定時実行ワークフロー
- `.env.example` — 環境変数のテンプレート

## 環境変数

```
# 必須
FIGMA_TOKEN=            # Figma Personal Access Token
FIGMA_FILE_KEY=         # 監視対象の Figma ファイルキー（カンマ区切りで複数指定可）

# オプション: Figma 取得設定
FIGMA_WATCH_PAGES=      # フィルタ対象ページ（カンマ区切り）
FIGMA_WATCH_NODE_IDS=   # 監視対象ノード ID（カンマ区切り）
FIGMA_NODE_DEPTH=       # ノードツリー取得深度
FIGMA_BATCH_SIZE=5      # チャンク分割時のバッチサイズ

# オプション: Slack 通知
SLACK_WEBHOOK_URL=      # Slack Incoming Webhook URL
SLACK_ICON_URL=         # 通知アイコン画像 URL
SLACK_ICON_EMOJI=       # 通知絵文字（例: :art:）

# オプション: AI サマリー
ANTHROPIC_API_KEY=      # Claude API キー
CLAUDE_SUMMARY_ENABLED= # true で有効化

# オプション: GitHub Issue 自動作成
GITHUB_ISSUE_ENABLED=   # true で有効化
GITHUB_ISSUE_TOKEN=     # GitHub トークン（未設定時 GITHUB_TOKEN にフォールバック）
GITHUB_ISSUE_REPO=      # owner/repo 形式
GITHUB_ISSUE_LABELS=    # ラベル（カンマ区切り）
GITHUB_ISSUE_ASSIGNEES= # アサイン先（カンマ区切り）

# オプション: Backlog 連携
BACKLOG_ENABLED=        # true で有効化
BACKLOG_API_KEY=        # Backlog API キー
BACKLOG_SPACE_ID=       # スペース ID
BACKLOG_PROJECT_ID=     # プロジェクト ID
BACKLOG_ISSUE_TYPE_ID=  # 課題種別 ID
BACKLOG_PRIORITY_ID=    # 優先度 ID
BACKLOG_ASSIGNEE_ID=    # 担当者 ID

# デフォルト設定
SNAPSHOT_DIR=./snapshots # スナップショット保存先
DRY_RUN=false           # true で Slack 通知をスキップ
```
