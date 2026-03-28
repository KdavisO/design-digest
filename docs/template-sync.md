# テンプレート同期ガイド

このドキュメントでは、テンプレートリポジトリ（`claude-project-template`）の更新を、テンプレートから作成したプロジェクトに反映する方法を説明する。

## 採用方式: actions-template-sync

[actions-template-sync](https://github.com/AndreasAugustin/actions-template-sync) を使用し、テンプレートの変更をPRとして自動配信する。

### 方式選定の比較

| 方式 | セットアップ | カスタマイズ除外 | 競合ハンドリング | 保守コスト |
|---|---|---|---|---|
| **actions-template-sync** | 低（workflow + secret） | `.templatesyncignore` | PR レビューで対応 | 低 |
| Git remote merge | 低（git コマンド） | 不可（手動競合解決） | git merge conflict | 中 |
| カスタム GitHub Action | 高（独自実装） | 自由（カスタムロジック） | 上書きまたはカスタム差分 | 高 |
| Git subtree | 中 | 不可（ディレクトリ単位） | subtree 競合（不透明） | 中 |

**選定理由:**
- `.templatesyncignore` でプロジェクト固有ファイルを除外でき、カスタマイズとの競合を最小化できる
- PRベースのレビューフローにより、変更の確認・テスト・マージをプロジェクト側のペースで行える
- セットアップと保守コストが最小

### 同期されるファイルの分類

| 分類 | ファイル例 | 同期対象 |
|---|---|---|
| 共有ルール | `.claude/rules/git-conventions.md`, `.claude/rules/parallel-workflow.md` | 同期する |
| 共有コマンド | `.claude/commands/*.md` | 同期する |
| 共有スキル | `.claude/skills/*.md`（テンプレート提供分） | 同期する |
| 共有設定 | `.claude/settings.json` | 同期する |
| ワークフロー | `.github/workflows/template-sync.yml` | 同期する |
| プロジェクト固有設定 | `.claude/CLAUDE.md` | **除外** |
| プロジェクト固有設定（ローカル） | `.claude/settings.local.json` | **除外**（gitignored） |
| プロジェクト構造 | `.claude/rules/project-structure.md` | **除外** |
| セットアップ | `SETUP.md` | **除外** |

除外ファイルは `.templatesyncignore` で管理する。

## セットアップ手順

### 1. Personal Access Token (PAT) の作成

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. 以下の権限で新しいトークンを作成:
   - **Repository access**: テンプレートリポジトリ（`claude-project-template`）**と同期先（ダウンストリーム）リポジトリ**を含める
   - **Permissions**:
     - Contents: Read and write
     - Pull requests: Read and write
     - Issues: Read and write（ラベル操作に必要）
     - Workflows: Read and write（ワークフローファイルの同期に必要）
3. トークンをコピー

### 2. ダウンストリームリポジトリにシークレットを追加

```bash
gh secret set TEMPLATE_SYNC_TOKEN --body "<PAT>"
```

### 3. リポジトリ設定の確認

ダウンストリームリポジトリの Settings → Actions → General で以下を有効化する:

- **Allow GitHub Actions to create and approve pull requests**: 有効化（同期PRの自動作成に必要）

### 4. ワークフローファイルの確認

テンプレートから作成したリポジトリには、以下のファイルが含まれている:

- `.github/workflows/template-sync.yml` — 同期ワークフロー
- `.templatesyncignore` — 同期除外ファイルリスト

### 5. 動作確認

```bash
gh workflow run template-sync.yml
```

実行後、テンプレートとの差分があればPRが自動作成される。

## 運用フロー

### 通常の同期サイクル

1. テンプレートリポジトリで変更がコミットされる
2. 毎週月曜 9:00 UTC にダウンストリームリポジトリで同期ワークフローが実行される
3. 差分がある場合、PRが自動作成される（ラベル: `chore`, `template-sync`）
4. プロジェクトメンバーがPRをレビュー・マージする

### 手動での即時同期

```bash
gh workflow run template-sync.yml
```

### 除外ファイルの変更

プロジェクト固有のファイルが増えた場合は `.templatesyncignore` に追加する:

```
# 例: プロジェクト固有のスキルファイル
.claude/skills/my-project-specific-skill.md
```

### 競合が発生した場合

同期PRで競合が発生した場合:

1. PRのブランチをローカルにチェックアウト
2. リモートの `main` を取得してからマージする

   ```bash
   git fetch origin main
   git merge origin/main
   ```

3. 競合を解決し、結果をプッシュしてPRをマージ

頻繁に競合するファイルは `.templatesyncignore` への追加を検討する。

## settings.json と settings.local.json の使い分け

Claude Code は `.claude/settings.json` と `.claude/settings.local.json` の設定を**マージ**して読み込む。このマージ動作を活用し、テンプレート共通設定とプロジェクト固有設定を分離する。

### マージ動作

| フィールド種別 | 動作 | 例 |
|---|---|---|
| 配列（`permissions.allow` 等） | 和集合マージ | 両ファイルの allow ルールが全て有効 |
| オブジェクト（`hooks`, `env` 等） | ディープマージ | 両ファイルの hooks が全て適用 |
| プリミティブ（文字列, 真偽値） | `settings.local.json` が優先 | |

### 使い分けルール

| ファイル | 役割 | 管理 |
|---|---|---|
| `.claude/settings.json` | テンプレート共通設定（permissions, hooks, env） | テンプレートが管理。template-sync で同期される。**ダウンストリームでの直接編集は避ける** |
| `.claude/settings.local.json` | プロジェクト固有の追加設定 | 各プロジェクトが管理。`.gitignore` に含まれ、同期対象外 |

### ダウンストリームでの設定追加例

プロジェクト固有の permissions を追加したい場合、`.claude/settings.local.json` に記載する:

```json
{
  "permissions": {
    "allow": [
      "Bash(docker *)",
      "Bash(kubectl *)"
    ]
  }
}
```

この設定は `settings.json` のテンプレート共通 permissions とマージされ、両方が有効になる。

### 移行手順（既存ダウンストリーム向け）

`settings.json` がこれまで `.templatesyncignore` で除外されていたため、既存のダウンストリームでは `settings.json` にプロジェクト固有の設定が含まれている可能性がある。以下の手順で移行する:

1. `settings.json` のうち、テンプレートにない独自の設定を特定する
2. 独自の設定を `.claude/settings.local.json` に移動する
3. `settings.json` をテンプレートの内容で上書きする（次回の template-sync PR で自動的に行われる）
4. `.claude/settings.local.json` をバージョン管理から除外するため、プロジェクトの `.gitignore`（または同等の ignore 設定ファイル）に次の行が含まれていることを確認する:

   ```gitignore
   .claude/settings.local.json
   ```

## 既存プロジェクトへの導入

テンプレートを使わずに作成した既存プロジェクトにも導入可能:

1. `.github/workflows/template-sync.yml` をコピー
2. `.templatesyncignore` をプロジェクトに合わせて作成
3. `TEMPLATE_SYNC_TOKEN` シークレットを設定
4. 初回同期を実行（差分が大きい場合はPRを慎重にレビュー）
