---
description: GitHub Issue に対応するPRを作成してください。
---

GitHub Issue に対応するPRを作成してください。

引数: `$ARGUMENTS`

## 引数の解析

- `--auto` フラグの有無を判定する（指定があってもなくてもよいオプション）
- `--auto` 以外のトークンから **Issue番号となる正の整数をちょうど1つだけ** 取得する
  - Issue番号は必須（数値トークンが1つもない場合はエラーとし、「Issue番号（正の整数）を1つ指定してください」と案内する）
  - 数値トークンが2つ以上ある場合もエラーとし、「Issue番号は1つだけ指定してください（例: `123` や `--auto 123`）」と案内する
- 有効な例: `123`, `--auto 123`, `123 --auto`
- エラーになる例:
  - `--auto` のみ（Issue番号が指定されていない）
  - `123 456`（数値トークンが複数ある）
  - `--auto 123 456`（数値トークンが複数ある）

## 手順

1. `gh issue view {issue番号}` でIssue内容を確認する
2. `git status` と `git diff` で変更内容を確認する
3. コミットされていない変更があればコミットする
4. リモートにpushする:
   ```
   git push -u origin HEAD
   ```
5. `gh pr create` でPRを作成する:
   - タイトル: Issueのタイトルに基づく簡潔な説明
   - 本文は以下のフォーマット:

```
## 概要
<!-- Issueの要件に対して何をしたか -->

## 変更内容
<!-- 変更ファイルと内容の箇条書き -->

## テスト方法
<!-- 動作確認の手順 -->

Closes #{issue番号}
```

6. PR作成後、Copilotレビューをリクエストし、成功を確認する:

   1. レビューリクエストを送信:
      ```bash
      gh api repos/{owner}/{repo}/pulls/{PR番号}/requested_reviewers --method POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
      ```

   2. リクエストが成功したか確認（`requested_reviewers` にCopilotが含まれているか）:
      ```bash
      gh api repos/{owner}/{repo}/pulls/{PR番号}/requested_reviewers -q '[.users[].login] | map(select(. == "Copilot" or . == "copilot-pull-request-reviewer[bot]")) | length'
      ```
      - 1以上 → 成功。手順7へ進む
      - 0 → リトライへ

   3. リトライ（最大3回、5秒間隔。初回リクエストを含めて合計4回まで試行する）:
      - 上記 1 → 2 を繰り返す
      - 3回リトライ（合計4回試行）しても `requested_reviewers` にCopilotが含まれない場合:
        - `--auto` モード: 「⚠ Copilotレビューリクエストの確認に失敗しました。手動でレビューをリクエストしてください」と警告を出力し、**ポーリングは開始しない**（空振りが確定しているため）
        - 通常モード: 同様の警告を出力

7. 作成されたPRのURLを表示する

## 並列モード（worktree）で作業している場合

現在のディレクトリがリンク worktree 内かどうかは、`git rev-parse` を使って判定する:

- `git rev-parse --git-dir` の結果が `.../.git/worktrees/...` の形式 → リンク worktree 内
- それ以外（`.git` 等） → メインリポジトリ

リンク worktree 内と判定できた場合は、PR作成後に以下を案内する:

「PRのレビュー・マージが完了したら `/worktree-cleanup` でworktreeを削除できます」

## 自動モード（`--auto`）

`--auto` フラグが指定されている場合、PR作成・Copilotレビューリクエスト完了後に自動で以下を実行する:

1. **Copilotレビューリクエストが成功した場合のみ**、`/loop 5m --skip-first /review-respond --auto --max-idle 3` を実行してレビュー対応の自動ポーリングを開始する（`--skip-first` により、PR作成直後のCI実行中の空振りを回避する）。手順6でリクエストが失敗した場合は、自動ポーリング開始などこの自動モード特有の後続処理（本節の手順2〜4）のみスキップし、警告メッセージを出力したうえで、PR URL表示やworktree案内など通常の処理フローはそのまま継続して終了する
2. `gh pr view --json number -q .number` で現在のブランチに対応する `{PR番号}` を取得する
3. `/loop`（CronCreate）の戻り値からcronタスクIDを取得し、タスクIDファイルに保存する:
   ```bash
   echo "{タスクID}" > /tmp/{project}-review-{ownerRepo}-cron-{PR番号}
   ```
   ※ `{ownerRepo}`（`owner-repo` 形式の文字列）は `gh repo view --json owner,name -q '.owner.login + "-" + .name'` 等で取得する
4. 「レビュー対応の自動ポーリングを開始しました（初回実行はスキップし、以降5分間隔でポーリング、3回連続空振りで停止）」と出力する

`--auto` なしの場合は従来通りの動作（案内メッセージの表示のみ）。
