# Claude Code 自律実行環境
# Docker コンテナ内で --dangerously-skip-permissions を安全に使用するための環境

FROM node:22-slim

# 必要なシステムツールをインストール
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Claude Code をグローバルインストール（固定バージョン指定を推奨）
# `latest` はビルド再現性を損なうため、確認済みバージョンを明示指定すること
# 例: docker compose build --build-arg CLAUDE_CODE_VERSION=1.0.0
ARG CLAUDE_CODE_VERSION
RUN if [ -z "${CLAUDE_CODE_VERSION}" ]; then \
      echo "CLAUDE_CODE_VERSION is required. Specify it with --build-arg CLAUDE_CODE_VERSION=<version>." >&2; \
      exit 1; \
    fi && \
    npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"

# 作業ユーザーを作成（root での実行を避ける）
# UID/GID をビルド引数で指定可能（CI 環境でホスト側と合わせる用途）
# node:22-slim には UID/GID=1000 の node ユーザーが存在するため、デフォルトは競合しない値にする
ARG UID=10001
ARG GID=10001
RUN if ! getent group "${GID}" > /dev/null 2>&1; then \
      groupadd -g "${GID}" claude; \
    fi && \
    if ! getent passwd "${UID}" > /dev/null 2>&1; then \
      useradd -m -s /bin/bash -u "${UID}" -g "${GID}" -d /home/claude claude; \
    fi && \
    mkdir -p /home/claude /home/claude/workspace /home/claude/.config /home/claude/.cache /home/claude/.local/state && \
    chown -R "${UID}:${GID}" /home/claude
ENV HOME=/home/claude \
    XDG_CONFIG_HOME=/home/claude/.config \
    XDG_CACHE_HOME=/home/claude/.cache \
    XDG_STATE_HOME=/home/claude/.local/state
USER ${UID}
WORKDIR /home/claude/workspace

# デフォルトコマンド: 完全自律モードで Claude Code を起動
ENTRYPOINT ["claude", "--dangerously-skip-permissions"]
