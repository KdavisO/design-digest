# Issue グループ・並列実行ガイド

このファイルはプロジェクトの Issue を変更領域ごとにグループ分けし、並列実行の可否を判断するために使用されます。
`/parallel-suggest` コマンドおよび並列作業ルール（`.claude/rules/parallel-workflow.md`）から参照されます。

## 使い方

1. Issue を作成したら、変更対象の領域に応じて下記グループに分類する
2. 同じグループ内の Issue は変更ファイルが重複する可能性があるため、並列実行時は注意する
3. 異なるグループの Issue は基本的に並列実行可能

## グループ定義

### コア処理（差分検出・スナップショット）

- **変更領域**: `src/diff.ts`, `src/diff-engine.ts`, `src/snapshot.ts`, `src/config.ts`, `src/json-utils.ts`
- **競合リスクが高いファイル**: `src/diff-engine.ts`, `src/snapshot.ts`

| Issue | 概要 | スコープ |
|-------|------|----------|
| #146 | snapshot.ts の JSON.parse バリデーション強化を検討 | 小 |

### Figma API・データ取得

- **変更領域**: `src/figma-client.ts`, `src/figma-schemas.ts`, `src/adapters/`
- **競合リスクが高いファイル**: `src/figma-client.ts`, `src/adapters/figma-data-adapter.ts`

| Issue | 概要 | スコープ |
|-------|------|----------|
| #81 | Figma MCP ヘッドレス対応の再調査 | 中 |
| #7 | デザイントークン同期 Figma Variables API | 大 |

- 備考: Issue #65（CI / GitHub Actions グループ）で Figma MCP の GitHub Actions 統合を実施する際、本グループのコードも影響を受ける可能性があります。

### 通知・外部連携

- **変更領域**: `src/notify.ts`, `src/claude-summary.ts`, `src/backlog-client.ts`, `src/github-issue-client.ts`
- **競合リスクが高いファイル**: `src/notify.ts`

| Issue | 概要 | スコープ |
|-------|------|----------|
| #4 | Discord / Microsoft Teams 通知対応 | 中 |

### テスト・品質

- **変更領域**: `src/**/*.test.ts`, `vitest.config.ts`
- **競合リスクが高いファイル**: なし（テストファイルは対応する本体ファイルに紐づく）

| Issue | 概要 | スコープ |
|-------|------|----------|
| #5 | VRT Visual Regression Testing の実装 | 大 |

### CI / GitHub Actions

- **変更領域**: `.github/workflows/`
- **競合リスクが高いファイル**: `.github/workflows/figma-diff.yml`

| Issue | 概要 | スコープ |
|-------|------|----------|
| #65 | Figma MCP の GitHub Actions 統合 | 大 |

### ドキュメント

- **変更領域**: `docs/`, `CLAUDE.md`, `.claude/`
- **競合リスクが高いファイル**: なし（低リスク）

| Issue | 概要 | スコープ |
|-------|------|----------|
| #151 | issue-groups.md にプロジェクト固有の Issue グループを定義 | 小 |
| #150 | project-structure.md に実際の構造を記載 | 小 |
| #149 | CLAUDE.md にプロジェクト固有情報を記載 | 小 |

### デザインツール拡張

- **変更領域**: `src/adapters/`, `src/design-check.ts`, `src/config.ts`
- **競合リスクが高いファイル**: `src/adapters/index.ts`, `src/config.ts`

| Issue | 概要 | スコープ |
|-------|------|----------|
| #8 | Figma 以外のデザインツール対応 Penpot 等 | 大 |

## 依存関係

```
# #65 は #81 の完了が前提（MCP ヘッドレス対応の調査結果に基づいて統合方針を決定）
#81 (Figma MCP ヘッドレス対応の再調査) → #65 (Figma MCP の GitHub Actions 統合)
```

## 推奨並列実行パターン

```
# ドキュメント系3並列（競合リスクなし）
#149 + #150 + #151（ドキュメント × 3）

# 独立領域の2〜3並列
#146 (コア処理) + #4 (通知) + #5 (テスト)
#7 (デザイントークン) + #4 (通知)
#8 (デザインツール拡張) + #4 (通知)

# 避けるべき組み合わせ
#65 + #81（依存関係あり、直列実行必須）
#8 + #7（adapters/ と config.ts が競合）
#8 + #65（adapters/ が競合）
```

## スコープの判定基準

| スコープ | 基準 |
|----------|------|
| 小 | 1 ファイル変更、テスト追加のみ、ドキュメント更新 |
| 中 | 2〜5 ファイル変更、新規コンポーネント追加、API 追加 |
| 大 | 6 ファイル以上変更、DB マイグレーション含む、複数領域にまたがる |
