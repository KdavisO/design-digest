---
description: 以下の内容からGitHub Issueを作成してください。
---

以下の内容からGitHub Issueを作成してください。

入力: $ARGUMENTS

## 手順

1. 入力内容を分析し、適切なIssueに整形する
2. タイトルを簡潔に作成（日本語OK）
3. 本文を以下のフォーマットで作成:

```
## 背景
<!-- なぜこの変更が必要か -->

## 要件
<!-- 具体的に何を実現するか（箇条書き） -->

## 受け入れ条件
<!-- 完了の定義（箇条書き） -->
```

4. 内容に応じて適切なラベルを選択:
   - `bug`: バグ修正
   - `enhancement` or `feature`: 新機能
   - `refactor`: リファクタリング
   - `documentation`: ドキュメント
   <!-- プロジェクト固有のラベルを追加（例: `ui/ux`, `database` 等） -->
5. 優先度ラベルを選択（必須）:
   - `priority:high`: リリース前に必須（セキュリティ、法的要件など）
   - `priority:medium`: リリース準備・アプリ化関連
   - `priority:low`: 機能追加・その他
6. `gh issue create` でIssueを作成:
   ```
   gh issue create --title "タイトル" --body "本文" --label "ラベル1,priority:low"
   ```
   ※ `priority:` は `high`, `medium`, `low` のいずれかを選択。ラベルは実際の値を指定すること（例: `--label "bug,priority:high"`）
7. 作成されたIssueのURLを表示する
