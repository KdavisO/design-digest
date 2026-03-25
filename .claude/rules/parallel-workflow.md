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
