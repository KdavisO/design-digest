---
description: GitHub Issue から開発を開始してください。
---

GitHub Issue から開発を開始してください。

引数: `$ARGUMENTS`

- 数字のみ（例: `255`）→ 通常モード
- `--parallel` 付き（例: `256 --parallel`）→ 並列モード（git worktree 使用）
- `--parallel --auto` 付き（例: `256 --parallel --auto`）→ 自動モード（実装→PR作成→レビュー対応ポーリングまで一気通貫）

## 共通手順

1. 引数からIssue番号、`--parallel` フラグ、`--auto` フラグを解析する
   - `--auto` は `--parallel` と併用する場合のみ有効。`--parallel` なしで `--auto` が指定された場合はエラー
2. `gh issue view {issue番号}` でIssue内容を取得し、要件を把握する
3. Issueのラベルに基づきブランチ種別 `{type}` を決定（末尾に `/` は付けない）:
   - `bug` → `fix`
   - `enhancement` → `feat`
   - `documentation` → `docs`
   - ラベルなし or その他 → `feat`
4. ブランチ名を `{type}/{issue番号}-{英語の短い説明}` で作成（例: `feat/12-add-slack-formatter`）

## 通常モード（`--parallel` なし）

5. mainブランチを最新にし、そこから新ブランチを作成:
   ```
   git checkout main && git pull origin main
   git checkout -b {ブランチ名}
   ```
6. Issueの内容を分析し、実装方針を提案する:
   - 変更が必要なファイル
   - 実装ステップの概要
   - 注意点やリスク

## 並列モード（`--parallel` 付き）

メインリポジトリの作業内容を維持したまま、git worktree で隔離された作業環境を作成する。
worktree 作成後は `cd` でそのディレクトリに移動し、以降の作業はすべて worktree 内で行う。

5. origin/mainを最新化してからworktreeを作成:

   ```
   git fetch origin main
   git worktree add ../design-digest-{type}-{issue番号} -b {ブランチ名} origin/main
   ```

   - ディレクトリ名: `../design-digest-{type}-{issue番号}`（例: `../design-digest-feat-5`）
   - 既に存在する場合はエラーメッセージを表示して停止する

6. worktree内で依存関係をインストール:
   ```
   cd ../design-digest-{type}-{issue番号} && npm install
   ```
7. **以降の作業（ファイル編集・テスト実行等）はすべて worktree ディレクトリ内で行う**
8. Issueの内容を分析し、実装方針を提案する:
   - 変更が必要なファイル（worktreeのパスで記載）
   - 実装ステップの概要
   - 注意点やリスク

### 並列モードでのPR作成・クリーンアップ

PR作成は `/issue-pr` を使用する。マージ後のクリーンアップは `/worktree-cleanup` を使用する。

## 自動モード（`--parallel --auto`）

`--auto` フラグが指定されている場合、実装方針の提案で止まらず、以下のフローを一気通貫で実行する。

**重要: `--auto` モードでは手順1〜4（worktree作成・依存インストール→実装→コミット→PR作成→ポーリング開始）の間はユーザーへの確認・方針提案で停止してはならない。各ステップを自律的に判断・実行し、中断なしで完了すること。ただし手順5（ポストアクション）のスコープ外Issue作成のみ、内容の妥当性確認のためユーザー確認を挟む。**

### 自動モードのフロー

1. **worktree作成・依存インストール**（並列モードの手順5〜6と同じ）
2. **Issue要件の分析・実装**:
   - Issueの要件を分析し、必要な変更を特定
   - 実装を実行する（テスト・lint含む）
3. **セルフレビュー・コミット**:
   - git-conventions.md に従いセルフレビューを実施
   - 適切な粒度でコミット
4. **PR作成・レビュー対応ポーリング開始**:
   - `/issue-pr --auto {issue番号}` を実行してPRを作成（Copilotレビューリクエスト含む）
   - `/issue-pr --auto` がPR作成後に自動で `/loop 5m --skip-first /review-respond --auto --max-idle 3` を開始する
   - `--skip-first` により初回の即時実行を行わず、次回以降のスケジュールされたタイミングからおおむね5分間隔でCopilotレビューをチェック・自動対応する
   - 3回連続で未対応コメントがなければ「未対応コメントなし」を停止理由として自動停止する
   - Copilotレビューが1度も着信しないまま `--max-idle` に達した場合は「Copilotレビュー未着」として停止し、この場合はポストアクションは実行されない
5. **ポストアクション**（停止理由が「未対応コメントなし」の `--max-idle` 自動停止時のみ自動実行）:
   - PRマージ（CI・レビュー状態を確認後、squash merge）
   - スコープ外Issue候補の確認・作成（ユーザー確認あり）
   - マージ済みworktreeのみ削除（安全側）

### エラー時の動作

- 実装中にエラーが発生した場合（ビルドエラー、テスト失敗等）、自動修正を試みる
- 自動修正できない場合は、その時点で停止してユーザーにエラー内容を報告する
- PR作成後のレビュー対応中のエラーは `/review-respond --auto` 内で処理される
- ポストアクションの各ステップは独立しており、1つが失敗しても次に進む
