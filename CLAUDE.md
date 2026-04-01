# DesignDigest

Figma デザインファイルの変更を1日1回自動検出し、Slack に通知する OSS ツール。

## Tech Stack
- TypeScript (ESM, tsx で直接実行)
- deep-diff (JSON 差分検出)
- Figma REST API v1
- Claude API (オプション)
- GitHub Actions (schedule cron)
- vitest (テスト)

## Commands
- `npm run diff` — メイン実行
- `npm run diff:dry-run` — Slack通知なしで実行
- `npm run design-check` — MCPレスポンスJSONを `--input`（または `--input-dir`）で指定して実行する Figma デザイン差分チェック
- `npm run design-check:dry-run` — MCPレスポンスJSONを `--input`（または `--input-dir`）で指定して実行する、Slack通知なしのデザイン差分チェック
- `npm test` — テスト実行
- `npm run lint` — lint実行
- `npm run typecheck` — 型チェック

## Architecture
GitHub Actions cron → Figma API → snapshot比較(deep-diff) → Slack通知
スナップショットは GitHub Actions artifact として保存。

## Key Design Decisions
- Webhook V2 ではなく定時ポーリング（インフラ簡素化、OSS配布容易性）
- sanitizeNode() で absoluteBoundingBox 等を除去（自動更新メタデータのノイズ対策）
- スナップショットを artifact で保存（外部ストレージ不要）
- 同一ノード5件超の変更を集約（ノイズ対策）
