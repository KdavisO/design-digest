# Docker 自律実行ガイド

Docker コンテナ内で Claude Code を `--dangerously-skip-permissions` フラグ付きで実行し、完全自律モードで動作させるためのガイド。

## なぜ Docker で実行するか

- **許可疲れの解消**: ファイル書き込み・シェルコマンド・テスト実行のたびに承認が不要になる
- **ホスト環境への影響を限定**: コンテナ内で動作するためホスト全体の汚染は抑えやすいが、ボリュームマウントしたプロジェクトディレクトリ内のファイル変更はホスト側にも直接反映される
- **再現性**: 同一の実行環境を誰でも再現できる
- **CI/CD 統合**: 自動パイプラインに組み込みやすい

## セットアップ

### 前提条件

- Docker および Docker Compose がインストール済み
- Anthropic API キーを取得済み

### イメージのビルド

Claude Code のバージョンと API キーを環境変数で設定してビルド・実行する。

### 環境変数の設定

```bash
export CLAUDE_CODE_VERSION="1.0.0"
export ANTHROPIC_API_KEY="sk-ant-..."
```

または `.env` ファイルに記載:

```
CLAUDE_CODE_VERSION=1.0.0
ANTHROPIC_API_KEY=sk-ant-...
```

### イメージのビルド

```bash
docker compose build
```

> **注意**: `.env` には API キーが含まれるため、リポジトリにコミットしないこと。  
> このリポジトリに `.gitignore` が存在しない場合は、ルートに `.gitignore` を新規作成して `.env` を追加してください。
>
> ```gitignore
> .env
> ```
>
> すでに `.env` を Git 管理下に入れてしまった場合は、`git rm --cached .env` で追跡対象から外してください。  
> リポジトリの `.gitignore` を使えない運用では、グローバル gitignore や CI/CD の Secrets / Environment Variables を利用して秘密情報を管理してください。

## 使用方法

### 対話モード

```bash
docker compose run --rm claude
```

### プロンプト指定

```bash
docker compose run --rm claude "Issue #123 を実装してください"
```

### ファイル入力（`-p` オプション）

```bash
docker compose run --rm claude -p "$(cat prompt.txt)"
```

### パイプ入力

パイプ入力時は `-T` で TTY を無効化する必要がある:

```bash
echo "テストを追加してください" | docker compose run --rm -T claude
```

## CI/CD での使用パターン

### GitHub Actions

```yaml
jobs:
  claude-code:
    runs-on: ubuntu-latest
    env:
      CLAUDE_CODE_VERSION: '1.0.0'
    steps:
      - uses: actions/checkout@v4
      - name: Build Claude image
        run: docker compose build
      - name: Run Claude Code
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: docker compose run -T --rm claude "全テストを実行し、失敗があれば修正してください"
```

### 夜間バッチ処理

```yaml
# .github/workflows/nightly-claude.yml
on:
  schedule:
    - cron: '0 0 * * *'  # 毎日 UTC 0:00

jobs:
  nightly:
    runs-on: ubuntu-latest
    env:
      CLAUDE_CODE_VERSION: '1.0.0'
    steps:
      - uses: actions/checkout@v4
      - name: Build Claude image
        run: docker compose build
      - name: Run Claude Code
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: docker compose run -T --rm claude "コードベースを分析し、改善提案をIssueとして起票してください"
```

## セキュリティ上の注意

- **API キーの管理**: 環境変数またはシークレット管理ツール経由で渡す。Dockerfile やイメージ内にハードコードしない
- **ネットワーク制限**: Claude Code は Anthropic API への通信が必要なため、`network_mode: "none"` のような完全遮断は不可。外部通信を制限したい場合は、ファイアウォール、プロキシ、または別ネットワーク設計により許可する宛先を必要最小限に絞る
- **ボリュームマウント**: マウント先はプロジェクトディレクトリに限定し、ホストのホームディレクトリ全体をマウントしない
- **イメージの更新**: Claude Code のバージョンアップに追従するため、定期的にイメージをリビルドする
- **コンテナ内の権限**: Dockerfile では非 root（指定 UID/GID）で実行するよう設定済み。UID が既存ユーザーと衝突する場合など、実行時のユーザー名は常に `claude` になるとは限らない。ボリュームマウントしたワークスペースの UID/GID と一致しない場合、ファイル生成・編集に失敗することがある。その場合はビルド時に UID/GID を合わせる: `docker compose build --build-arg UID=$(id -u) --build-arg GID=$(id -g)`（`CLAUDE_CODE_VERSION` 環境変数の設定も必要）

## カスタマイズ

### 追加ツールのインストール

プロジェクト固有のツールが必要な場合、Dockerfile を拡張する:

```dockerfile
# 例: Python 環境を追加
RUN apt-get update && apt-get install -y python3 python3-pip
```

### モデルの指定

```bash
docker compose run --rm claude --model claude-sonnet-4-6 "軽量タスクを実行"
```

### 最大ターン数の制限

```bash
docker compose run --rm claude --max-turns 10 "スコープを限定したタスク"
```
