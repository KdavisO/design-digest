---
description: マージ済みworktreeをクリーンアップしてください。
---

マージ済みの git worktree を検出し、クリーンアップしてください。

## 手順

1. リモート追跡ブランチを最新化する:

   ```
   git fetch --prune origin
   ```

2. `git worktree list` で全worktreeを一覧表示する

3. メインリポジトリ以外のworktreeについて、それぞれ以下を確認:
   - ブランチに紐づくworktreeの場合: `git log --oneline -1 {worktreeのブランチ}` で最新コミットを取得
   - ブランチ名が無い（detached HEAD）worktreeの場合: `git -C {worktreeのパス} rev-parse HEAD` でHEADのコミットハッシュを取得
   - 上記いずれかで得たコミットハッシュについて、`git branch -r --contains {コミットハッシュ}` で `origin/main` に含まれているか確認
   - または（ブランチに紐づくworktreeの場合のみ）`gh pr list --head {ブランチ名} --state merged --json number,title` でマージ済みPRがあるか確認

4. 結果を以下の形式で表示:

   ```
   worktree一覧:
   - ../design-digest-feat-5 (feat/5-add-formatter) → マージ済み ✓ 削除可能
   - ../design-digest-feat-6 (feat/6-add-filter)    → 未マージ ✗ 保持
   ```

5. マージ済みのworktreeがある場合:
   - 削除対象を表示し、ユーザーに確認を求める
   - 確認後、各worktreeについて以下を実行（メインリポジトリのディレクトリで実行し、削除対象のworktreeには `cd` しないこと）:
     - ブランチに紐づくworktreeの場合:
       ```
       git worktree remove {worktreeのパス}
       git branch -D {ブランチ名}
       ```
     - ブランチ名が無い（detached HEAD）のworktreeの場合:
       ```
       git worktree remove {worktreeのパス}
       ```

6. マージ済みのworktreeがない場合:
   - 「クリーンアップ対象のworktreeはありません」と報告

7. 最後に `git worktree list` で最終状態を表示する
