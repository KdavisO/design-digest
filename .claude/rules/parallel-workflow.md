---
description: 並列開発（git worktree）を行う際のルール
globs: []
---

# 並列作業ルール

## worktree エージェントの起動

複数 Issue を並列で処理する場合、Agent ツールに `isolation: "worktree"` を指定して起動する。

```
Agent:
  prompt: "Issue #XXX を実装してください。要件: ..."
  isolation: "worktree"
  run_in_background: true  # 複数 Issue を並列処理する場合
```

## run_in_background の使い分け

- **複数 Issue を並列処理する場合**: `run_in_background: true`（他のタスクと並行するため）
- **単一 Issue のみの場合（`--auto` 含む）**: `run_in_background: false`（フォアグラウンドで実行し、進捗をリアルタイムで表示）

## 並列実行前の確認事項

1. **変更ファイルの重複チェック**: 並列タスクが同じファイルを変更しないことを確認
2. **DB マイグレーション競合チェック**: 同時にマイグレーションを追加する場合はタイムスタンプを分散
3. **Issue 分類の参照**: `docs/issue-groups.md` で並列実行可能なグループを確認

## エージェントへの指示に含めるべき情報

- Issue 番号と要件の全文
- ブランチ命名規約（`{type}/{issue番号}-{説明}`）
- コミット規約（プレフィックス必須、セルフレビュー必須）
- 変更してはいけないファイル（他のエージェントが担当中のファイル）
- `pnpm install` を最初に実行すること

## 並列数の上限

- 最大 3〜4 エージェント（完全に独立したタスクの場合）
- ファイル共有がある場合は 2 まで
- 共通ライブラリの変更を含む場合は直列実行

## worktree のライフサイクル

- PR 作成時: worktree は**削除しない**（レビュー対応のため保持が必要）
- マージ後: `/worktree-cleanup` でマージ済みworktreeを一括削除

## Agent Teams パターン（実験的）

> Agent Teams は実験的機能です。詳細は `.claude/rules/agent-teams.md` を参照。

### サブエージェント（worktree）との使い分け

- **完全に独立したタスク** → サブエージェント + worktree（従来方式）
- **相互依存のあるタスク**（共有ファイル変更、インターフェース調整）→ Agent Teams
- **レビュー対応の観点分担** → Agent Teams

### Agent Teams で並列処理する場合

サブエージェント + worktree と異なり、Agent Teams は**同一ブランチ・同一ディレクトリ**で動作する。そのため:

1. **ファイルレベルの競合回避**: チームメイトが同一ファイルを同時編集しないよう、リードが作業範囲を明確に指示する
2. **コミット順序の調整**: 各チームメイトの変更が論理的に独立したコミットになるよう、リードがコミットタイミングを調整する
3. **相互依存の活用**: API定義の変更とその利用側の変更など、チームメイト間でメッセージをやり取りしてインターフェースを合意できる

### Agent Teams + worktree 方式での権限扱い

`/parallel-suggest` のように Agent Teams + worktree のハイブリッド方式でチームメイトを起動する場合、各チームメイトは独立した worktree で作業するため原則として同一ディレクトリ制約は当てはまらない。ただし以下の権限扱いに注意する:

- **チームメイト起動時は `mode: "bypassPermissions"` を必須とする**。Agent Teams ではチームメイトのツール呼び出し時に発生する権限承認要求がリード側にsurface せずスタックする既知の問題があるため、worktree 内の独立作業で副作用範囲が限定されているケースでは bypass で起動する
- **`.claude/` 保護は依然有効**: `bypassPermissions` でも `.claude/settings.json` / `.claude/settings.local.json` / `.claude/rules/` / `.claude/CLAUDE.md` 等は承認プロンプトが出る。これら保護対象配下への書き込みが必要な場合は、事前に `permissions.allow` にパススコープ付き許可を設定する。既存ファイルの更新であれば `Edit(.claude/rules/**)`、新規ファイル作成やファイル出力が発生しうる場合は `Write(.claude/rules/**)` も含めて許可する（詳細は `.claude/rules/claude-dir-protection.md`）

### 使用例: API変更 + フロントエンド対応

```
以下の2つのチームメイトを作成して、Issue #XX を対応してください:
- API担当: バックエンドのAPI変更を実装。変更後のインターフェースをフロントエンド担当に共有
- フロントエンド担当: API担当からインターフェース定義を受け取り、フロントエンドを対応

API担当が先にインターフェースを確定し、フロントエンド担当はそれを待ってから実装を開始してください。
```
