---
description: .claude/ 配下の書き込み保護仕様と運用ルール
globs: []
---

# `.claude/` 書き込み保護ルール

## Claude Code の `.claude/` 保護仕様

- `.claude/` 配下のファイルは `.claude/settings.json` の `permissions.allow` で `"Edit"` / `"Write"` を一般許可しても保護がバイパスされない
- `bypassPermissions` モード（Agent ツールの `mode: "bypassPermissions"` で指定する、権限チェックを省略する起動モード）でも `.claude/` への書き込みには承認プロンプトが表示される
- **例外（保護なし）**: `.claude/commands/`, `.claude/agents/`, `.claude/skills/` は保護対象外

## バックグラウンド・worktree エージェントでの注意点

- `run_in_background: true` のエージェントが `.claude/` 配下を編集すると、承認プロンプトを受け付けられずスタックする
- `isolation: "worktree"` で起動した worktree エージェントも、`run_in_background: true` と組み合わせた場合は同様にスタックする
- 対策: `.claude/` 配下のうちバックグラウンドで編集が必要なパスに対してのみ、パススコープ付き権限で明示的に許可を与える
  - この明示的に許可されたパスでは承認プロンプトなしで書き込みできる（保護をバイパスする）が、それ以外の `.claude/` 配下は引き続き承認プロンプト付きで保護される
  - worktree エージェントの場合も同じパススコープ付き権限（例: `Edit(.claude/rules/**)`, `Write(.claude/rules/**)` 等）を設定すること

## Agent Teams のチームメイトでの注意点

Agent Teams で `/parallel-suggest` 等からチームメイトを起動する場合、チームメイトの最初のツール呼び出しで権限承認要求が発生するとリード側に承認UIがsurface せずスタックする既知の問題がある。そのため:

- **チームメイトは `mode: "bypassPermissions"` で起動する**（`.claude/commands/parallel-suggest.md` 参照）
- **`bypassPermissions` 指定時も `.claude/` 保護は維持される**。`.claude/settings.json` / `.claude/settings.local.json` / `.claude/rules/` / `.claude/CLAUDE.md` 等へのチームメイトからの書き込みは依然として承認プロンプトが出る
- **例外領域での動作**: `.claude/commands/`, `.claude/agents/`, `.claude/skills/` は保護対象外のため、`bypassPermissions` で起動されたチームメイトは承認プロンプトなしで編集できる
- **保護対象パスへの書き込みが必要な場合**: リード側で事前に `permissions.allow` にパススコープ付き許可（例: `Edit(.claude/rules/**)`, `Write(.claude/rules/**)`）を追加してから並列実行を開始する

## 推奨設定パターン

### 許可すべきパス

エージェントがルール更新等で編集する必要がある場合、以下のパススコープ付き権限を設定する。
これらのパスは **承認プロンプトなしで編集できるよう保護をバイパスしつつ、権限スコープを `.claude/` 配下の一部に限定する** ことを目的としている:

- `Edit(.claude/rules/**)`
- `Write(.claude/rules/**)`
- `Edit(.claude/CLAUDE.md)`

> **注意**: `permissions.allow` にグローバルな `"Edit"` / `"Write"` が含まれている場合、パススコープ付き許可を追加してもスコープは絞れない。バックグラウンドエージェント用にスコープを限定するには、グローバルな `"Edit"` / `"Write"` を外し、必要なパスのみパススコープ付きで許可する構成にすること。

### 保護を維持すべきパス

以下のファイルは意図しない変更を防ぐため、保護を維持する（明示的な許可を設定しない）:

- `.claude/settings.json` — プロジェクト全体の設定。不正な変更はセキュリティリスクになる
- `.claude/settings.local.json` — ローカル設定。個人の権限設定を含む
