---
description: 実行中の自動フローの進捗状況を表示します。
---

実行中の `/issue-start --parallel --auto` フローの進捗を一覧表示してください。

## 手順

### 1. ステータスファイルの収集

`/tmp/{project}-flow-{ownerRepo}-*` パターンでステータスファイルを検索する:

```bash
find /tmp -maxdepth 1 -name '{project}-flow-{ownerRepo}-*' -type f 2>/dev/null
```

※ マッチ0件でも正常終了する。0件の場合は手順5（フローがない場合）へ。

`{project}` は**メインリポジトリのディレクトリ名**（`git rev-parse --git-common-dir` からメインリポジトリルートを辿り、その basename を使用。worktree配下でも安定して同じ値になる）。`{ownerRepo}` は `gh repo view --json owner,name -q '.owner.login + "-" + .name'` で取得。

### 2. 各フローの情報を読み取り

各ステータスファイル（`/tmp/{project}-flow-{ownerRepo}-{issue番号}`）はJSON形式。JSONパースに失敗したファイルはスキップし、「ステータスファイル {ファイル名} の読み取りに失敗しました（書き込み途中の可能性）」と警告を出力する。コマンド全体は中断しない:

```json
{
  "issue": 123,
  "branch": "feat/123-example",
  "pr": 456,
  "phase": "polling",
  "worktree": "/path/to/worktree",
  "updated_at": "2026-03-25T00:00:00Z",
  "error": null
}
```

`phase` の値:
- `worktree`: worktree作成中
- `implementing`: 実装中
- `committing`: コミット中
- `pr-created`: PR作成済み
- `polling`: レビューポーリング中
- `reviewing`: レビュー対応中
- `post-action`: ポストアクション実行中
- `completed`: 完了（※ 完了時はファイル削除されるため通常は表示されない）
- `error`: エラーで停止

### 3. 補足情報の収集

まず `{ownerRepo}` を取得する:

```bash
gh repo view --json owner,name -q '.owner.login + "-" + .name'
```

各フローについて、追加情報を収集する:

- **ポーリング中の場合**: idle カウンターファイル（`/tmp/{project}-review-{ownerRepo}-idle-{PR番号}`）を読み、空振り回数を取得（ファイルが存在しない場合は空振り0回として扱う）
- **cronタスク特定**: まずcronタスクIDファイル（`/tmp/{project}-review-{ownerRepo}-cron-{PR番号}`）からタスクIDを取得し、`CronList` で該当ジョブを特定する。タスクIDファイルが存在しない場合に限り、`CronList` から「対象PR番号を含むコマンド全文が完全一致する」ジョブのみを該当タスクとして採用する
- **PR状態**: ステータスファイルの `pr` フィールドが数値（PR番号）として存在する場合にのみ、`gh pr view {PR番号} --json state -q .state` で現在のPR状態を確認。`pr` が `null` の場合はスキップし、一覧上は `-` を表示
- **空振り分母**: 上記で特定したcronタスクのコマンド文字列から `--max-idle N` をパースして表示。該当タスクが特定できない場合は既定値3として扱う
- **エラー時**: ステータスファイルの `error` フィールドからエラー内容を表示

### 4. 一覧表示

以下のフォーマットで出力:

```
## 自動フロー進捗状況

| Issue | ブランチ | PR | フェーズ | 詳細 | 最終更新 |
|-------|---------|-----|---------|------|---------|
| #123  | feat/123-example | #456 | ポーリング中 | 空振り 1/3 | 2分前 |
| #789  | fix/789-bug | - | 実装中 | - | 30秒前 |
```

フェーズの日本語表示:
- `worktree` → worktree作成中
- `implementing` → 実装中
- `committing` → コミット中
- `pr-created` → PR作成済み
- `polling` → ポーリング中
- `reviewing` → レビュー対応中
- `post-action` → ポストアクション中
- `completed` → 完了
- `error` → エラー停止

### 5. フローがない場合

ステータスファイルが見つからない場合:
「実行中の自動フローはありません」と出力

### 6. 古いステータスの警告

以下の基準で、停止している可能性のあるフローに警告を表示する:

- **`polling` 以外のフェーズ**: `updated_at` が30分以上前の場合、「このフローは30分以上更新されていません。停止している可能性があります」と警告
- **`polling` フェーズ**: 以下の優先順で生存確認を行う:
  1. idle カウンターファイルが存在する場合: その最終更新時刻が30分以上前なら警告
  2. idle ファイルが存在しない場合: cronタスクIDファイル（`/tmp/{project}-review-{ownerRepo}-cron-{PR番号}`）からタスクIDを取得し、`CronList` でタスクが稼働中か確認。稼働中でなければ警告
  3. いずれも確認できない場合: ステータスファイルの `updated_at` にフォールバックし、30分以上前なら警告
