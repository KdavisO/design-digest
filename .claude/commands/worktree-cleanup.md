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

3. メインリポジトリ以外のworktreeについて、それぞれ以下の順序でマージ済みかどうかを判定する:

   **判定1（優先）: PRマージ状態の確認（squashマージ対応）**

   ブランチに紐づくworktreeの場合、`gh pr list --head {ブランチ名} --state merged --json number,title` でマージ済みPRがあるか確認する。
   - マージ済みPRが見つかった → **マージ済み**と判定（判定2はスキップ）
   - マージ済みPRが見つからない、または `gh pr list` コマンドがエラーで失敗した場合（gh 未インストール/未認証/一時的なAPIエラー等） → いずれもマージ済みPRが0件だったものとみなし、判定2へ進む

   ※ squashマージではコミットハッシュが変わるため、`git branch -r --contains` では検出できない。PRマージ状態を優先的に確認することでこの問題を回避する。

   **判定2（フォールバック）: コミットハッシュによる確認**

   判定1でマージ済みPRが見つからなかった場合、または detached HEAD の worktree の場合:
   - ブランチに紐づくworktreeの場合: `git log -1 --format=%H {worktreeのブランチ}` でフルSHAのコミットハッシュを取得
   - detached HEAD の worktree の場合: `git -C {worktreeのパス} rev-parse HEAD` でHEADのコミットハッシュを取得
   - 上記で得たコミットハッシュについて、`git branch -r --contains {コミットハッシュ}` で `origin/main` に含まれているか確認
   - `origin/main` に含まれている → **マージ済み**と判定
   - 含まれていない → **未マージ**と判定

4. 結果を以下の形式で表示:

   ```
   worktree一覧:
   - ../daijobu-feat-255 (test/255-modal-test) → マージ済み ✓ 削除可能
   - ../daijobu-feat-256 (test/256-api-test)   → 未マージ ✗ 保持
   ```

5. マージ済みのworktreeがある場合:
   - 削除対象を表示し、ユーザーに確認を求める
   - 確認後、**メインリポジトリのルートから**各worktreeについて以下を実行（削除対象のworktree内からは `git worktree remove` を実行しないこと）:
     - ブランチに紐づくworktreeの場合:
       ```
       git worktree remove {worktreeのパス}
       git branch -D {ブランチ名}
       ```
       ※ squash merge 運用では `-d` が失敗するため `-D` を使用
     - ブランチ名が無い（detached HEAD）のworktreeの場合:
       ```
       git worktree remove {worktreeのパス}
       ```

6. マージ済みのworktreeがない場合:
   - 「クリーンアップ対象のworktreeはありません」と報告

7. 最後に `git worktree list` で最終状態を表示する
