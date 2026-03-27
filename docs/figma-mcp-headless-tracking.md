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

**figma-developer-mcp: 本採用（CLI 手動チェック用途）（2026-03-27 検証完了）**

figma-developer-mcp 経由の `/design-check` パイプラインは、コード検証・テストにより REST API と同等のデータ互換性が確認された。CLI での手動デザインチェック用途として本採用。

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

## PoC 検証結果（2026-03-27）

関連 Issue: #64, #69

### 検証対象

**figma-developer-mcp 経由の `/design-check` パイプライン**（PR #67 で実装済み）

検証方法: コード静的解析 + 単体テスト実行（182 テスト全パス）+ アーキテクチャレビュー

### 検証項目と結果

#### 1. MCP 経由で REST API と同等のノードツリーデータが取得可能か

**結果: ✅ 同等**

figma-developer-mcp は内部で Figma REST API をラップしており、PAT 認証を使用する。レスポンス構造は REST API と実質同一のため、データ品質に差異はない。`FigmaMcpAdapter` が `document.children`（フルファイル）と `nodes`（ノード指定）の両形式を正規化する（`src/adapters/figma-mcp-adapter.ts`）。

#### 2. 取得データを sanitizeNode() / detectChanges() にそのまま渡せるか

**結果: ✅ 互換性あり**

- `FigmaMcpAdapter.fromMcpResponse()` 内で `sanitizeNode()` を適用済み
- 出力型 `Record<string, FigmaNode>` は `detectChanges()` の入力型と一致
- `FigmaDataAdapter` インターフェースにより REST / MCP 両アダプタが同一シグネチャで動作
- 13 件の専用テスト（`figma-mcp-adapter.test.ts`）でノイズキー除去・フィルタリング・null ハンドリングを検証済み

#### 3. 大規模ファイル（100+ ページ）での安定性・レートリミット

**結果: ⚠️ 制限あり**

- `FigmaRestAdapter` にはプロアクティブチャンク分割（`fetchFileProactive` / `fetchNodesProactive`）とペイロード超過時のフォールバック（`fetchNodesChunked`）が実装されている
- `FigmaMcpAdapter` にはこれらの最適化がない。MCP ツール呼び出し1回で全データを取得するため、大規模ファイルではペイロード超過やタイムアウトのリスクがある
- レートリミットは figma-developer-mcp が REST API を内部利用するため、REST API と同一（Figma API 標準）

#### 4. OAuth トークンの有効期限と自動リフレッシュ

**結果: N/A（対象外）**

figma-developer-mcp は PAT 認証のため OAuth トークン管理は不要。Figma MCP（use_figma）の OAuth 認証は CI/CD 用途として既に見送り済み（2026-03-26 判定）。

#### 5. REST API との差分検出結果の一致性

**結果: ✅ 一致（figma-developer-mcp 経路）**

figma-developer-mcp は REST API ラッパーのため、同一ファイル・同一タイミングでの取得データは同一。両アダプタとも `sanitizeNode()` を適用し `Record<string, FigmaNode>` を出力するため、`detectChanges()` への入力は同一になる。

### 本採用 / 見送りの判断

**figma-developer-mcp: 本採用（CLI 手動チェック用途）**

| 経路 | 判断 | 用途 |
|------|------|------|
| Figma REST API | **継続（メイン）** | GitHub Actions 定期実行 |
| figma-developer-mcp | **本採用** | Claude Code CLI での `/design-check` |
| Figma MCP（use_figma） | **見送り維持** | OAuth 必須のためヘッドレス運用不可 |

### 併用戦略

| シーン | 経路 | 理由 |
|--------|------|------|
| GitHub Actions 定期実行 | REST API | プロアクティブチャンク分割、バージョン履歴最適化、MCP サーバー不要 |
| Claude Code CLI 手動チェック | figma-developer-mcp | MCP ツールとして直接呼び出し可能、PAT 認証で設定容易 |
| 大規模ファイル | REST API | チャンク分割・フォールバックが実装済み。MCP 経路は未対応 |

### 残課題

- figma-developer-mcp 経路での大規模ファイル対応（チャンク分割）は現時点で未実装。CLI 用途では対象ファイルを `FIGMA_WATCH_NODE_IDS` で絞ることで回避可能
- Figma MCP（use_figma）のヘッドレス対応は 2026年6月頃に再調査予定

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
