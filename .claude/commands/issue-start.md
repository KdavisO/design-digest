---
description: GitHub Issue から開発を開始してください。
---

GitHub Issue から開発を開始してください。

引数: `$ARGUMENTS`

- 数字のみ（例: `255`）→ 通常モード
- `--parallel` 付き（例: `256 --parallel`）→ 並列モード（git worktree 使用）
- `--parallel --auto` 付き（例: `256 --parallel --auto`）→ 自動モード（実装→PR作成→レビュー対応ポーリングまで一気通貫）
- `--parallel --auto --continuous` 付き（例: `256 --parallel --auto --continuous`）→ 連続自動実行モード（完了後に次のIssueを自動着手）
- `--max-issues N`（例: `--max-issues 5`）→ 連続実行の上限回数を指定（デフォルト: 3。`--continuous` と併用）
- `--team`（例: `256 --parallel --auto --team`）→ レビュー対応で Agent Teams による観点別分担を有効化（`--parallel --auto` と併用）

## 共通手順

1. 引数からIssue番号、`--parallel` フラグ、`--auto` フラグ、`--continuous` フラグ、`--max-issues N`、`--team` フラグを解析する
   - `--auto` は `--parallel` と併用する場合のみ有効。`--parallel` なしで `--auto` が指定された場合はエラー
   - `--continuous` は `--parallel --auto` と併用する場合のみ有効。`--parallel --auto` なしで `--continuous` が指定された場合はエラー
   - `--team` は `--parallel --auto` と併用する場合のみ有効。`--parallel --auto` なしで `--team` が指定された場合はエラー
   - `--max-issues N` は `--continuous` と併用する場合のみ有効。`--continuous` なしで `--max-issues` が指定された場合はエラー（例: `--continuous --max-issues 5` のように併用すること）。デフォルト値: 3
     - `N` は必須の引数であり、「1以上の整数」のみ受け付ける
     - `--max-issues` の直後に値が指定されていない場合、`N` が `0` または負数の場合、もしくは数値に変換できない場合は **エラーとして処理** し、コマンドを中断する
     - エラー時は、原因と正しい指定方法を明示したメッセージを出すこと（例: `--max-issues には 1 以上の整数を指定してください（指定値: "abc"）`、`--max-issues の後に回数を指定してください（例: --max-issues 3）`）
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
- `--parallel` / `--auto` / `--continuous` / `--max-issues` / `--team` フラグは調査モードではすべて無視される（調査モードのフローが優先）。共通手順1のフラグ検証（`--parallel` なしの `--auto` はエラー、`--continuous` なしの `--max-issues` はエラー等）も、`research` ラベルが検知された場合はスキップする

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
   - `/issue-pr --auto {issue番号}` を実行してPRを作成（Copilotレビューリクエスト含む。`--team` 指定時は `/issue-pr --auto --team {issue番号}` を実行）
   - `/issue-pr --auto` の成功後、ステータス更新: `phase: "pr-created"`（作成されたPR番号を `pr` フィールドに設定）
   - `/issue-pr --auto` がPR作成後、Copilotレビューリクエストが成功した場合のみ自動で `/loop 3m --skip-first /review-respond --auto --max-idle 3 {PR番号}` を開始する（`--team` 指定時は `/issue-pr --auto --team` を実行し、ポーリングコマンドが `/loop 3m --skip-first /review-respond --auto --team --max-idle 3 {PR番号}` となる）。レビューリクエストが失敗した場合はポーリングを開始せず、警告を出力して終了する（`phase: "polling"` への更新も行わない）
   - ポーリング開始成功後、ステータス更新: `phase: "polling"`
   - `--skip-first` により初回の即時実行を行わず、次回以降のスケジュールされたタイミングからおおむね3分間隔でCopilotレビューをチェック・自動対応する
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

すべてのモード（通常・並列・自動・調査モード含む）のフロー完了後（エラー停止時を除く）、`/suggest-next` コマンドを実行して次に着手すべきIssue候補を提案する。

```
/suggest-next exclude:{issue番号}
```

### 注意事項

- 提案処理でエラーが発生した場合（GitHub API失敗等）でもフロー全体は失敗させない
  - **挙動:** `/suggest-next` のみスキップし、メインのフロー結果は「成功」として扱う
  - **表示:** 「次のIssue提案はスキップしました: {簡潔な原因}」のように、短いメッセージと最小限の原因のみを表示する
- 提案の実行タイミング: **完了サマリー出力後に常に実行する**（ポストアクションの有無に関わらず、フローが正常終了したすべてのケースで実行。エラー停止時のみスキップ）
- `--continuous` モードの場合、`/suggest-next` の結果は次Issue自動着手の選定にも使用される（後述の「連続自動実行モード」セクション参照）

## 連続自動実行モード（`--continuous`）

`--continuous` フラグが指定されている場合、1つのIssueのフロー完了後に自動で次のIssueを選定・着手する。`--max-issues N` で連続実行の上限回数を指定できる（デフォルト: 3）。

### 前提条件

- `--parallel --auto` と併用する必要がある
- 上限回数（`--max-issues`）は現在のIssueを含む。例: `--max-issues 3` で最初のIssueを開始した場合、最大3つのIssueを順次処理する

### 連続実行フロー

自動モードのフローが正常完了し、完了サマリーを出力した後で `/suggest-next` を実行し、その結果に応じて以下のように分岐する:

1. **残り回数の確認**:
   - `--max-issues` の値を1つ減算する
   - 残り回数が0以下の場合 → 「連続実行の上限（{N}件）に達しました」と出力して終了
2. **次Issue候補の取得**:
   - `/suggest-next` の出力結果から最上位の候補（1番目）のIssue番号を取得する
   - `/suggest-next` がエラーだった場合 → 「次のIssue提案でエラーが発生したため連続実行を終了します: {エラー内容}」と出力して終了
   - 候補が0件だった場合（`/suggest-next` が「提案可能なIssueがありません」と出力した場合）→ 「提案可能なIssueがないため連続実行を終了します」と出力して終了
3. **競合チェック**:
   - `/suggest-next` は内部で既にworktree・オープンPR・アサインとの競合チェックを実施済みなので、追加の競合チェックは不要
4. **次Issueの自動着手**:
   - 以下のメッセージを出力する:
     ```
     --- 連続実行: 次のIssue着手 ---
     次のIssue: #{次のIssue番号} {次のIssueタイトル}
     残り: {残り回数}件
     ---
     ```
   - `/issue-start {次のIssue番号} --parallel --auto --continuous --max-issues {残り回数}` を実行する（`--team` 指定時は `--team` も付与する）

### エラー時の動作

- 自動モードのフロー中にエラーが発生して停止した場合、連続実行も停止する（次Issueには進まない）
- `/suggest-next` でエラーが発生した場合、連続実行を終了する（フロー自体は成功扱い）
- 次Issueの `/issue-start` 実行中にエラーが発生した場合、そのIssueのエラーとして処理される（連鎖的なエラー伝播はない）

### 連続実行の上限

- `--max-issues` のデフォルト値: 3
- 最小値: 1（1の場合は現在のIssueのみ処理し、連続実行は行わない）
- 最大値: 制限なし（ただし、コンテキストウィンドウの制約に注意）

### 使用例

```bash
# 最大3件のIssueを連続処理（デフォルト）
/issue-start 28 --parallel --auto --continuous

# 最大5件のIssueを連続処理
/issue-start 28 --parallel --auto --continuous --max-issues 5

# 1件のみ処理（--continuous なしと同等）
/issue-start 28 --parallel --auto --continuous --max-issues 1
```
