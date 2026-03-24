---
description: GitHub Issue に対応するPRを作成してください。
---

GitHub Issue #$ARGUMENTS に対応するPRを作成してください。

## 手順

1. `gh issue view $ARGUMENTS` でIssue内容を確認する
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

Closes #$ARGUMENTS
```

6. PR作成後、以下を設定する:
   - reviewerに Copilot を設定: `gh api repos/{owner}/{repo}/pulls/<PR番号>/requested_reviewers --method POST -f reviewers[]='copilot-pull-request-reviewer[bot]'`
7. 作成されたPRのURLを表示する

## 並列モード（worktree）で作業している場合

現在のディレクトリがリンク worktree 内かどうかは、`git rev-parse` を使って判定する:

- `git rev-parse --git-dir` の結果が `.../.git/worktrees/...` の形式 → リンク worktree 内
- それ以外（`.git` 等） → メインリポジトリ

リンク worktree 内と判定できた場合は、PR作成後に以下を案内する:

「PRのレビュー・マージが完了したら `/worktree-cleanup` でworktreeを削除できます」
