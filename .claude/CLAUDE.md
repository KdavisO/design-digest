# {{PROJECT_NAME}} - プロジェクト指示

## プロジェクト概要

<!-- このプロジェクトが何をするものか、1〜3文で記載する -->
<!-- 例: 「子ども向け学習アプリのバックエンドAPI。保護者が子どものプロフィールを管理し、学習進捗を追跡する」 -->

## 開発コマンド

<!-- プロジェクトで頻繁に使用するコマンドを記載する（Claude が自律的に実行するために必要） -->
<!-- 例:
```bash
pnpm install          # 依存関係インストール
pnpm dev              # 開発サーバー起動
pnpm build            # プロダクションビルド
pnpm test             # テスト実行
pnpm lint             # lint 実行
pnpm db:migrate       # DBマイグレーション実行
pnpm db:seed          # シードデータ投入
```
-->

## アーキテクチャ概要

<!-- ディレクトリ構成と各ディレクトリの役割を記載する -->
<!-- 例:
```
src/
  app/          # Next.js App Router（ページ・レイアウト・APIルート）
  components/   # UIコンポーネント（Atomic Design: atoms/molecules/organisms）
  lib/          # ビジネスロジック・ユーティリティ
  types/        # TypeScript 型定義
  hooks/        # カスタムフック
supabase/
  migrations/   # DBマイグレーション（タイムスタンプ付き）
  seed.sql      # シードデータ
docs/
  specs/        # 機能仕様書
```
-->

### 技術スタック

<!-- 使用する技術スタックを記載する -->
<!-- 例:
- Next.js 15 (App Router) — フロントエンド + API
- Supabase — 認証・データベース（PostgreSQL）・RLS
- Tailwind CSS v4 — スタイリング
- pnpm — パッケージ管理
- ESLint + Prettier — コード品質
- Vitest — テスト
-->

## 主要ルール

### コード規約

<!-- プロジェクト固有のコード規約を記載する。具体的な数値や NG/OK 例を含めると Claude の遵守率が向上する -->
<!-- 例:
- 関数は 50 行以内に収める。超える場合は責務を分割する
- ネストは最大 3 段階まで。早期リターンで深いネストを回避する
- `any` 型は禁止。やむを得ない場合は `// eslint-disable-next-line @typescript-eslint/no-explicit-any` + 理由コメント
-->

### 型安全性

<!-- TypeScript を使用する場合の型安全性ルールを NG/OK 例付きで記載する -->
<!-- 例:
```typescript
// NG: any を使用
function fetchData(id: any): any { /* ... */ }

// OK: 具体的な型を指定
function fetchData(id: string): Promise<User> { /* ... */ }

// NG: 型アサーション（as）の乱用
const user = data as User;

// OK: 型ガードで安全に絞り込む
function isUser(data: unknown): data is User {
  return typeof data === 'object' && data !== null && 'id' in data;
}
```
-->

### エラーハンドリング

<!-- すべきこと / すべきでないこと のセット記述 -->

**すべきこと:**
- 外部API・DB操作・ファイルI/Oは必ず失敗ケースを処理する
- エラーメッセージには「何が失敗したか」と、診断に必要な範囲の安全にマスキング/要約した識別子（例: userId）を含める
- ユーザー向けメッセージと開発者向けログを分離し、トークン・メールアドレス・住所などの機密値/PIIはログや例外メッセージにそのまま含めず必ず伏せる

**すべきでないこと:**
- エラーを握りつぶさない（`catch (e) { /* 何もしない */ }` は禁止）
- 曖昧なエラーメッセージを使わない（`'エラーが発生しました'` ではなく原因を特定できる情報を含める）
- 機密値（パスワード、トークン、PII）をエラーメッセージやログにそのまま含めない

<!-- 例:
```typescript
// すべきこと: 安全な識別子を含める
throw new AppError(`ユーザー取得に失敗 (userId: ${userId})`, { cause: e });

// すべきでないこと: 曖昧なエラーメッセージ
throw new Error('エラーが発生しました');

// すべきでないこと: 機密値をそのまま含める
throw new Error(`認証失敗 (token: ${token}, email: ${email})`);

// すべきでないこと: エラーを握りつぶす
try { /* ... */ } catch (e) { /* 何もしない */ }
```
-->

### セキュリティ

<!-- OWASP Top 10 に基づくチェック項目を記載する -->
<!-- 例:
- **インジェクション防止**: ユーザー入力は必ずサニタイズ。SQLはパラメータ化クエリ、HTMLはエスケープ
- **認証・セッション管理**: JWTの有効期限は短く設定（アクセストークン: 15分、リフレッシュトークン: 7日）
- **機密データ保護**: APIキー・パスワードはコード中にハードコードしない。環境変数経由で注入
- **アクセス制御**: RLS（Row Level Security）を全テーブルに適用。サーバーサイドで権限チェック
- **CSRF対策**: フォーム送信にCSRFトークンを含める
-->

### エッジケースの考慮

- 配列操作: 空配列、単一要素、重複要素を想定する
- 文字列操作: 空文字列、マルチバイト文字、前後の空白を想定する
- 数値操作: 0、負数、小数、`NaN`、`Infinity` を想定する
- オブジェクト参照: null/undefined の可能性があるプロパティはオプショナルチェーン等で防御する

### テスト設計

- 正常系 + 異常系（不正入力、タイムアウト、権限エラー）+ 境界値を網羅する
- モックは実装の内部構造ではなく、外部インターフェースの振る舞いに基づいて設計する

### コミット

- コミットメッセージは日本語で記述可
- 機能単位で細かくコミット

### 仕様書

- 機能仕様は `docs/specs/` に配置する
- 実装時は対応する仕様書を必ず参照すること（例: `docs/specs/jwt-auth.md` の仕様通りに実装する）
- 仕様書テンプレート: `docs/specs/_template.md`

### 重要なファイル

<!-- プロジェクトの重要なファイルパスを記載する -->
<!-- 例:
- `src/lib/auth.ts` — 認証ロジック
- `src/lib/db.ts` — DB接続・クエリビルダー
- `supabase/migrations/` — DBスキーマ定義
- `.env.local` — ローカル環境変数（Git管理外）
-->

### 環境変数

<!-- 必要な環境変数を記載する -->
<!-- 例:
```
NEXT_PUBLIC_SUPABASE_URL=        # Supabase プロジェクトURL
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # Supabase 匿名キー
SUPABASE_SERVICE_ROLE_KEY=       # Supabase サービスロールキー（サーバーサイドのみ）
DATABASE_URL=                    # PostgreSQL 接続文字列
```
-->
