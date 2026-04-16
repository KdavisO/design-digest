---
description: PostToolUseフックによるlint・型チェック自動実行の品質ゲート運用ガイドライン
globs: []
---

# PostToolUse 品質ゲートフック運用ガイドライン

## 概要

`PostToolUse` フックを利用して、コミット時（実行直後）やファイル編集後に lint・型チェックを自動実行する。エラーがあれば stdout でフィードバックし、Claude が自動修正する。

## reactive-hooks.md との住み分け

| 観点 | reactive-hooks（環境同期） | quality-gate-hooks（品質ゲート） |
| --- | --- | --- |
| イベント | `CwdChanged` / `FileChanged` | `PostToolUse` |
| 目的 | 環境変数の自動リロード | lint・型エラーの自動検出 |
| タイミング | ディレクトリ移動時・ファイル変更時 | ツール実行後 |
| 対象 | `.env` / `.envrc` | `git commit` / `.ts` ファイル編集 |

## Phase 1: コミット時 lint 自動実行

`Bash` ツール実行後、`git commit` コマンドにマッチした場合に lint を自動実行する。

### 設定例

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "if printf '%s' \"$CLAUDE_TOOL_INPUT\" | grep -q 'git commit'; then pnpm lint --quiet 2>&1 || true; fi; true",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### 動作

- `Bash` ツールで `git commit` が実行された後に発火
- `pnpm lint --quiet` を実行し、エラーがあれば stdout に出力
- Claude はこの出力を読み取り、lint エラーを自動修正する
- `|| true` で `pnpm lint --quiet` の非 0 終了コードを吸収し、末尾の `; true` により条件不一致時も含めてフック全体は成功として扱う（Claude にフィードバックが伝わる）

## Phase 2: TypeScript ファイル編集時の型チェック

`.ts` / `.tsx` ファイル編集後に `tsc --noEmit` を自動実行する。

### 設定例

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "if printf '%s' \"$CLAUDE_TOOL_INPUT\" | grep -qE '\\.(ts|tsx)'; then pnpm tsc --noEmit 2>&1 | head -20 || true; fi; true",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### 動作

- `Edit` または `Write` ツールで `.ts` / `.tsx` ファイルが編集された後に発火
- `tsc --noEmit` を実行し、型エラーがあれば先頭20行を stdout に出力
- `head -20` で出力を制限し、大量の型エラーでコンテキストを圧迫しない

## 設計指針

### タイムアウト

- **30秒以内** を推奨（Phase 1・Phase 2 共通）
- 大規模プロジェクトで lint/型チェックに時間がかかる場合は、対象ディレクトリを限定するか `--cache` オプションを活用する
- タイムアウト超過時はフックが強制終了され、Claude にはタイムアウトした旨が通知される

### matcher の設定

- `"Bash"`: Bash ツール実行後にのみ発火（コミット時 lint）
- `"Edit|Write"`: Edit/Write ツール実行後にのみ発火（型チェック）
- matcher を省略すると全ツールで発火するため、必ず指定すること

### エラーハンドリング

- フックコマンドは終了コードが常に 0 になるように構成する（フック失敗によるセッション中断を防止）
- `|| true` を使う場合は一部のコマンドではなくフック全体に効く位置に置く。条件分岐を使う場合も、末尾に `; true` を付ける、または `else :` を入れるなどして、条件不一致時を含めて必ず 0 で終了させる
- lint/型チェックのエラーは stdout 経由で Claude にフィードバックされるため、exit code による制御は不要
- `2>&1` で stderr も stdout にマージし、エラーメッセージが確実に Claude に伝わるようにする

### 冪等性

- lint・型チェックは副作用がなく、何度実行しても同じ結果を返す
- `--fix` オプションはフック内では使用しない（自動修正は Claude に任せる）

## 段階的導入の推奨

1. まず Phase 1（コミット時 lint）のみ導入し、動作を確認する
2. タイムアウトや誤発火がないことを確認してから Phase 2（型チェック）を追加する
3. プロジェクトの lint/型チェックの実行時間に応じてタイムアウト値を調整する

## 注意事項

- フック設定はプロジェクト固有のため、`.claude/settings.local.json` に追記することを推奨（テンプレート管理の `.claude/settings.json` を上書きしない）
- `CLAUDE_TOOL_INPUT` 環境変数はフック実行時に自動設定される（ツールに渡された入力内容）
- フックは同期実行のため、長時間かかるコマンドはセッションの応答性に影響する
