# デザイナーのワークフローを変えずに、開発者の「気づけない」を解消する — DesignDigest の紹介

## デザインが変わっていたことに、気づけない

Figma を使ったチーム開発では、こんな経験をしたことがあるかもしれない。

プルリクエストのレビュー中に「あれ、デザイン変わってない？」と指摘される。確認すると、確かに Figma 上のデザインが更新されていた。しかし自分はその変更に気づいていなかった——いつ変わったのかもわからない。

デザイナーは日々デザインを磨いている。ミーティング中にフレームを調整したり、スペーシングを微調整したり、バリアントを追加したりする。それ自体は自然なワークフローだ。問題は、それらの変更が開発者に伝わるまでのギャップにある。

### 既存の手段では解決しきれない

Figma にも変更を把握するための機能はある。

- **Dev Mode の Compare changes**: フレームごとに手動で確認する必要がある。通知はない
- **Ready for Dev**: デザイナーがボタンを押す運用だが、忘れることがある
- **バージョン履歴**: 変更があったことはわかるが、何がどう変わったかをプロパティレベルで把握するには一つずつ見る必要がある

結局、「自分から見に行かなければ気づけない」という構造が問題の根本にある。

## DesignDigest を作ったモチベーション

DesignDigest は、この「気づけない」問題を自動化で解決するツールだ。GitHub Actions の cron で1日1回 Figma ファイルをチェックし、前回との差分を検出して Slack に通知する。

設計にあたって、いくつかの方針を決めた。

### デザイナー側に何も求めない

最も重視したのは、**デザイナーのワークフローを一切変えない**ことだ。

「変更したらここに記録してください」「このラベルを付けてください」といった運用ルールを追加すると、どうしても抜け漏れが生じる。そもそもデザイナーにとっての「変更」は、開発者が気にする粒度と必ずしも一致しない。ボタンの色を `#333` から `#222` に変えることは、デザイナーにとっては微調整だが、開発者にとってはスタイルの更新が必要な変更だ。

DesignDigest は「通知を受け取る側だけが設定すればよい」という思想で作っている。デザイナーは普段通り Figma で作業するだけでよい。

### Webhook ではなくポーリング

Figma は Webhook V2 を提供しているが、DesignDigest ではあえて定時ポーリングを採用した。理由は主に二つある。

1. **インフラの簡素化**: Webhook を受けるにはサーバーが必要になる。GitHub Actions の cron なら追加のインフラなしで動く
2. **OSS としての配布容易性**: `git clone` して環境変数を設定するだけで使い始められる。Webhook のエンドポイント設定やトンネリングは不要

1日1回のチェックで十分なユースケースがほとんどだと考えた。リアルタイム性が必要な場面は少なく、「朝出社したら昨日の変更がまとまっている」くらいがちょうどいい。

## 実装の工夫

### ノイズとの戦い — sanitizeNode()

Figma REST API が返す JSON には、変更を検出する上で邪魔になるプロパティがいくつかある。

```typescript
const NOISE_KEYS = new Set([
  "absoluteBoundingBox",
  "absoluteRenderBounds",
  "transitionNodeID",
  "prototypeDevice",
  "flowStartingPoints",
  "pluginData",
  "sharedPluginData",
  "exportSettings",
  "reactions",
  "prototypeStartNodeID",
  "scrollBehavior",
]);
```

`absoluteBoundingBox` や `absoluteRenderBounds` は、ノードの絶対座標を表す。親フレームを移動しただけで、子ノードすべてのこの値が変わる。意味のある変更ではないのに、大量の差分としてレポートに現れてしまう。

`sanitizeNode()` はこれらのノイズキーを再帰的に除去してからスナップショットを保存する。これにより、`deep-diff` での比較結果がデザイン上意味のある変更だけに絞られる。

```typescript
export function sanitizeNode<T>(node: T): T {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(sanitizeNode) as T;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (NOISE_KEYS.has(key)) continue;
    result[key] = sanitizeNode(value);
  }
  return result as T;
}
```

### 外部ストレージ不要のスナップショット管理

比較のためには前回のスナップショットを保存する必要がある。データベースや S3 を使う方法もあるが、DesignDigest では **GitHub Actions artifact** を活用している。

```yaml
- name: Download previous snapshot
  uses: actions/download-artifact@v4
  with:
    name: design-digest-snapshot
    path: snapshots
  continue-on-error: true   # 初回は artifact がないので無視

- name: Upload snapshot
  uses: actions/upload-artifact@v4
  with:
    name: design-digest-snapshot
    path: snapshots/
    retention-days: 90
    overwrite: true
```

仕組みはシンプルだ。ワークフローの最初に前回の artifact をダウンロードし、差分検出後に最新のスナップショットをアップロードする。`continue-on-error: true` により、初回実行時（artifact がまだ存在しない場合）はベースラインの保存だけを行い、次回以降の比較に備える。

外部サービスのセットアップが不要なので、OSS として配布する上で大きな利点になっている。

### 通知ノイズの集約

Figma のコンポーネントを一括更新すると、一つのノードに対して大量のプロパティ変更が発生することがある。塗り、線、角丸、パディング、フォントサイズ……すべて個別に通知すると、レポートが読めなくなる。

DesignDigest では、同一ノードに対する変更が5件を超えた場合、個別の変更をリストする代わりに「○件の変更」として集約する。

```typescript
if (nodeChanges.length > 5) {
  const link = slackNodeLink(fileKey, first.nodeId, first.nodeName);
  lines.push(
    `📦 ${link} (${first.nodeType}): ${nodeChanges.length} changes`,
  );
  continue;
}
```

ノードへのリンクは付与するので、詳細を確認したい場合は Figma 上で直接確認できる。

### AI によるサマリー生成

オプション機能として、Claude API を使った AI サマリーを用意している。検出された変更を分析し、フロントエンドエンジニア向けに「何が変わったか」「実装への影響は何か」「優先度はどの程度か」をまとめてくれる。

```typescript
const message = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: `You are a design-to-engineering change analyst.
Summarize the following Figma design changes for frontend engineers.
Focus on implementation impact.
...`,
    },
  ],
});
```

たとえば「ヘッダーのフォントサイズが24→28に変更された」という差分に対して、「ヘッダーコンポーネントの `font-size` を更新する必要がある。レスポンシブ対応への影響を確認すること」のような実装指針を生成する。

月額のAPI コストは軽い利用なら $0.01〜0.03 程度で、ほぼ無視できる水準だ。

### Block Kit による Slack 通知

Slack への通知には Block Kit を活用し、ページ単位でグルーピングした見やすいレポートを生成している。各変更にはノードへの直リンクを付与し、Slack 上からワンクリックで Figma の該当箇所に飛べる。

変更がない場合も「変更なし」の通知を送る。これにより「通知が来ないのは変更がないからか、ツールが壊れているからか」の不安を解消している。

## 今後の展望

DesignDigest はまだ初期段階にあり、いくつかの方向性を検討している。

- **AIサマリーのページ単位生成**: 現在はファイル全体で一つのサマリーだが、ページ単位でより細かい分析を生成する
- **Issue 起票の粒度改善**: 変更をノード単位で分割し、より追跡しやすい Issue を自動作成する
- **他のデザインツール対応**: Penpot など、Figma 以外のオープンソースデザインツールへの対応
- **デザイントークン同期**: Figma Variables API を活用したデザイントークンの自動同期
- **VRT（Visual Regression Testing）**: プロパティ差分だけでなく、画像ベースの視覚的な回帰テスト
- **Discord / Microsoft Teams 対応**: Slack 以外の通知チャネルへの対応

## おわりに

DesignDigest は「デザイナーに何かを求めるのではなく、開発者側の仕組みで解決する」というアプローチを取っている。Figma のファイルを毎日静かにチェックし、変更があれば知らせる。ただそれだけのツールだ。

しかし「気づけなかった変更」が一つでも事前にキャッチできれば、手戻りの時間と認識齟齬のコストを減らせる。

リポジトリは MIT ライセンスで公開している。GitHub Actions と環境変数の設定だけで使い始められるので、興味があれば試してみてほしい。

→ [GitHub: DesignDigest](https://github.com/KdavisO/design-digest)
