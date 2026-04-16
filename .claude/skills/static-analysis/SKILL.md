---
name: static-analysis
description: Semgrep・CodeQL を活用した静的セキュリティ解析。脆弱性スキャン、カスタムルール作成、SARIF結果のパース・トリアージを行う。
---

# Static Analysis（静的セキュリティ解析）

Trail of Bits の Testing Handbook（https://appsec.guide/docs/static-analysis/）を参考にした静的解析スキル。

## トリガー

以下の場合にこのスキルを適用する:

- セキュリティ監査の一環として静的解析を実行する場合
- 新しい外部依存の追加やセキュリティ境界の変更後
- CI/CD パイプラインで検出された静的解析結果のトリアージ

## 前提条件

| ツール | 要否 | インストール |
| --- | --- | --- |
| Semgrep CLI | 推奨 | `pip install semgrep` または `brew install semgrep` |
| CodeQL CLI | 任意 | [GitHub CodeQL CLI](https://github.com/github/codeql-cli-binaries/releases) |
| jq | 推奨 | `brew install jq`（SARIF パース用） |

## ワークフロー

### 1. Semgrep スキャン

#### クイックスキャン（重要な脆弱性のみ）

```bash
# 前提条件チェック
command -v semgrep >/dev/null 2>&1 || { echo "Error: semgrep が未インストールです。pip install semgrep を実行してください。"; exit 1; }

# テレメトリを無効化（必須）
export SEMGREP_SEND_METRICS=off

# 高確度セキュリティルールのみでスキャン
semgrep scan --config=p/security-audit --metrics=off --sarif -o results.sarif .
```

#### フルスキャン（全ルールセット）

```bash
# 標準ルールセット + サードパーティルール
semgrep scan \
  --config=p/security-audit \
  --config=p/owasp-top-ten \
  --config=p/cwe-top-25 \
  --metrics=off \
  --sarif -o results.sarif .
```

### 2. CodeQL スキャン（任意）

```bash
if command -v codeql >/dev/null 2>&1; then
  # データベース構築
  codeql database create codeql-db --language={言語} --source-root=.

  # セキュリティクエリ実行
  codeql database analyze codeql-db --format=sarif-latest --output=codeql-results.sarif -- codeql/{言語}-queries:codeql-suites/{言語}-security-extended.qls
else
  echo "Info: codeql が未インストールです。Semgrep のみで解析します。"
fi
```

対応言語: python, javascript, go, java, cpp, csharp, ruby, swift

### 3. SARIF 結果のパース・トリアージ

```bash
# jq で結果を集約
jq '.runs[].results[] | {
  ruleId: .ruleId,
  level: .level,
  message: .message.text,
  location: .locations[0].physicalLocation.artifactLocation.uri + ":" + (.locations[0].physicalLocation.region.startLine | tostring)
}' results.sarif
```

### 4. トリアージ基準

| 分類 | 条件 | 対応 |
| --- | --- | --- |
| **真陽性（Critical）** | 実際に悪用可能な脆弱性 | 即座に修正 |
| **真陽性（Medium）** | 悪用は困難だがリスクあり | PR 内で修正 |
| **偽陽性** | コンテキスト上安全 | `# nosemgrep: {rule-id}` で抑制（理由コメント必須） |
| **要調査** | 判断がつかない | differential-review スキルで詳細分析 |

### 5. カスタムルール作成

プロジェクト固有のセキュリティパターンを検出するルールを作成する:

```yaml
# .semgrep/custom-rules.yml
rules:
  - id: project-specific-rule
    patterns:
      - pattern: |
          $FUNC(...)
    message: "セキュリティ上の懸念: $FUNC の使用を確認してください"
    severity: WARNING
    languages: [typescript, javascript]
```

## 既存スキル・コマンドとの連携

- **differential-review**: 静的解析で検出された問題の詳細分析に使用
- **requesting-code-review**: 静的解析結果をレビューのインプットとして参照
- **quality-gate-hooks**: CI 統合時、PostToolUse フックで自動実行可能

## 注意事項

- `--metrics=off` を必ず指定する（Semgrep のテレメトリ送信を防止）
- 偽陽性の抑制には必ず理由コメントを付ける
- 大規模プロジェクトではスキャン対象ディレクトリを限定する（`--include` / `--exclude`）
- SARIF ファイルはコミットに含めない（`.gitignore` に追加）
