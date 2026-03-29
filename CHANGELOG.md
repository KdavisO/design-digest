# Changelog

## [v0.1.0](https://github.com/KdavisO/design-digest/releases/tag/v0.1.0) (2026-03-29)

### Features
- implement core Figma diff detection and Slack notification
- improve diff-engine precision (#1)
- support multiple Figma files (#2)
- Slack Block Kit rich notifications (#9)
- add Figma node deep links to change reports (#11)
- 変更レポートにファイル編集者の情報を追加 (#17)
- テンプレートリポジトリからの自動同期を導入 (#21)
- 変更検出時の Backlog 課題自動作成 (#24)
- 変更検出時の GitHub Issue 自動作成 (#25)
- 大規模Figmaファイルの変更検知: ハイブリッド方式の導入 (#29)
- 変更なし時のSlack通知 (#32)
- エラー発生時のSlack通知 (#33)
- Slack通知のアイコンカスタマイズに対応 (#35)
- 変更なし時のSlack通知を簡潔なBlock Kit形式に変更 (#40)
- 変更集計をページ単位で表示する (#45)
- AIサマリーをページ単位で生成する (#49)
- Issue起票の粒度をノード単位に変更する (#54)
- 大きすぎるFigmaファイルの取得方法を改善する (#59)
- generatePageSummariesに並列数制限を追加 (#61)
- FigmaDataAdapterインターフェースにfetchNodes()等の追加メソッドを実装 (#83)
- FigmaMcpAdapterに大規模ファイル向けチャンク分割を追加 (#84)
- 初回実行（ベースライン作成）時にもSlack通知を送信する (#90)
- Slack通知にFigmaファイル名を表示する (#93)
- findExistingIssue にページネーション対応を追加 (#110)
- fetchFileProactive の大規模ファイル向けメモリ効率化 (#120)
- Figma APIレスポンスのZodスキーマ検証を導入 (#122)
- fetchFileProactiveIter の small pages バッチ処理化 (#125)

### Bug Fixes
- AI要約のMarkdownをSlack mrkdwn形式に変換 (#16)
- template-syncワークフローのsecretsチェック・権限・トークン設定を修正 (#22)
- download-artifact@v4にrun-idを指定してクロスラン動作を修正 (#58)
- findExistingIssueのcount上限を100に引き上げ、上限到達時に警告ログを出力 (#60)
- isPayloadTooLargeErrorでERR_STRING_TOO_LONGをキャッチ対象に追加 (#88)
- .mcp.json.example 追加（環境変数参照テンプレート） (#112)

### Refactoring
- Figma API / figma-developer-mcp / Figma MCP の責務整理 (#74)
- diff.tsをFigmaRestAdapter経由に統一 (#76)
- github-issue-client.ts の unknown 型を具体的な型に置換 (#115)
- adapter 間の共通サニタイズ処理を統一 (#116)
- sanitizeNode 内部のプロトタイプ汚染防止（Object.create(null) 適用） (#118)

### Documentation
- README に Claude API の利用コスト目安を記載 (#18)
- DesignDigestの紹介記事を執筆する (#48)
- ページ単位AIサマリーのコスト・レイテンシ特性をREADMEに反映 (#56)
- Figma MCP PoC 検証結果と本採用判断を追記 (#79)
- .env.example にプロジェクトで使用する環境変数を網羅 (#86)
- project-structure.md にプロジェクト情報を記載 (#111)
- figma-diff.yml に不足環境変数を追加 (#113)
- .claude/CLAUDE.md にプロジェクト情報を記載 (#114)

### Other Changes
- SLACK_ICON_URL / SLACK_ICON_EMOJI を config.ts に追加し Slack 通知に反映 (#123)
- README の AI サマリー並列実行の記述を実装に合わせて修正 (#124)
- Claude Code + Figma MCP で差分検出の PoC を実装 (#67)
- design-checkコマンドをfigma-developer-mcp対応に修正 (#70)
- generateGitHubIssueTitleのユニットテスト追加 (#46)
