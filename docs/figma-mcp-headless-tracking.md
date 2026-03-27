# Figma データ取得経路の整理

## 概要

DesignDigest における Figma データ取得経路の責務・制約・推奨利用シーンを整理する。

関連 Issue: #62, #73

## 3経路の比較

| 項目 | Figma REST API | figma-developer-mcp | Figma MCP（use_figma） |
|------|---------------|---------------------|----------------------|
| **コード** | `src/figma-client.ts` | `.mcp.json` で設定 | Claude Desktop/claude.ai 内蔵 |
| **アダプタ** | `FigmaRestAdapter` 経由 | `FigmaMcpAdapter` で正規化 | `FigmaMcpAdapter` で正規化 |
| **認証方式** | PAT（`FIGMA_TOKEN`） | PAT（環境変数 `FIGMA_TOKEN` を Claude Code が設定読み込み時に `.mcp.json` の `FIGMA_API_KEY` として展開） | OAuth 2.0（ブラウザ認証） |
| **ヘッドレス実行** | ✅ 可能 | ✅ 可能 | ❌ 不可（ブラウザ必須） |
| **利用環境** | GitHub Actions / CLI / どこでも | Claude Code CLI（`get_figma_data` MCP ツール） | Claude Desktop / claude.ai（本リポジトリの `/design-check` からは `use_figma` 未提供） |
| **データ形式** | Figma REST API レスポンス | REST API ラッパー（実質同一） | MCP 独自形式（正規化が必要） |
| **最適化** | プロアクティブチャンク分割、バージョン履歴チェック | なし（MCP が内部で処理） | なし（MCP が内部で処理） |
| **レートリミット** | Figma API 標準 | Figma API 標準（PAT 経由） | MCP 独自（プラン別、日次上限あり） |
| **独自機能** | バージョン履歴、編集者抽出 | — | Write-to-Canvas 等（将来） |

## 利用シーン別の推奨経路

### 1. GitHub Actions 定期実行（現行メイン）

**推奨: Figma REST API**

- `src/diff.ts` → `FigmaRestAdapter` → `src/figma-client.ts`
- PAT 認証でヘッドレス実行可能
- プロアクティブチャンク分割、バージョン履歴最適化済み
- REST API 経路は MCP サーバーが不要で、CI 環境だけで完結
- 他の経路は Claude/MCP クライアントが前提のため、GitHub Actions では運用対象外

### 2. Claude Code CLI での手動デザインチェック（`/design-check`）

**推奨: figma-developer-mcp**

- `/design-check` コマンド → `get_figma_data` MCP ツール → `FigmaMcpAdapter` → `src/design-check.ts`
- PAT 認証のため `.mcp.json` に設定するだけで利用可能
- Claude Code CLI で MCP ツールとして直接呼び出せる
- このリポジトリの `/design-check` コマンドでは `use_figma` ツールが提供されていないため、`get_figma_data` を使用する

### 3. Claude Desktop / claude.ai での利用

**推奨: Figma MCP（use_figma）**

- Anthropic 内蔵の `use_figma` ツールを使用
- OAuth 認証（初回ブラウザ認証）
- 主に Claude Desktop / claude.ai などの Anthropic クライアント環境で利用可能（実際の対応クライアントは Anthropic 側の提供状況に依存）
- Claude Desktop / claude.ai のチャットから `use_figma` ツールを直接呼び出してデザインチェックを実行（このリポジトリの `/design-check` コマンドとは別経路）

## アダプタの役割整理

### `FigmaRestAdapter`

- **責務**: Figma REST API を `FigmaDataAdapter` インターフェースでラップ
- **利用場面**: `src/diff.ts` のメインフロー（ページ取得・バージョン履歴チェック・編集者抽出）
- **内部実装**: `src/figma-client.ts` の `fetchFileProactive()` / `fetchNodesProactive()` に委譲
- **特徴**: プロアクティブチャンク分割、ペイロード超過時のフォールバック

### `FigmaMcpAdapter`

- **責務**: MCP ツール（`get_figma_data` / `use_figma`）のレスポンスを `FigmaDataAdapter` インターフェースに正規化
- **利用場面**: Claude Code CLI / Claude Desktop での手動デザインチェック（`src/design-check.ts`）
- **内部実装**: MCP レスポンス JSON をパースし、ノード構造の差異を吸収（`fromMcpResponse()`）
- **特徴**: フルファイル / ノード指定の両形式に対応、不正レスポンスのバリデーション

### 削除候補

現時点で削除候補となる経路はない。3経路はそれぞれ異なる利用シーンをカバーしている:
- REST API: 自動実行（CI/CD）
- figma-developer-mcp: CLI での手動チェック
- Figma MCP（use_figma）: Claude Desktop/claude.ai での利用

## 現在のステータス

**公式 Figma MCP サーバー（= Figma MCP（use_figma）のバックエンド）: 採用見送り（CI/CD 用途）（2026-03-26 時点）**

公式 Figma MCP サーバー（= Figma MCP（use_figma）のバックエンド）はオープンベータ段階（2026年3月24日開始）であり、ヘッドレス環境での自動実行に必要な要件を満たしていない。

## 調査履歴

### 2026-03-26

#### 初回調査（PR #59）

- OAuth 認証フローがインタラクティブ（ブラウザ必須）
- Personal Access Token 非対応
- CI/CD パイプラインでの自動実行が想定されていない設計
- **判定**: REST API 最適化を採用（`fetchFileProactive` 等の実装）

#### オープンベータ後の再確認（Issue #62）

PR #59 時点の内容を、オープンベータ開始（2026-03-24）後に再確認。**仕様変更なし**。

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
