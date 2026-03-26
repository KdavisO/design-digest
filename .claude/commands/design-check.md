Figma MCP 経由でデザイン差分検出を実行する。

## 手順

1. **環境変数を読み込む**: まず `.env` ファイルから設定を読み込む
   ```bash
   set -a
   if [ -f .env ]; then
     . .env
   else
     echo "'.env' が見つかりません。FIGMA_FILE_KEY などの環境変数を手動で設定してください。" >&2
   fi
   set +a
   ```
   `FIGMA_FILE_KEY` が取得できない場合はユーザーにファイルキーを確認する

2. **Figma MCP でファイルデータを取得**: `figma-developer-mcp` の `get_file` ツールを使ってデータを取得する
   - `get_file` ツールに `file_key` パラメータを渡して呼び出す
   - `FIGMA_WATCH_NODE_IDS` が設定されている場合: `get_file_nodes` ツールで指定ノードIDを取得する
   - レスポンスの JSON 全体を一時ファイルに保存する

3. **一時ファイルに保存**: MCP レスポンスを `/tmp/design-digest-mcp-response.json` に書き出す

4. **差分検出スクリプトを実行**:
   ```bash
   tsx src/design-check.ts --input /tmp/design-digest-mcp-response.json --file-key <ファイルキー>
   ```

5. **結果を報告**: スクリプトの出力をユーザーに表示する

## 注意事項

- `.mcp.json` に `figma-developer-mcp` の設定が必要（Figma Personal Access Token を `FIGMA_API_KEY` 環境変数で指定）
- MCP レスポンスのデータ構造が REST API と異なる場合があるため、エラー時はレスポンスの構造を確認すること
- `DRY_RUN=true` で通知なしのテスト実行が可能
- スナップショットは `./snapshots/` に保存される（初回はベースライン作成のみ）
