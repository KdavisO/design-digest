Figma MCP 経由でデザイン差分検出を実行する。

## 手順

1. **環境変数を読み込む**: Bash ツールで `.env` ファイルを読み込み、必要な値を取得する
   ```bash
   [ -f .env ] && set -a && . .env && set +a; if [ -z "${FIGMA_FILE_KEY:-}" ]; then echo "ERROR: FIGMA_FILE_KEY が未設定です。.env を確認するか環境変数を手動で設定してください。" >&2; exit 1; fi && echo "FIGMA_FILE_KEY=$FIGMA_FILE_KEY" && echo "FIGMA_WATCH_NODE_IDS=${FIGMA_WATCH_NODE_IDS:-}"
   ```
   - このコマンドの出力から `FIGMA_FILE_KEY` と `FIGMA_WATCH_NODE_IDS` の値を記憶する
   - `.env` が存在しない場合は環境変数をそのまま利用する（`.env` は必須ではない）
   - `FIGMA_FILE_KEY` が複数キー（カンマ区切り）の場合は、最初のキーを使用するか、ユーザーにどのキーを使うか確認する

2. **Figma MCP でファイルデータを取得**: 利用可能な Figma MCP ツールでデータを取得する
   - `use_figma`（Anthropic 内蔵）または `get_figma_data`（figma-developer-mcp）のいずれかを使用
   - 手順1で取得した `FIGMA_FILE_KEY` を fileKey として指定し、ファイルのノードツリーを取得する
   - `FIGMA_WATCH_NODE_IDS` が設定されている場合: 指定ノードIDを対象に取得する
   - MCP ツールのレスポンス JSON 全体を Write ツールで `/tmp/design-digest-mcp-response.json` に書き出す

3. **差分検出スクリプトを実行**: `design-check.ts` は内部で `dotenv/config` を使い `.env` を自動読み込みするため、追加の env 読み込みは不要
   ```bash
   tsx src/design-check.ts --input /tmp/design-digest-mcp-response.json --file-key <手順1で選択した単一のFIGMA_FILE_KEY>
   ```

4. **結果を報告**: スクリプトの出力をユーザーに表示する

## 注意事項

- Figma MCP ツールが必要:
  - `use_figma`（Claude Desktop/claude.ai 内蔵）を利用する場合は追加設定不要
  - `figma-developer-mcp` を使う場合は `.mcp.json` に設定を追加:
    ```json
    {
      "mcpServers": {
        "figma-developer-mcp": {
          "command": "npx",
          "args": ["-y", "figma-developer-mcp", "--stdio"],
          "env": { "FIGMA_API_KEY": "<your-figma-personal-access-token>" }
        }
      }
    }
    ```
- MCP レスポンスのデータ構造が REST API と異なる場合があるため、エラー時はレスポンスの構造を確認すること
- `DRY_RUN=true` で通知なしのテスト実行が可能
- スナップショットは `./snapshots/` に保存される（初回はベースライン作成のみ）
