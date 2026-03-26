Figma MCP 経由でデザイン差分検出を実行する。

## 手順

1. **環境変数を読み込む**: `.env` ファイルから設定を読み込む（存在しない場合は現在の環境変数をそのまま利用）
   ```bash
   set -a
   if [ -f .env ]; then
     . .env || { echo "'.env' の読み込みに失敗しました（構文エラー等）。内容を確認してください。" >&2; exit 1; }
   fi
   set +a

   if [ -z "${FIGMA_FILE_KEY:-}" ]; then
     echo "FIGMA_FILE_KEY が設定されていません。.env に記載するか、環境変数として設定してください。" >&2
     exit 1
   fi
   ```

2. **Figma MCP でファイルデータを取得**: 利用可能な Figma MCP ツールでデータを取得する
   - `use_figma`（Anthropic 内蔵）または `get_figma_data`（figma-developer-mcp）のいずれかを使用
   - fileKey を指定してファイルのノードツリーを取得する
   - `FIGMA_WATCH_NODE_IDS` が設定されている場合: 指定ノードIDを対象に取得する
   - レスポンスの JSON 全体を一時ファイルに保存する

3. **一時ファイルに保存**: MCP レスポンスを `/tmp/design-digest-mcp-response.json` に書き出す

4. **差分検出スクリプトを実行**:
   ```bash
   tsx src/design-check.ts --input /tmp/design-digest-mcp-response.json --file-key <ファイルキー>
   ```

5. **結果を報告**: スクリプトの出力をユーザーに表示する

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
