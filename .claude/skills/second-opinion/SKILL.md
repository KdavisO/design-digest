---
name: second-opinion
description: OpenAI Codex CLI・Google Gemini CLI を使ったマルチLLMコードレビュー。Claude 以外の視点でセキュリティ・品質を検証する。
---

# Second Opinion（マルチLLMレビュー）

Trail of Bits の second-opinion スキルを参考にした、外部LLMによるコードレビュースキル。

## トリガー

以下の場合にこのスキルを適用する:

- セキュリティクリティカルな変更で、Claude 以外の視点が必要な場合
- 重要な設計判断で複数のLLMの意見を比較したい場合
- 既存のコードレビューで見落としがないか確認したい場合

## 前提条件

| ツール | インストール | 認証 |
| --- | --- | --- |
| OpenAI Codex CLI | `npm i -g @openai/codex` | `OPENAI_API_KEY` 環境変数（Tier 4以上推奨） |
| Google Gemini CLI | `npm i -g @google/gemini-cli` | Google アカウント認証 |

少なくとも1つのツールがインストールされていれば使用可能。

## ワークフロー

### 1. 前提条件チェック

```bash
# 利用可能なツールを確認
CODEX_AVAILABLE=false
GEMINI_AVAILABLE=false

command -v codex >/dev/null 2>&1 && CODEX_AVAILABLE=true
command -v gemini >/dev/null 2>&1 && GEMINI_AVAILABLE=true

if [ "$CODEX_AVAILABLE" = false ] && [ "$GEMINI_AVAILABLE" = false ]; then
  echo "Error: codex または gemini CLI が必要です。"
  echo "  npm i -g @openai/codex"
  echo "  npm i -g @google/gemini-cli"
  exit 1
fi
```

### 2. レビュー対象の準備

以下のいずれか1つを選んで実行する（3つは用途の異なる代替手段）:

```bash
# 一意な一時ファイルを作成（衝突・漏洩防止）
REVIEW_DIFF="$(mktemp /tmp/review-diff-XXXXXX.patch)"
chmod 600 "$REVIEW_DIFF"
```

**未コミット変更のレビュー:**
```bash
git diff > "$REVIEW_DIFF"
```

**ブランチ差分のレビュー:**
```bash
git diff origin/main...HEAD > "$REVIEW_DIFF"
```

**特定コミットのレビュー:**
```bash
git show {commit-sha} > "$REVIEW_DIFF"
```

### 3. Codex CLI によるレビュー

差分はファイルパスで渡す（引数展開すると引数長制限やプロセス引数への露出リスクがある）:

```bash
# ヘッドレス実行（自動承認モード）
# --file オプションでファイルパスを渡す
codex exec --file "$REVIEW_DIFF" "添付のコード差分をセキュリティ観点でレビューしてください。
認証・暗号・入力バリデーション・外部呼び出しに注目し、
Critical/Important/Informational の3段階で報告してください。"
```

> **注意:** `--file` オプションが利用できない場合は stdin 経由（`cat "$REVIEW_DIFF" | codex exec ...`）を検討する。`$(cat ...)` による引数展開は、大きな差分で引数長制限に達するリスクや、`ps` 等で差分内容が露出するリスクがあるため避ける。

### 4. Gemini CLI によるレビュー

```bash
# stdin 経由で差分を渡す
cat "$REVIEW_DIFF" | gemini -p "以下の stdin のコード差分をセキュリティ観点でレビューしてください。
認証・暗号・入力バリデーション・外部呼び出しに注目し、
Critical/Important/Informational の3段階で報告してください。"
```

> **注意:** gemini CLI が stdin を読み取らないバージョンの場合は `--file` オプション等を確認する。`$(cat ...)` による引数展開は避けること（理由は Codex の注意事項と同じ）。

### 5. 結果の統合

各LLMの結果を以下の観点で統合する:

- **一致した指摘**: 複数LLMが同じ問題を指摘 → 信頼度が高い
- **片方のみの指摘**: 追加検証が必要 → differential-review で深掘り
- **矛盾する指摘**: 両方の根拠を確認し、コード上で検証

### 6. レポート出力

```
## マルチLLMレビュー結果

### 使用ツール
- [x] Codex CLI / [ ] Gemini CLI

### 一致した指摘（高信頼度）
| # | 重要度 | 内容 | 場所 |
|---|--------|------|------|
| 1 | Critical | ... | file:line |

### 個別の指摘（要追加検証）
#### Codex の指摘
- ...
#### Gemini の指摘
- ...

### 総合評価
{統合した評価と推奨アクション}
```

## 既存スキル・コマンドとの使い分け

| 観点 | requesting-code-review | second-opinion |
| --- | --- | --- |
| レビュアー | Claude サブエージェント | 外部LLM（Codex/Gemini） |
| 目的 | 一般的なコードレビュー | 多角的な視点の確保 |
| コスト | なし | 外部API呼び出しコスト |
| 推奨場面 | 通常のPR | セキュリティクリティカルな変更 |

## 注意事項

- 外部LLMにコードを送信するため、機密性の高いコードでは使用を控える
- Codex/Gemini のレスポンスは参考意見として扱い、最終判断は自身で行う
- API コストが発生するため、頻繁な使用は避ける
- レビュー完了後は一時ファイルを削除する（`rm "$REVIEW_DIFF"`）
