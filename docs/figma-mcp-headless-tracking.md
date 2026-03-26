# Figma MCP ヘッドレス環境対応トラッキング

## 概要

Figma MCP サーバーのヘッドレス環境（CI/CD）対応状況を追跡し、DesignDigest への統合可能性を評価する。

関連 Issue: #62

## 現在のステータス

**判定: 採用見送り（2026-03-26 時点）**

Figma MCP サーバーはオープンベータ段階（2026年3月24日開始）であり、ヘッドレス環境での自動実行に必要な要件を満たしていない。

## 調査履歴

### 2026-03-26（PR #59 での調査）

- OAuth 認証フローがインタラクティブ（ブラウザ必須）
- Personal Access Token 非対応
- CI/CD パイプラインでの自動実行が想定されていない設計
- **判定**: REST API 最適化を採用（`fetchFileProactive` 等の実装）

### 2026-03-26（Issue #62 での再確認）

PR #59 時点の内容を、オープンベータ開始後に Issue #62 で再確認。**PR #59 からの仕様変更なし**。

#### 認証方式

| 方式 | 対応状況 |
|------|----------|
| OAuth 2.0（ブラウザベース） | 対応（唯一の方式） |
| Personal Access Token (PAT) | 非対応（REST API のみ） |
| サービスアカウント | OAuth 経由のみ（初回ブラウザ認証が必要） |
| API キー | 非対応 |

#### レートリミット（プラン別）

| プラン | 日次上限 | 分次上限 |
|--------|----------|----------|
| Enterprise | 600回/日 | 20回/分 |
| Pro / Org（Dev/Full シート） | 200回/日 | 10-15回/分 |
| Starter / View / Collab | 6回/月 | - |

#### 新機能

- **Write-to-Canvas**: AI エージェントから Figma キャンバスにデザインを書き込み可能（ベータ期間中は無料、将来は従量課金予定）
- **対応クライアント拡大**: Claude Code, VS Code, Cursor, Codex, Gemini CLI

#### コミュニティの動向

- PAT 認証対応はコミュニティフォーラムで最も要望の多い機能
- 参考: [Support for PAT in Figma Remote MCP](https://forum.figma.com/ask-the-community-7/support-for-pat-personal-access-token-based-auth-in-figma-remote-mcp-47465)
- 参考: [OAuth-less Access to Figma MCP Tools](https://forum.figma.com/ask-the-community-7/oauth-less-access-to-figma-mcp-tools-47774)

## 実行環境の評価

### 候補1: Claude Code + スケジュール/手動実行

OAuth 認証は初回のみインタラクティブに実施し、トークンを保持。

| 項目 | 評価 |
|------|------|
| 実現可能性 | **可能**（マシン起動中のみ） |
| 認証 | OAuth（初回ブラウザ認証 → トークン保持） |
| 定期実行 | `/schedule` または `/loop` で自動実行 |
| 手動実行 | スラッシュコマンド（例: `/design-check`）で即時実行 |
| 常時稼働 | 不要（マシンスリープ時は手動で補完） |
| 利点 | MCP 経由でリッチなデザインコンテキスト取得、Claude による直接分析 |
| 課題 | マシン依存、OAuth トークンの有効期限管理 |

**PoC 実施条件**: OAuth トークンの永続化が確認でき、スケジュール実行で安定動作する見込みがある場合

### 候補2: 常時稼働マシン（VPS/VM）

| 項目 | 評価 |
|------|------|
| 実現可能性 | **可能**（カスタム MCP クライアント実装が必要） |
| 認証 | OAuth トークン永続化 |
| 導入コスト | 中（MCP SDK でクライアント実装 + インフラ管理） |

### 候補3: GitHub Actions + サードパーティ MCP

| 項目 | 評価 |
|------|------|
| 実現可能性 | **可能**（ただし公式 MCP 機能は利用不可） |
| 認証 | PAT（REST API ラッパー） |
| 利点 | 既存のインフラをそのまま利用 |
| 課題 | REST API と本質的に同じ。`get_design_context` 等の MCP 独自機能が使えない |

### 推奨: 候補1（Claude Code ベース）を条件付きで検討

現行の GitHub Actions + REST API を維持しつつ、以下の条件が満たされた場合に Claude Code ベースの PoC を実施する:

1. OAuth トークンの永続化・自動リフレッシュが安定動作すること
2. MCP 経由で REST API と同等以上のノードツリーデータが取得可能なこと
3. レートリミットが DesignDigest の運用要件（1日数回の差分検出）を満たすこと

## PoC 判定基準

以下のいずれかが確認された場合、PoC を実施する:

### トリガー条件

1. **公式のヘッドレス対応**: PAT/サービスアカウント/API キーによる非インタラクティブ認証が追加
2. **Claude Code ベースの安定運用**: OAuth トークン永続化 + スケジュール実行の安定動作を確認
3. **MCP SDK の成熟**: TypeScript/Python MCP SDK でカスタムクライアントが容易に構築可能

### PoC での検証項目

- [ ] REST API と同等以上のノードツリーデータが取得可能か
- [ ] ペイロードサイズ制限が緩和/解消されているか
- [ ] 大規模ファイル（100+ ページ）での安定性
- [ ] レートリミット内での運用可能性
- [ ] 既存の差分検出ロジック（diff-engine）との統合

### PoC 後の判断

- **成功**: REST API との併用戦略を実装（通常サイズ: REST API、大規模ファイル: MCP）
- **失敗**: REST API 最適化の継続改善に注力

## アーキテクチャ（将来構想）

現行と MCP ベースのデータ取得は入り口が異なるだけで、アウトプット（通知・起票）は共通:

```
[入り口]                            [アウトプット]
GitHub Actions + REST API（現行）─┐
                                  ├→ 差分検出 → Slack通知 / GitHub Issue起票 / Backlog起票
Claude Code + Figma MCP（新規）──┘
```

## 次回確認時期

**2026年6月頃**を目安に再調査を実施する。以下を確認:

- Figma MCP のオープンベータからの GA（一般提供）移行状況
- ヘッドレス認証対応の公式アナウンス
- コミュニティフォーラムでの PAT 対応に関する Figma 公式回答
- MCP SDK の新バージョンリリース

## 参考リンク

- [Figma MCP Server - Developer Docs](https://developers.figma.com/docs/figma-mcp-server/)
- [Remote Server Installation](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)
- [Plans, Access, and Permissions](https://developers.figma.com/docs/figma-mcp-server/plans-access-and-permissions/)
- [Figma MCP Server Guide - GitHub](https://github.com/figma/mcp-server-guide)
- [Guide to the Figma MCP Server - Help Center](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)
- [Introducing Figma's Dev Mode MCP Server - Blog](https://www.figma.com/blog/introducing-figmas-dev-mode-mcp-server/)
- [Community: PAT Support Request](https://forum.figma.com/ask-the-community-7/support-for-pat-personal-access-token-based-auth-in-figma-remote-mcp-47465)
- [Community: OAuth-less Access Request](https://forum.figma.com/ask-the-community-7/oauth-less-access-to-figma-mcp-tools-47774)
