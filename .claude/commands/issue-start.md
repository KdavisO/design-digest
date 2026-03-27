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
   - `enhancement` or `feature` → `feat`
   - `refactor` → `refactor`
   - `ui/ux` → `ui`
   - `documentation` → `docs`
   - `research` → **調査モードとして処理**（下記「調査モード」セクション参照。手順4以降の共通手順・通常/並列/自動モードの手順はすべてスキップし、調査モードのフローに従う）
   - ラベルなし or その他 → `feat`
4. （調査モードの場合はスキップ）ブランチ名を `{type}/{issue番号}-{英語の短い説明}` で作成（例: `feat/12-add-child-profile`）

### 調査モード（`research` ラベルのIssue）

`research` ラベルが付いたIssueは、コード実装やドキュメント生成ではなく **調査結果に基づくIssueの起票** をゴールとする。

**調査モードのフロー:**

1. Issueの要件を分析し、調査対象・調査観点を整理する
2. コードベースの調査、外部情報の収集など必要な調査を実施する
3. 調査結果を整理し、具体的なアクションItem（実装タスク、バグ修正、リファクタリング等）を特定する
4. 各アクションItemを `/issue-create` で個別のIssueとして起票する
5. 元の調査Issueに調査結果のサマリーと起票したIssueへのリンクをコメントとして追記する:
   ```
   gh issue comment {issue番号} --body "調査結果サマリーとリンク"
   ```
6. 元の調査Issueをクローズする:
   ```
   gh issue close {issue番号} --reason completed
   ```

**調査モードの重要ルール:**

- **リポジトリにドキュメントファイル（`.md` 等）を新規追加してコミットしない／PRに含めない** — 調査結果はIssueコメントとして記録する
- **コード変更・PRは作成しない** — 成果物は新たなIssueのみ
- **ブランチの作成・worktreeの作成は不要** — 調査はメインリポジトリ上でそのまま実施する
- `--parallel` / `--auto` フラグは調査モードでは無視される（調査モードのフローが優先）。共通手順1のフラグ検証（`--parallel` なしの `--auto` はエラー）も、`research` ラベルが検知された場合はスキップする

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
7. **開始サマリーを出力する**:
   ```
   --- 開始サマリー ---
   Issue: #{issue番号} {Issueタイトル}
   ブランチ: {ブランチ名}
   ---
   ```

## 並列モード（`--parallel` 付き）

メインリポジトリの作業内容を維持したまま、git worktree で隔離された作業環境を作成する。
worktree 作成後は `cd` でそのディレクトリに移動し、以降の作業はすべて worktree 内で行う。

5. origin/mainを最新化してからworktreeを作成:

   ```
   git fetch origin main
   git worktree add ../{project}-{type}-{issue番号} -b {ブランチ名} origin/main
   ```

   - ディレクトリ名: `../{project}-{type}-{issue番号}`（例: `../{project}-feat-255`）
   - 既に存在する場合はエラーメッセージを表示して停止する

6. worktree内で依存関係をインストール:
   ```
   cd ../{project}-{type}-{issue番号} && pnpm install
   ```
7. **以降の作業（ファイル編集・テスト実行等）はすべて worktree ディレクトリ内で行う**
8. Issueの内容を分析し、実装方針を提案する:
   - 変更が必要なファイル（worktreeのパスで記載）
   - 実装ステップの概要
   - 注意点やリスク
9. **開始サマリーを出力する**:
   ```
   --- 開始サマリー ---
   Issue: #{issue番号} {Issueタイトル}
   ブランチ: {ブランチ名}
   Worktree: {worktreeの絶対パス}
   ---
   ```

### 並列モードでのPR作成・クリーンアップ

PR作成は `/issue-pr` を使用する。マージ後のクリーンアップは `/worktree-cleanup` を使用する。

## 自動モード（`--parallel --auto`）

`--auto` フラグが指定されている場合、実装方針の提案で止まらず、以下のフローを一気通貫で実行する。

**重要: `--auto` モードではポストアクションを含む全手順（手順1〜5）において、ユーザーへの確認・方針提案で停止してはならない。各ステップを自律的に判断・実行し、中断なしで完了すること。スコープ外Issue候補の作成も自動実行し、作成されたIssueのURLをログとして出力する。**

### 進捗ステータスファイル

自動モードでは各フェーズの遷移時にステータスファイル（`/tmp/{project}-flow-{ownerRepo}-{issue番号}`）を更新する。これにより `/flow-status` コマンドで進捗を確認できる。

**`{project}` の導出方法**: `{project}` は**常にメインリポジトリのディレクトリ名**とする。worktree配下で実行される場合は `git rev-parse --git-common-dir` からメインリポジトリルートを辿り、その basename を使用する（`git rev-parse --show-toplevel` の basename はworktreeディレクトリ名になるため使用しない）。ステータスファイルの作成・更新（自動モード側）および参照（`/flow-status` コマンド側）では必ず同じ方法で `{project}` を導出すること。

**`{ownerRepo}` の導出方法**: `{ownerRepo}` は `gh repo view --json owner,name -q '.owner.login + "-" + .name'` で取得する。`/flow-status` や `/review-respond` と同じ方法を使用し、パスの一致を保証すること。

ファイル形式（JSON）:
```json
{
  "issue": 123,
  "branch": "feat/123-example",
  "pr": null,
  "phase": "worktree",
  "worktree": "/path/to/worktree",
  "updated_at": "2026-03-25T12:34:56Z",
  "error": null
}
```

`phase` の値: `worktree`, `implementing`, `committing`, `pr-created`, `polling`, `reviewing`, `post-action`, `completed`, `error`

**ステータス更新タイミング**: 各フェーズの開始時にファイルを更新する。`pr` フィールドはPR作成後に番号を設定する。`updated_at` は毎回現在時刻で上書きする。

**原子的書き換え**: `/flow-status` が実行中にファイルを読み取る可能性があるため、ステータス更新時は一時ファイル（同ディレクトリ内の `.tmp` 接尾辞ファイル）に完全なJSONを書き出し、`mv` で本来のパスに置き換える。これにより読み取り側は常に完全なJSONのみを参照する。

**完了・エラー時の更新**:
- ポストアクション完了時: `phase` を `"completed"` に更新してからステータスファイルを削除する
- エラー停止時: `phase` を `"error"` に更新し、`error` フィールドにエラー内容を追記する。**エラー時はステータスファイルを削除しない**（`/flow-status` でエラー状態を確認できるようにするため）。ユーザーが手動で対処した後、ステータスファイルはユーザーが手動で削除する

### 自動モードのフロー

1. **worktree作成・依存インストール**（並列モードの手順5〜6と同じ）
   - ステータス更新: `phase: "worktree"`
2. **Issue要件の分析・実装**:
   - ステータス更新: `phase: "implementing"`
   - Issueの要件を分析し、必要な変更を特定
   - 実装を実行する（テスト・lint含む）
3. **セルフレビュー・コミット**:
   - ステータス更新: `phase: "committing"`
   - git-conventions.md に従いセルフレビューを実施
   - 適切な粒度でコミット
4. **PR作成・レビュー対応ポーリング開始**:
   - `/issue-pr --auto {issue番号}` を実行してPRを作成（Copilotレビューリクエスト含む）
   - `/issue-pr --auto` の成功後、ステータス更新: `phase: "pr-created"`（作成されたPR番号を `pr` フィールドに設定）
   - ステータス更新: `phase: "polling"`
   - `/issue-pr --auto` がPR作成後に自動で `/loop 5m --skip-first /review-respond --auto --max-idle 3` を開始する
   - `--skip-first` により初回の即時実行を行わず、次回以降のスケジュールされたタイミングからおおむね5分間隔でCopilotレビューをチェック・自動対応する
   - 3回連続で未対応コメントがなければ「未対応コメントなし」を停止理由として自動停止する
   - Copilotレビューが1度も着信しないまま `--max-idle` に達した場合は「Copilotレビュー未着」として停止し、この場合はポストアクションは実行されない
5. **ポストアクション**（停止理由が「未対応コメントなし」の `--max-idle` 自動停止時のみ自動実行）:
   - ステータス更新: `phase: "post-action"`
   - **完了サマリー用のデータを事前取得する**（worktree削除前に必ず実行）:
     ```bash
     git fetch origin main                     # origin/main を最新化
     git diff --name-only origin/main...HEAD   # 変更ファイル一覧
     git log --oneline origin/main..HEAD       # コミット一覧
     ```
   - PRマージ（CI・レビュー状態を確認後、squash merge）
   - スコープ外Issue候補の作成（ユーザー確認なし・自動実行。作成されたIssueのURLをログ出力する）
   - マージ済みworktreeのみ削除（安全側）
   - ステータス更新: `phase: "completed"` → ステータスファイルを削除
6. **完了サマリーを出力する**（ポストアクション完了後、またはポーリング停止後に出力。エラー停止時は出力しない）:
   ```
   === 完了サマリー ===
   Issue: #{issue番号} {Issueタイトル}
   ブランチ: {ブランチ名}
   PR: {PR URL}
   マージ: {成功 / 失敗 / スキップ}
   変更ファイル:
     - {ファイルパス1}
     - {ファイルパス2}
     ...
   コミット:
     - {コミットメッセージ1}
     - {コミットメッセージ2}
     ...
   ==================
   ```
   - 変更ファイル・コミット一覧は手順5のポストアクション冒頭で事前取得済みのデータを使用する
   - ポストアクションが実行されなかった場合（Copilotレビュー未着での停止等）も、ポーリング停止時点でデータを取得し、マージ欄を「スキップ」として出力する

### エラー時の動作

- 実装中にエラーが発生した場合（ビルドエラー、テスト失敗等）、自動修正を試みる
- ステータス更新: 停止前に `phase: "error"`, `error: "エラー内容の要約"` を書き込む
- 自動修正できない場合は、その時点で停止してユーザーにエラー内容を報告する
- PR作成後のレビュー対応中のエラーは `/review-respond --auto` 内で処理される
- ポストアクションの各ステップは独立しており、1つが失敗しても次に進む

## 次のIssue提案（全モード共通・フロー完了後）

すべてのモード（通常・並列・自動）のフロー完了後（エラー停止時を除く）、次に着手すべきIssue候補を1〜3件提案する。提案は強制ではなく、ユーザーが判断できる形で表示する。

### 提案ロジック

1. **オープンIssue一覧を取得**:
   ```bash
   gh issue list --state open --json number,title,body,labels,assignees --limit 100
   ```
   - オープンIssueが非常に多いリポジトリでは、`--limit` の値をさらに増やすか、`gh issue list` / `gh api` のページング機能を用いて十分な件数を取得する

2. **除外フィルタを適用**（以下に該当するIssueを候補から除外する）:
   - **アサイン済みIssue**: `assignees` が空でないIssueを除外
   - **既存worktreeで作業中のIssue**: `git worktree list` の出力からブランチ名を解析し、`{type}/{issue番号}-` パターンに一致するIssue番号を抽出して除外
   - **オープンPRと変更ファイルが競合するIssue**: 以下の手順で判定
     1. `gh pr list --state open --json number --limit 100` でオープンPR一覧を取得
        - オープンPRが非常に多いリポジトリでは、`--limit` の値をさらに増やすか、`gh pr list` / `gh api` のページング機能を用いて十分な件数を取得する
     2. 各PRについて `gh pr diff {PR番号} --name-only` で変更ファイル一覧を取得
     3. 候補Issueのタイトル・本文に含まれるファイルパスやコンポーネント名がPR変更ファイルと重複する場合に除外
        - 完全なファイルパス一致、またはディレクトリレベルでの重複（同じディレクトリ配下のファイルを変更）を検出
        - ただし、Issueタイトル・本文のいずれにもファイルパスやコンポーネント名がない場合はこのフィルタをスキップ（除外しない）
   - **現在作業中のIssue自身**: 今回の `/issue-start` で処理したIssue番号を除外

3. **優先度でソート**:
   - `priority:high` ラベル付き → 最優先
   - `priority:medium` ラベル付き → 中優先
   - `priority:low` ラベル付き → 低優先
   - 優先度ラベルなし → `priority:low` と同等
   - 同一優先度内ではIssue番号が小さい（古い）ものを優先

4. **上位1〜3件を提案として出力**:
   ```
   --- 次のIssue候補 ---
   1. #{issue番号} {タイトル}（優先度: {high/medium/low/low（ラベルなし）}）
      選定理由: {競合なし、未アサイン等の簡潔な理由}
   2. ...
   3. ...
   候補がない場合: 「提案可能なIssueがありません」
   -----------------------
   ```

### 注意事項

- 提案処理でエラーが発生した場合（GitHub API失敗等）でもフロー全体は失敗させない。その代わり、提案セクションをスキップした旨と最小限の原因（例: 「次のIssue候補の取得に失敗しました（GitHub APIエラー）」）だけを簡潔に表示する
- 調査モード（`research` ラベル）のフロー完了後も提案を実行する
- 提案の実行タイミング: **完了サマリー出力後に常に実行する**（ポストアクションの有無に関わらず、フローが正常終了したすべてのケースで実行。エラー停止時のみスキップ）
