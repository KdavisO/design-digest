---
description: プロジェクト巡回によるIssue自動提案を実行します。
---

プロジェクトのコードベース、PR、Issue、ドキュメントを巡回・分析し、改善点やバグの可能性を検出してIssue候補を提案してください。

引数: `$ARGUMENTS`

## 引数の解析

引数は空白区切りのトークン列として解釈します。各トークンは次のいずれかを受け付けます:

- `code` → コード巡回のみ
- `pr` → PR巡回のみ
- `issue` → Issue巡回のみ
- `docs` → ドキュメント巡回のみ
- `all` または引数なし → すべての巡回対象を実行
- `--team` → Agent Teamsモードを有効化（巡回対象ごとにチームメイトを作成して並列分担）

### 使用ルール

- 複数指定可（例: `code pr`、`code docs issue`）
  - ただし `all` は**単独**、または `--team` とのみ併用可能です（許可される例: `/patrol all`、`/patrol all --team`。禁止される例: `/patrol all code`、`/patrol all code --team` など）。
- `--team` は巡回対象指定と併用可能です（例: `/patrol code pr --team`、`/patrol issue docs --team`、`/patrol all --team`、`/patrol --team`）
- 未知のトークン（上記以外の文字列）が 1 つでも含まれている場合は**エラーとし、巡回は実行しません**。
- 同一トークンの重複指定（例: `code code`、`pr pr issue`）は**エラーとし、巡回は実行しません**。

### エラー条件とメッセージ例

- 未知トークンが含まれている場合
  - 例: `code foo`
  - メッセージ例:
    `引数エラー: 未知のトークン 'foo' が指定されています。使用可能なトークン: code, pr, issue, docs, all, --team`

- `all` と他トークンが混在している場合
  - 例: `all code`
  - メッセージ例:
    `引数エラー: 'all' は他のトークンと同時に指定できません。'all' 単独、または 'code pr issue docs' などを指定してください`

- 同一トークンが重複指定されている場合
  - 例: `code code`
  - メッセージ例:
    `引数エラー: トークン 'code' が重複して指定されています。同じトークンは 1 度だけ指定してください`

### 正常系の使用例

- すべて巡回したい場合（引数なし / all）
  - `/patrol`
  - `/patrol all`
- コードとPRのみ巡回したい場合
  - `/patrol code pr`
- Issue とドキュメントのみ巡回したい場合
  - `/patrol issue docs`
- Agent Teamsモードですべて巡回したい場合
  - `/patrol --team`
  - `/patrol all --team`
- Agent Teamsモードでコードとドキュメントのみ巡回したい場合
  - `/patrol code docs --team`

## 巡回フロー

### 準備: 既存オープンIssue一覧を取得（重複チェック用）

```bash
gh issue list --state open --json number,title,body,labels --limit 100
```

この一覧を以降の各巡回で「既存Issueとの重複チェック」に使用する。

※ 上記の `--limit 100` はあくまで例です。オープンIssueが 100 件を超える大規模リポジトリでは、このままだと古いIssueが取得されず重複チェックが不完全になります。
   - 対象リポジトリの規模に応じて `--limit` の値を十分大きくするか、
   - または `gh api` を用いてページングし、必要な件数のIssueを取得してから重複チェックを行ってください。

### 巡回1: コード巡回（`code`）

以下の観点でリポジトリ内のソースコードを分析する:

1. **TODOコメント**: `TODO`, `FIXME`, `HACK`, `XXX` コメントを検索し、Issue化すべきものを検出
   ```bash
   grep -rnE "TODO|FIXME|HACK|XXX" \
     --exclude-dir=.git \
     --exclude-dir=.claude \
     --exclude-dir=node_modules \
     --exclude-dir=dist \
     --exclude-dir=build \
     --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.go" --include="*.rs" .
   ```
   ※ プロジェクトの技術スタックに合わせて対象拡張子を調整する。`.claude/` ディレクトリ配下や `.git/`, `node_modules/` などの生成物・依存ディレクトリは除外する。
2. **非推奨APIの使用**: deprecated な関数・メソッド・パッケージの使用箇所を検出
3. **セキュリティリスク**: ハードコードされた認証情報、安全でないHTTP通信、入力バリデーション不備等を検出
4. **パフォーマンス改善点**: N+1クエリパターン、不必要な再レンダリング、大きなバンドルサイズ等を検出
5. **エラーハンドリングの不備**: catch句が空、エラーの握りつぶし等を検出

### 巡回2: PR巡回（`pr`）

1. オープンPRを確認:
   ```bash
   gh pr list --state open --json number,title,body,labels,author,createdAt --limit 50
   ```
   - 長期間オープンのPR（14日以上）を検出
   - レビュー待ちのまま放置されているPRを検出

2. 最近マージされたPR（直近30日）を確認:
   ```bash
   gh pr list --state merged --search "merged:>=YYYY-MM-DD" --json number,title,body,labels,mergedAt --limit 100
   ```
   - PR本文に残タスク（未チェックのチェックボックス `- [ ]`）があるものを検出
   - フォローアップが必要と明記されている項目を検出

### 巡回3: Issue巡回（`issue`）

1. 長期間オープンのIssue（30日以上）を検出:
   ```bash
   gh issue list --state open --json number,title,createdAt,labels,assignees --limit 100
   ```
   - 作成から30日以上経過し、アサインもラベルもないIssueを特定

2. 最近クローズされたIssueで再発の兆候を検出:
   ```bash
   gh issue list --state closed --search "closed:>=YYYY-MM-DD" --json number,title,body,labels,closedAt --limit 50
   ```
   - `bug` ラベル付きでクローズされたIssueについて、関連するコード領域に最近の変更がないか確認

### 巡回4: ドキュメント巡回（`docs`）

1. **CLAUDE.md とコードの乖離**: `.claude/CLAUDE.md` に記載の技術スタック・重要ファイルが実際のプロジェクト構造と一致しているか確認
2. **rules/ の整合性**: `.claude/rules/` 配下のルールファイルが実際の運用と乖離していないか確認
3. **commands/ の網羅性**: `.claude/commands/` 配下のコマンドファイルが、実際のコマンド一覧の管理方法（例: 各ファイル先頭の frontmatter `description`）と整合しているか確認
4. **SETUP.md の記載漏れ**: 新しく追加されたコマンドやルールが SETUP.md の書き換え箇所一覧に反映されているか確認
5. **README等の更新漏れ**: README.md がある場合、記載内容とコードの乖離を確認

## Agent Teamsモード（`--team`）

> **注意**: Agent Teams は実験的機能です。`.claude/settings.json` の `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` が `"1"` に設定されている必要があります。

`--team` フラグが指定されている場合、巡回対象ごとにチームメイトを作成して並列分担処理する。

### Agent Teamsモードの動作

1. 準備フェーズ（既存オープンIssue一覧の取得）は通常通りリードが実行
2. 巡回対象に応じて以下のチームメイトを作成:
   - **コード巡回担当**: TODOコメント、非推奨API、セキュリティリスク、パフォーマンス改善点を分析
   - **PR巡回担当**: オープンPR・最近マージされたPRの残タスク・フォローアップを検出
   - **Issue巡回担当**: 長期間オープンのIssue、再発兆候の検出
   - **ドキュメント巡回担当**: CLAUDE.md・rules・commands・SETUP.mdとコードの乖離を検出
3. 各チームメイトが独立コンテキストで深く分析し、結果を返す
4. リードが全チームメイトの結果を統合して「結果の出力フォーマット」に従い出力

### チームメイトへの共有情報

リードは各チームメイトに以下の情報を共有する:
- 既存オープンIssue一覧（重複チェック用）
- 巡回の観点と出力フォーマット（各チームメイトの担当分のみ）

### フォールバック条件

以下の場合は `--team` が指定されていても従来の逐次処理を使用:

- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` が未設定
- Agent Teams の作成に失敗した場合
- 巡回対象が1つのみの場合（例: `/patrol code --team`）— チームメイト作成のオーバーヘッドを避けるため

## 結果の出力フォーマット

各巡回の検出結果を以下のフォーマットでIssue候補として一覧表示する:

```
## 巡回結果

### コード巡回
| ID     | カテゴリ | 概要 | 重要度 | 既存Issue重複 |
|--------|----------|------|--------|---------------|
| code-1 | bug      | ... | high   | なし          |
| code-2 | refactor | ... | medium | #XX と類似    |

### PR巡回
| ID   | カテゴリ | 概要 | 重要度 | 既存Issue重複 |
|------|----------|------|--------|---------------|
| pr-1 | chore    | ... | low    | なし          |

### Issue巡回
（同様のフォーマット）

### ドキュメント巡回
（同様のフォーマット）

---
検出件数: {合計}件（重複疑い: {重複数}件）
```

- **カテゴリ**: `bug`, `enhancement`, `refactor`, `documentation`, `chore` のいずれか
- **重要度**: `high`（セキュリティ・バグ）, `medium`（機能改善・パフォーマンス）, `low`（リファクタリング・ドキュメント）
- **既存Issue重複**: タイトルや内容が類似する既存オープンIssueがある場合にフラグ付け

## Issue作成の確認

検出結果を表示した後、ユーザーに確認を求める:

```
Issue化する候補のIDを指定してください（例: code-1,pr-2）。
一覧に表示されたID（例: `code-1`, `pr-2`）をカンマ区切りで入力してください。`all` で全件、`none` でスキップ。重複フラグ付きは除外推奨。
```

- ユーザーが承認した候補のみ `/issue-create` でIssueを作成する
- **自動作成はしない** — 必ずユーザーの明示的な承認を得る
- 重複フラグ付きの候補をユーザーが選択した場合、重複の可能性がある旨を再度警告する

## 注意事項

- 巡回対象がない場合（例: PRが0件）、その巡回はスキップして「対象なし」と表示する
- 検出件数が0件の場合、「問題は検出されませんでした」と表示する
- GitHub API のレート制限に注意し、必要最小限のAPI呼び出しに抑える
- `.claude/` ディレクトリ配下のファイルはコード巡回の対象外とする（コマンド・ルールファイルはドキュメント巡回で扱う）
