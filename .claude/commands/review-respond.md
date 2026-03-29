---
description: PRのCopilotレビューコメントに対応します。
---

PRのレビューコメントを取得し、対応してください。

引数: `$ARGUMENTS`

## 引数の解析

`$ARGUMENTS` を以下のルールで解析する:

- `--auto` フラグの有無を判定（含まれていれば**自動モード**、なければ**通常モード**）。`--auto` は1回だけ指定可能
- `--max-idle N` オプション: 連続空振り（スキップ）回数の上限を指定。N回連続で空振りした場合、スケジュールされたタスク（cron）を停止して終了する。`--auto` と併用する場合のみ有効
- `--team` フラグの有無を判定（含まれていれば**Agent Teamsモード**）。詳細は「Agent Teamsモード」セクション参照
- PR番号として解釈する引数は **最大1つのトークン** のみとし、`--auto`・`--max-idle`・`--team` および `--max-idle` に続く値トークン以外の最初のトークンを使用する
- PR番号として解釈するトークンは **正の整数（数値文字のみ）** に限る
- PR番号が指定されていない場合: `gh pr view --json number -q .number` で現在のブランチから自動検出
- 上記ルールに反する引数（PR番号候補が2つ以上ある、数値でない等）の場合は **エラーとして扱い、実行を中断して引数の修正を促す**

例（許可される形式）:

- `--auto` → 自動モード、PR番号は自動検出
- `--auto 123` → 自動モード、PR番号は123
- `123 --auto` → 自動モード、PR番号は123
- `--auto --max-idle 3` → 自動モード、3回連続空振りで停止、PR番号は自動検出
- `--auto --max-idle 3 123` → 自動モード、3回連続空振りで停止、PR番号は123
- `--team 123` → Agent Teamsモード、PR番号は123
- `--auto --team` → 自動モード + Agent Teamsモード、PR番号は自動検出
- `123` → 通常モード、PR番号は123
- （空） → 通常モード、PR番号は自動検出

例（エラーとなる形式）:

- `123 456` / `--auto 123 456` → PR番号候補が複数あるためエラー
- `abc` / `--auto abc` → PR番号が数値でないためエラー
- `--max-idle 3` （`--auto` なし）→ `--max-idle` は `--auto` と併用必須のためエラー

## 自動モード（`--auto`）の動作

自動モードでは以下が変わる:

1. **ユーザー確認をスキップ**: 手順2の妥当性判定でユーザーに確認を求めず、自動で判定・実行する
2. **判定基準**: Copilotの指摘は原則すべて対応する（明らかな誤検知を除く）
3. **対応不要と判断した場合**: 理由をコメントで返信する
4. **セルフレビューは通常通り実施する**（git-conventions.md に従う）
5. **スキップ条件に該当する場合**: 短いメッセージ（1行）で即終了する（トークン節約）

## `--max-idle` による自動停止

`--max-idle N` が指定されている場合、連続空振り回数をカウンターファイルで管理し、N回連続で空振りしたらスケジュールされたタスクを停止する。

### ファイル

以下の3つのファイルを使用する。リポジトリ識別子を含めることで、同一マシン上での複数リポジトリ間の衝突を防止する。

- **カウンターファイル**: `/tmp/{project}-review-{ownerRepo}-idle-{PR番号}`
  - 内容: 連続空振り回数（整数値のみ）
- **cronタスクIDファイル**: `/tmp/{project}-review-{ownerRepo}-cron-{PR番号}`
  - 内容: `/loop` 作成時のcronタスクID（CronCreate の戻り値）
  - 初回作成は `/loop` 起動元（`issue-start --parallel --auto` フロー内、または手動の `/loop`）が行う。`review-respond` はポーリング一時停止時に読み取り、再開時に新しいタスクIDで上書きする
- **スコープ外Issue候補ファイル**: `/tmp/{project}-review-{ownerRepo}-deferred-{PR番号}`
  - 内容: スコープ外と判断したレビューコメントのうち、将来のIssue候補となるものをJSON Lines形式で蓄積
  - 各行のフォーマット（1行1オブジェクト）: `{"comment_id": "<comment id>" | null, "review_id": "<review id>" | null, "kind": "line_comment" | "review_body", "path": "<ファイルパス>" | null, "line": <行番号> | null | "N/A", "summary": "<改善内容の要約>"}`
  - 備考: `kind` に応じてIDの有無が変わる。ラインコメント由来（手順1-A）の場合は `kind: "line_comment"` とし、`comment_id` を設定する（`review_id` が特定できない場合は `null`）。レビュー本文由来（手順1-B）の場合は `kind: "review_body"` とし、`review_id` を設定する（`comment_id` は `null`、`path`・`line` は `null`）。手順1-A由来で行番号が数値で取得できないケースでは、`line` に `"N/A"` などの文字列を入れてよい
  - 手順2で「対応不要」と判断した際に、将来の改善として有用なものをこのファイルに追記する

### 動作フロー

1. **空振り時**（「スキップ:」で即終了するケースのうち、**未対応コメントなし**・**Copilotレビュー未着** の場合のみをカウント対象とする）:
   - カウント対象の理由でスキップした場合:
     - カウンターファイルを読み取り（存在しなければ0）、+1した値を書き込む
     - カウンター値 >= N の場合:
       - cronタスクIDファイル（`/tmp/{project}-review-{ownerRepo}-cron-{PR番号}`）を読み取り、タスクIDを取得
       - タスクIDが取得できた場合、そのIDに対応するタスクのみを `CronDelete` で削除
       - タスクIDファイルが存在しない場合に限り、`CronList` で一覧を取得し、対象PR番号を含むコマンド全文が完全一致するタスクのみを `CronDelete` で削除
       - カウンターファイルとcronタスクIDファイルを削除
       - 「レビュー対応完了: {N}回連続で空振り。自動ポーリングを停止しました」と出力
       - 停止理由が **未対応コメントなし** の場合に限り、**ポストアクション**（手順10）へ進む（**Copilotレビュー未着** が理由の場合はポストアクションを実行せずに終了する）
     - カウンター値 < N の場合: 通常のスキップメッセージに加え「（空振り {現在値}/{N}）」を付記して終了
   - 「PRなし」や「CI実行中」など、レビュー対応がそもそも不可能な理由でスキップした場合:
     - カウンターを増やさない（これらの理由のみで `--max-idle` の上限に達して停止することを防ぐ）
     - 通常のスキップメッセージのみ出力して終了

2. **対応実行時**（コード修正・コメント返信を実施したケース）:
   - カウンターファイルをリセット（`echo 0 > /tmp/{project}-review-{ownerRepo}-idle-{PR番号}`）
   - 通常の完了報告を出力

### 注意事項

- `--max-idle` は `--auto` と併用する場合のみ有効。`--auto` なしで指定された場合はエラー
- カウンターファイルは `/loop` の各実行間で状態を共有するための仕組み
- `{ownerRepo}`（`owner-repo` 形式の文字列）は `gh repo view --json owner,name -q '.owner.login + "-" + .name'` 等で取得する

## Agent Teamsモード（`--team`）

> **注意**: Agent Teams は実験的機能です。環境変数 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` が `"1"` に設定されている必要があります（`.claude/settings.json` または `.claude/settings.local.json` の `env` セクションで設定）。

`--team` フラグが指定されている場合、手順1で取得した**統合後の未対応コメント**（ラインコメントおよびレビュー本文由来の項目を含む）の件数が**5件以上**であれば Agent Teams で観点別に分担処理する。5件未満の場合は従来の逐次処理にフォールバックする。

### Agent Teamsモードの動作

1. 手順0〜1は通常通り実行（コメント取得まで）
2. 手順1で取得した**統合後の未対応コメント**の件数が5件以上の場合、以下のチームメイトを作成:
   - **セキュリティレビュアー**: セキュリティ関連の指摘（インジェクション、認証、機密情報露出等）を分析・対応
   - **コード品質レビュアー**: リファクタリング、パフォーマンス、可読性の指摘を対応
   - **テストレビュアー**: テストカバレッジ、エッジケース、エラーハンドリングの指摘を対応
3. リードがコメントを観点別に分類し、各チームメイトに割り当て
4. 各チームメイトが担当コメントに対して修正を実施
5. リードが全チームメイトの変更をレビューし、手順4（検証）以降を実行

### フォールバック条件

以下の場合は `--team` が指定されていても従来の逐次処理を使用:

- 未対応コメントが5件未満
- 環境変数 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` が `"1"` でない（未設定を含む）
- Agent Teams の作成に失敗した場合

### `--auto` との併用

`--auto --team` を同時に指定可能。この場合、自動モードの判定基準に加えてAgent Teamsによる分担処理を行う。`--max-idle` も通常通り機能する。

## 手順

### 0. スキップ条件の判定（自動モードのみ）

**自動モードの場合のみ**、以下のスキップ条件を最初に判定する。通常モードの場合はこの手順をスキップして手順0-Bへ進む。

以下の3つのチェックを実行し、該当する場合は即終了する:

#### チェック1: PRの存在確認

引数でPR番号が指定されている場合:

```bash
gh pr view {PR番号} --json number -q .number
```

引数でPR番号が指定されていない場合（自動検出）:

```bash
gh pr view --json number -q .number
```

PRが存在しない場合 → 「スキップ: PRが見つかりません」と出力して**即終了**

#### チェック2: CIステータス確認

```bash
gh pr checks {PR番号} --json name,state
```

- **いずれかが `state: PENDING`、`IN_PROGRESS`、`QUEUED`、`WAITING`**: 「スキップ: CI実行中」と出力して**即終了**

#### チェック3: Copilotレビューの存在チェック（軽量）

手順1-A/1-Bで使用する重い `gh api --paginate ... | jq` をここで再実行せず、**必要最小限の軽量チェック**のみ行う。

Copilotがレビューを投稿済みかどうかを `/pulls/{PR}/reviews` で確認する（存在有無のみ。見落としを減らすため `per_page=100` で最大100件まで取得）:

```bash
gh api 'repos/{owner}/{repo}/pulls/{PR番号}/reviews?per_page=100' | jq '[.[] | select(.user.login? == "Copilot" or .user.login? == "copilot-pull-request-reviewer[bot]")] | length'
```

判定条件:

- **Copilotレビューが0件**: 「スキップ: Copilotレビュー未着」と出力して**即終了**
- **Copilotレビューが1件以上**: 手順0-B（CI確認）→ 手順1（レビューコメント取得）へ進む。未対応コメントの有無は手順1で判定する

※ ラインコメントの未対応チェックはここでは行わない（手順1-Aで初めて取得・判定する）。これにより `--paginate` 付きの重いAPI呼び出しの二重実行を避ける。

### 0-B. CIステータスの確認（最優先）

レビュー対応の前に、必ずCIステータスを確認する。

1. CIステータスを取得:

   ```bash
   gh pr checks {PR番号} --json name,state
   ```

   ※ `gh pr checks` の `state` には結果が直接入る（`SUCCESS`, `FAILURE`, `PENDING`, `SKIPPED` 等）。`conclusion` フィールドはサポートされていない。

2. 結果を判定（各チェックの `state` で判断、**上から順に優先**）:
   - **checksが0件**（配列が空）: 手順1（レビューコメント対応）へ進む
   - **いずれかが `state: PENDING`、`IN_PROGRESS`、`QUEUED`、`WAITING`**: 「CIが実行中です。完了後に再度確認してください」と報告して終了
   - **いずれかが `state: FAILURE`、`ERROR`、`CANCELLED`、`TIMED_OUT`、`ACTION_REQUIRED`、`STALE`**: 手順0-C（CIエラー修正）へ進む
   - **全てのチェックが `SUCCESS`、`SKIPPED`、`NEUTRAL` のいずれか**: 手順1（レビューコメント対応）へ進む
   - **上記いずれにも該当しない未知の `state`**: 手順0-C（CIエラー修正）へ進む（安全側に倒す）

#### 0-C. CIエラーの修正

CIエラーがある場合は、レビューコメント対応より先にCIエラーを修正する。

1. 「CIエラーを先に修正します」とユーザーに報告

2. 失敗しているチェックを特定:

   ```bash
   gh pr checks {PR番号} --json name,state
   ```

   ※ `state` が `SUCCESS`, `SKIPPED`, `NEUTRAL` 以外のチェックを特定する（`FAILURE`, `ERROR` 等）

3. 必要に応じてCIログを確認（GitHub Actionsの場合）:

   ```bash
   # PRのheadブランチ名を取得
   gh pr view {PR番号} --json headRefName -q .headRefName

   # そのブランチのワークフロー実行を取得
   gh run list --branch {ブランチ名} --limit 5
   gh run view {run_id} --log-failed
   ```

4. エラー原因を分析し、必要な修正を実施

5. 検証（CIで実行されるコマンドと同等の検証を行う）:
   - `pnpm lint` でlintエラーがないことを確認
   - `pnpm test` でテストが通ることを確認
   - `pnpm build` でビルドエラーがないことを確認（必要な場合）

6. 修正をコミット・プッシュ:
   - `fix: CIエラーを修正` 等の適切なコミットメッセージを使用
   - `git push` でリモートにプッシュ

7. CIの再実行を待ち、成功を確認:
   - 「CIの再実行を待っています。成功後、レビューコメント対応に進みます」と報告
   - `gh pr checks {PR番号} --json name,state` で再度ステータスを確認し、全てのチェックの `state` が `SUCCESS`/`SKIPPED`/`NEUTRAL` のいずれかであることを確認する（それ以外や未知の `state` があれば失敗とみなし手順0-Cを継続）
   - CIが成功したら手順1へ進む
   - 再度失敗した場合は手順0-Cを繰り返す（同一目的の修正はまとめてコミット可）

### 1. 未対応レビューコメントの取得

**重要: 外部スクリプトファイル（/tmp/\*.js など）を作成せず、以下の手順に従ってください。**

**前提条件:** このスキルは外部コマンド `jq` を使用します。環境に `jq` がインストールされている必要があります。

#### 1-A. ラインコメント（コード行に紐づくコメント）の未対応検出

以下の **単一コマンド** で未対応のCopilotラインコメントを直接取得する。フィルタリングはすべて `jq` 内で完結させること（LLMが手動で判定しない）:

```bash
gh api --paginate repos/{owner}/{repo}/pulls/{PR番号}/comments | jq -s '
  add
  | ([.[] | select(.in_reply_to_id != null) | .in_reply_to_id] | unique) as $replied_ids
  | [.[]
     | select(
         (.user.login? == "Copilot" or .user.login? == "copilot-pull-request-reviewer[bot]")
         and .in_reply_to_id == null
       )
     | . as $comment
     | select($replied_ids | index($comment.id) | not)
     | {id, path, line: (.line // .original_line // "N/A"), body}
    ]
'
```

#### 1-B. レビュー本文（PR全体へのフィードバック）の取得・確認

Copilotはラインコメントに加え、レビュー本文（`/pulls/{PR}/reviews` の `body`）にもフィードバックを投稿する場合がある。以下のコマンドでCopilotの全レビュー本文を取得する:

```bash
gh api --paginate repos/{owner}/{repo}/pulls/{PR番号}/reviews | jq -s '
  add
  | [.[]
     | select(
         (.user.login? == "Copilot" or .user.login? == "copilot-pull-request-reviewer[bot]")
         and .body != ""
         and .body != null
       )
     | {review_id: .id, state, submitted_at, body}
    ]
  | sort_by(.submitted_at)
'
```

この結果はCopilotの全レビュー本文を時系列順の配列で返す。取得した各レビュー本文を目視で確認し、以下の基準で判定する:

- **対応不要（スキップ）**: 概要のみの本文（"Pull request overview"、"Reviewed changes" 等の定型見出しで始まるもの）
- **対応候補**: 具体的なコード改善指摘や修正要求が含まれているもの

※ 1-B は機械的な未対応判定ではなく、取得した本文を確認して対応要否を判断する手順である。

#### 1-C. 結果の統合と表示

1-A（ラインコメント配列）と 1-B（レビュー本文のうち対応候補のもの）の結果を統合し、未対応コメントを以下の形式で表示:

- **ラインコメント**: ファイル名 (`path`)、行番号 (`line`)、コメント内容 (`body`)、コメントID (`id`) ※返信時に必要
- **レビュー本文**: 「レビュー本文」と明記、レビューID (`review_id`)、投稿日時 (`submitted_at`)、内容 (`body`)

1-A が空配列で、かつ 1-B の全レビュー本文が概要のみ（対応候補なし）の場合:

- **自動モード**: 「スキップ: 未対応コメントなし」と出力して**即終了**
- **通常モード**: 「対応するレビューコメントはありません」と報告して終了

### 2. 各コメントの妥当性判定

各未対応コメントを以下のカテゴリに分類する:

- **対応要**: コード修正が必要
- **対応不要**: 誤検知、スタイルの好み、既に対応済みなど
- **コード外対応**: 設定変更やドキュメント修正など

**通常モード**: 判定結果と対応計画をユーザーに提示し、確認を求める。

**自動モード**: 判定結果を表示するが、ユーザー確認はスキップしてそのまま実行に進む。判定基準:

- Copilotの指摘は原則すべて「対応要」として扱う
- 明らかな誤検知（存在しない問題の指摘、プロジェクト規約と矛盾する指摘等）のみ「対応不要」とする
- 対応不要と判断した場合は手順7で理由をコメント返信する
- **スコープ外Issue候補の蓄積**（`--max-idle` 指定時のみ）: 「対応不要」と判断したコメントのうち、将来の改善として有用なもの（スコープ外だが指摘自体は妥当、別PRで対応すべき等）をスコープ外Issue候補ファイルに追記する。明らかな誤検知はファイルに追記しない

### 3. コード修正の実施

**ポーリング一時停止**（`--auto` モード時）: コード修正に入る前に、cronタスクIDファイル（`/tmp/{project}-review-{ownerRepo}-cron-{PR番号}`）からタスクIDを読み取り、`CronDelete` でポーリングを停止する。これにより修正中に次のポーリングが走ることを防ぐ。タスクIDファイルが存在しない、またはタスクIDが取得できない場合は、`--max-idle` 停止時と同様に `CronList` から対象コマンド完全一致のタスクを特定して `CronDelete` するフォールバックを行う。それでもタスクを特定できない場合は警告を出力する。

**ステータス更新**（`--auto` モード時）: ステータスファイル（`/tmp/{project}-flow-{ownerRepo}-{issue番号}`）が存在する場合、`phase` を `"reviewing"` に更新し、`updated_at` を現在時刻にする。Issue番号はPR番号からPRのbodyに含まれる `Closes #XX` を解析するか、ブランチ名から `{type}/{issue番号}-...` を解析して特定する。いずれの方法でもIssue番号を特定できない場合は、誤ったIssueのステータスを更新しないよう**ステータス更新処理をスキップし、警告を出力する**。ステータスファイルが存在しない場合もスキップする。

対応要と判定されたコメントに対してコード修正を実行する。

### 4. 検証

- `pnpm lint` でlintエラーがないことを確認
- `pnpm test` でテストが通ることを確認
- `pnpm build` でビルドエラーがないことを確認（必要な場合）

### 5. コミット・プッシュ

- 変更をコミットする（git-conventions.md に従い、`fix:` や `refactor:` 等の適切なプレフィックスを使用）
- `git push` でリモートにプッシュする

### 6. Copilotへの再レビューリクエスト

Copilotに再レビューをリクエストし、成功を確認する:

1. レビューリクエストを送信:
   ```bash
   gh api repos/{owner}/{repo}/pulls/{PR番号}/requested_reviewers --method POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
   ```

2. リクエストが成功したか確認（`requested_reviewers` にCopilotが含まれているか）:
   ```bash
   gh api repos/{owner}/{repo}/pulls/{PR番号}/requested_reviewers -q '[.users[].login] | map(select(. == "Copilot" or . == "copilot-pull-request-reviewer[bot]")) | length'
   ```
   - 1以上 → 成功
   - 0 → リトライへ

3. リトライ（最大3回、5秒間隔。初回リクエストを含めて合計4回まで試行する）:
   - 上記 1 → 2 を繰り返す
   - 3回リトライ（合計4回試行）しても確認できない場合: 「⚠ Copilotレビューリクエストの確認に失敗しました」と警告を出力する

**ポーリング再開**（`--auto` モード時）: Copilot再レビューリクエストの**成功が確認できた場合のみ**、`CronCreate` で新しいポーリングタスクを作成（cron: `*/3 * * * *`, prompt: `/review-respond --auto --max-idle 3 {PR番号}`, recurring: true）。`--team` フラグが指定されている場合は prompt を `/review-respond --auto --team --max-idle 3 {PR番号}` とする。新しいタスクIDをcronタスクIDファイル（`/tmp/{project}-review-{ownerRepo}-cron-{PR番号}`）に上書きし、idleカウンターファイルを0にリセットする。※ 再開後の `--max-idle` は常に3に固定される（初回実行時に異なる値が指定されていても引き継がれない）。リクエストが失敗した場合はポーリングを再開せず、警告を出力し、この後の自動ポーリング再開処理のみスキップする（手順7以降は通常どおり実行する）。

### 7. レビューコメントへの返信

`gh api repos/{owner}/{repo}/pulls/{PR番号}/comments --method POST` で各コメントに返信する:

- 対応した場合: 何をどう修正したかを簡潔に説明
- 対応不要と判断した場合: 理由を説明

返信時は `-f in_reply_to=<元コメントID> -f body='<返信文>'` の形式でフィールドを指定する。

### 8. PR本文の更新（必要な場合）

レビュー対応で大きな変更があった場合のみ、`gh pr edit` でPR本文を更新する。

### 9. 完了報告

**ステータス更新**（`--auto` モード時）: 手順3のステータス更新で特定したissue番号を再利用し、そのステータスファイルが存在する場合にのみ `phase` を `"polling"` に戻し、`updated_at` を現在時刻にする。issue番号を特定できなかった場合はステータス更新をスキップする。

対応結果のサマリーを表示する:

- 対応したコメント数
- 対応不要としたコメント数
- 変更したファイル一覧

### 10. ポストアクション（`--max-idle` 自動停止時のみ）

`--max-idle` による自動停止が発動し、かつ停止理由が **未対応コメントなし** の場合にのみ、以下のポストアクションを順次実行する。通常の `/review-respond` 実行時やユーザーが手動で停止した場合、または停止理由が Copilot レビュー未着である場合は実行しない。

#### 10-A. PRマージ

1. CIステータスを再確認する:
   - 手順0-Bと同様に `gh pr checks {PR番号} --json name,state` を実行し、全てのチェックが `SUCCESS` / `SKIPPED` / `NEUTRAL` であることを確認する
   - いずれかのチェックが `PENDING` / `QUEUED` / `IN_PROGRESS` / `FAILURE` / `CANCELLED` など許容状態以外の場合:
     - **自動マージは実行しない**
     - CI未完了または失敗である旨をサマリーに記録し、手順10-Bへ進む（マージは手動に委ねる）
2. 未対応レビューコメントがないことを再確認する:
   - 手順1-A/1-Bと同等のコマンドを再実行し、未対応コメント一覧を取得する
   - 未対応コメントが1件以上検出された場合:
     - **自動マージは実行しない**
     - 未対応コメントが残っている旨をサマリーに記録し、手順10-Bへ進む（マージは手動に委ねる）
3. 1および2の条件を全て満たす場合、ユーザー確認なしでPRをマージする:
   ```bash
   gh pr merge {PR番号} --squash --delete-branch --yes
   ```
4. 上記マージコマンドが失敗した場合（ブランチ保護ルール、競合、権限不足など）:
   - エラー内容をサマリーに記録し、ユーザーに報告する
   - 手順10-Bへ進む（マージは手動に委ねる）

#### 10-B. スコープ外Issue候補の確認・作成

1. スコープ外Issue候補ファイル（`/tmp/{project}-review-{ownerRepo}-deferred-{PR番号}`）を読み取る
2. ファイルが存在しない場合 → スキップして手順10-Cへ
3. ファイルが存在し、中身が空の場合 → 候補ファイルを削除してから手順10-Cへ
4. 候補がある場合:
   - 候補一覧を表示する
   - **`--auto` モードであっても、ここではユーザー確認を挟む**（Issue作成は内容の妥当性確認が必要なため）
   - ユーザーが承認した候補について `/issue-create` でIssueを作成
   - ユーザーがスキップした場合は作成せずに進む
5. 候補ファイルを削除

#### 10-C. worktree削除

1. 現在のディレクトリがworktree内かどうかを判定:

   ```bash
   git rev-parse --git-dir
   ```

   - 結果が `.../.git/worktrees/...` の形式 → worktree内
   - それ以外 → メインリポジトリ（スキップ）

2. worktree内の場合、まずPRがマージ済みであることを確認する:

   ```bash
   gh pr view {PR番号} --json merged -q .merged
   ```

   - `true` の場合のみ削除に進む
   - `false` の場合はスキップし、「PRが未マージのためworktree削除をスキップしました」と報告

3. 削除対象のworktree内から、必要な情報を取得する:
   ```bash
   # 現在のworktreeのルートパス
   worktree_root="$(git rev-parse --show-toplevel)"
   # 現在のブランチ名（detached HEADの場合はPRから取得）
   branch_name="$(git symbolic-ref --quiet --short HEAD)"
   if [ -z "$branch_name" ]; then
     branch_name="$(gh pr view {PR番号} --json headRefName -q .headRefName)"
   fi
   # branch_nameが取得できない場合はブランチ削除のみスキップ（worktree削除は実行）
   # メインリポジトリのルートパス
   git_common_dir="$(git rev-parse --git-common-dir)"
   main_repo="$(cd "${git_common_dir}/.." && pwd)"
   ```
4. **削除対象のworktreeの中では `git worktree remove` を実行しない**。メインリポジトリから削除する:
   - メインリポジトリのルートに移動して実行:
     ```bash
     cd "$main_repo"
     git worktree remove "$worktree_root"
     # branch_name が取得できなかった場合はブランチ削除をスキップ
     if [ -n "$branch_name" ]; then
       git branch -D "$branch_name"
     fi
     ```
   - または、`git -C` を使ってメインリポジトリ側から実行:
     ```bash
     git -C "$main_repo" worktree remove "$worktree_root"
     # branch_name が取得できなかった場合はブランチ削除をスキップ
     if [ -n "$branch_name" ]; then
       git -C "$main_repo" branch -D "$branch_name"
     fi
     ```
5. worktree削除に失敗した場合（他プロセスが使用中等）、「`/worktree-cleanup` で手動削除してください」と案内

#### ポストアクションのエラーハンドリング

- 各ステップ（10-A/10-B/10-C）は独立しており、1つが失敗しても次のステップに進む
- 全ステップ完了後に最終サマリーを表示:
  - PRマージ: 成功/失敗/スキップ
  - Issue作成: {N}件作成/{M}件スキップ/候補なし
  - worktree削除: 成功/失敗/スキップ（メインリポジトリ）
