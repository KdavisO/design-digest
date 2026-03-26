Figma MCP 経由でデザイン差分検出を実行する。

## 手順

1. **Figma ファイルキーを確認**: 環境変数 `FIGMA_FILE_KEY` またはユーザー指定のファイルキーを使用する

2. **Figma MCP でファイルデータを取得**: Figma MCP の `get_file` ツールを使ってファイルのノードツリーを取得する
   - `get_file` ツールに fileKey を渡して呼び出す
   - レスポンスの JSON 全体を一時ファイルに保存する

3. **一時ファイルに保存**: MCP レスポンスを `/tmp/design-digest-mcp-response.json` に書き出す

4. **差分検出スクリプトを実行**:
   ```bash
   tsx src/design-check.ts --input /tmp/design-digest-mcp-response.json --file-key <ファイルキー>
   ```

5. **結果を報告**: スクリプトの出力をユーザーに表示する

## 注意事項

- Figma MCP の OAuth 認証が必要（初回のみブラウザ認証）
- MCP レスポンスのデータ構造が REST API と異なる場合があるため、エラー時はレスポンスの構造を確認すること
- `DRY_RUN=true` で通知なしのテスト実行が可能
- スナップショットは `./snapshots/` に保存される（初回はベースライン作成のみ）
