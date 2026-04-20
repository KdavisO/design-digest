# コマンドオーケストレーション全体フロー図

## 1. コマンド呼び出し関係の全体像

全コマンド/スキル/エージェント間の呼び出し関係を示す。

```mermaid
graph LR
    subgraph Commands
        IS["/issue-start"]
        IP["/issue-pr"]
        RR["/review-respond"]
        LP["/loop"]
        SN["/suggest-next"]
        PS["/parallel-suggest"]
        PT["/patrol"]
        IC["/issue-create"]
        CM["/commit"]
        RL["/release"]
        FS["/flow-status"]
        WC["/worktree-cleanup"]
        CA["/clear-all"]
    end

    subgraph Skills
        BD["/brainstorming"]
        WP["/writing-plans"]
        TDD["/test-driven-development"]
        SD["/systematic-debugging"]
        DR["/differential-review"]
        RCR["/requesting-code-review"]
        SO["/second-opinion"]
        SA["/static-analysis"]
        VBC["/verification-before-completion"]
    end

    subgraph Agents
        GA["gemini-analyzer"]
    end

    IS -->|"--auto"| IP
    IS -->|"--auto かつ --no-skills なし (大規模)"| BD
    IS -->|"--auto かつ --no-skills なし (中規模)"| WP
    IS -->|"--auto かつ --no-skills なし (バグ修正)"| SD
    IS -->|"--auto かつ --no-skills なし (大規模/セキュリティ)"| RCR
    IS -->|"完了後"| SN
    IS -->|"--continuous"| IS
    IS -->|"research mode"| IC
    IS -->|"research mode"| GA
    IP -->|"--auto"| LP
    LP -->|"polling"| RR
    RR -->|"scope-out"| IC
    RR -->|"CronCreate で再開"| LP
    PS -->|"各Issue"| IS
    PT -->|"検出Issue"| IC
    BD -->|"設計書"| WP
    WP -->|"実装計画"| TDD
    SD -->|"回帰テスト"| TDD
```

## 2. メインワークフロー: Issue から マージまで

`/issue-start --parallel --auto` で起動される一気通貫フロー。

```mermaid
flowchart TD
    Start(["Issue 着手"]) --> Parse["引数解析\nIssue取得・ラベル判定"]
    Parse -->|"research ラベル"| Research["調査モード"]
    Parse -->|"その他ラベル"| WT["worktree 作成\n依存インストール"]

    Research --> Investigate["コードベース調査\ngemini-analyzer 委譲"]
    Investigate --> CreateIssues["/issue-create で\nアクションItem起票"]
    CreateIssues --> CloseResearch["元Issue クローズ"]
    CloseResearch --> SuggestR["/suggest-next"]

    WT --> Analyze["実装前分析\nエッジケース・テスト特定"]
    Analyze --> SkillSelect{"スキル\n自動選択\n(--no-skills?)"}
    SkillSelect -->|"大規模"| BS["/brainstorming\n→ /writing-plans\n→ /test-driven-development"]
    SkillSelect -->|"中規模"| WPlan["/writing-plans\n→ /test-driven-development"]
    SkillSelect -->|"バグ修正"| Debug["/systematic-debugging\n→ /test-driven-development"]
    SkillSelect -->|"小規模 or\n--no-skills"| Implement["直接実装\nテスト・lint 実行"]
    BS --> SelfReview["セルフレビュー\nチェックリスト確認"]
    WPlan --> SelfReview
    Debug --> SelfReview
    Implement --> SelfReview
    SelfReview --> Commit["コミット\n粒度ガイドラインに従う"]
    Commit --> CodeReview{"/requesting-code-review\n(--no-skills なし かつ\n大規模 or セキュリティ?)"}
    CodeReview -->|"該当"| RCR["コードレビュー実施\nCritical修正・再レビュー確認"]
    CodeReview -->|"スキップ"| PR["/issue-pr --auto\nPR作成・Copilotレビュー依頼"]
    RCR --> ReCommit["修正をコミット"]
    ReCommit --> CodeReview
    PR --> Poll["/loop 4m --skip-first\n/review-respond --auto --max-idle 3 {PR番号}"]

    Poll --> Check{"未対応\nコメント?"}
    Check -->|"あり"| Fix["コード修正・コミット\nレビュー再依頼"]
    Fix --> Poll
    Check -->|"3回連続なし\n(未対応コメントなし)"| PostAction["ポストアクション"]

    PostAction --> Merge["PRマージ\nsquash merge"]
    Merge --> ScopeOut["スコープ外Issue候補\nユーザー承認後に起票"]
    ScopeOut --> Cleanup["worktree 削除"]
    Cleanup --> Summary["完了サマリー出力"]
    Summary --> Suggest["/suggest-next"]
    Suggest -->|"--continuous"| Start
    Suggest -->|"通常"| End(["終了"])
    SuggestR --> End
```

## 3. レビュー対応ポーリング詳細

`/review-respond --auto` の内部フローとファイルベース状態管理。

```mermaid
flowchart TD
    Trigger(["loop cron 発火"]) --> FetchReview["Copilot レビュー取得\ngh api"]
    FetchReview --> HasComments{"未対応\nコメント?"}

    HasComments -->|"なし"| IncrIdle["idle カウンタ +1\n/tmp/{project}-review-{ownerRepo}-idle-{PR番号}"]
    IncrIdle --> CheckIdle{"idle >= \nmax-idle?"}
    CheckIdle -->|"No"| WaitNext(["次回 polling 待ち"])
    CheckIdle -->|"Yes"| StopPoll["polling 停止\nCronDelete"]

    HasComments -->|"あり"| PausePoll["polling 一時停止\nCronDelete"]
    PausePoll --> ResetIdle["idle カウンタ = 0"]
    ResetIdle --> TeamCheck{"--team かつ\n5件以上?"}
    TeamCheck -->|"Yes"| AgentTeams["Agent Teams で\n観点別分担"]
    TeamCheck -->|"No"| Sequential["逐次対応"]
    AgentTeams --> FixCode["コード修正"]
    Sequential --> FixCode
    FixCode --> CommitFix["コミット・push"]
    CommitFix --> ReRequest["Copilot レビュー再依頼"]
    ReRequest --> ResumePoll["polling 再開\nCronCreate・cronタスクIDファイル更新\nidle カウンタ = 0"]
    ResumePoll --> WaitNext

    StopPoll --> StopReason{"停止理由"}
    StopReason -->|"未対応コメントなし"| PostAction["ポストアクション実行\nマージ・Issue起票・cleanup"]
    StopReason -->|"Copilotレビュー未着"| NoAction["ポストアクション\nスキップ"]
```

## 4. 並列実行パターン

### 4a. worktree による並列実行

> `/parallel-suggest` は `--no-skills` フラグを受け付ける。未指定時は各チームメイトが担当Issueの規模・性質に応じたスキル自動選択を独立実行する（`.claude/commands/issue-start.md` の「スキルオーケストレーション」セクションに従う）。セット提案のテーブルにはスキル見込み（`適用スキル（見込み）` 列）が表示される。`--no-skills` 指定時はスキル選択・実行およびPR作成前コードレビューを全チームメイトで一律スキップする。

```mermaid
flowchart TD
    PS["/parallel-suggest\n[--no-skills]"] --> Select["並列実行セットの選定\nスキル見込みをテーブルに表示"]
    Select --> SetA["セット提案\nIssue群を表示"]
    SetA --> UserSelect["ユーザーがセット選択"]

    UserSelect --> T1["チームメイト A\nworktree A"]
    UserSelect --> T2["チームメイト B\nworktree B"]
    UserSelect --> T3["チームメイト C\nworktree C"]

    T1 --> Skill1{"スキル自動選択\n(--no-skills 未指定時)"}
    T2 --> Skill2{"スキル自動選択\n(--no-skills 未指定時)"}
    T3 --> Skill3{"スキル自動選択\n(--no-skills 未指定時)"}

    Skill1 -->|"カテゴリ別スキル\nまたは直接実装"| Impl1["スキル実行・実装"]
    Skill2 -->|"カテゴリ別スキル\nまたは直接実装"| Impl2["スキル実行・実装"]
    Skill3 -->|"カテゴリ別スキル\nまたは直接実装"| Impl3["スキル実行・実装"]

    Impl1 --> PR1["PR #A"]
    Impl2 --> PR2["PR #B"]
    Impl3 --> PR3["PR #C"]

    PR1 --> Poll1["polling A"]
    PR2 --> Poll2["polling B"]
    PR3 --> Poll3["polling C"]
```

### 4b. Agent Teams による並列実行

```mermaid
flowchart TD
    Lead(["リード\nメインセッション"]) --> Create["チームメイト作成"]
    Create --> TM1["チームメイト 1\nセキュリティ"]
    Create --> TM2["チームメイト 2\nコード品質"]
    Create --> TM3["チームメイト 3\nテスト"]

    TM1 -->|"SendMessage"| TM2
    TM2 -->|"SendMessage"| TM1
    TM1 --> Result1["レビュー結果"]
    TM2 --> Result2["レビュー結果"]
    TM3 --> Result3["レビュー結果"]

    Result1 --> Lead
    Result2 --> Lead
    Result3 --> Lead
```

## 5. 連続自動実行フロー

`--continuous --max-issues N` によるIssue連続処理。

```mermaid
flowchart TD
    Start(["開始\n/issue-start ...\n--parallel --auto --continuous --max-issues N"]) --> Process["Issue #A を\nauto mode で処理"]
    Process --> Complete["完了サマリー"]
    Complete --> SuggestNext["/suggest-next\nexclude:A"]
    SuggestNext --> Decrement["残り = N - 1"]
    Decrement --> CheckRemain{"残り > 0?"}
    CheckRemain -->|"Yes"| HasCandidate{"候補\nあり?"}
    CheckRemain -->|"No"| Done(["上限到達\n終了"])
    HasCandidate -->|"Yes"| NextIssue["/issue-start #B\n--parallel --auto --continuous\n--max-issues N-1"]
    HasCandidate -->|"No"| NoCand(["候補なし\n終了"])
    NextIssue --> Process2["Issue #B を処理"]
    Process2 --> Complete2["...再帰的に繰り返し"]
```

## 6. スキルのワークフロー連携

設計からテスト駆動開発への接続と、品質保証スキルの適用タイミング。
`/issue-start --auto` のスキルオーケストレーションにより、Issue の規模・性質に応じて自動選択・実行される。

### 6a. スキル自動選択（`/issue-start --auto` 内、`--no-skills` 未指定時）

> `--no-skills` 指定時はこのフロー全体（スキル選択・実行および `/requesting-code-review`）がスキップされ、直接実装 → PR作成に進む。

```mermaid
flowchart TD
    Issue(["Issue 分析\n(--no-skills 未指定時)"]) --> Judge{"規模・性質\n判定"}
    Judge -->|"大規模・設計必要\n(複数モジュール・新パターン)"| Large["1. /brainstorming\n2. /writing-plans\n3. /test-driven-development"]
    Judge -->|"中規模・機能追加\n(単一モジュール・3-5ファイル)"| Medium["1. /writing-plans\n2. /test-driven-development"]
    Judge -->|"バグ修正\n(bug ラベル)"| BugFix["1. /systematic-debugging\n2. /test-driven-development"]
    Judge -->|"小規模・ドキュメント\n(1-2ファイル・設定変更)"| Small["スキルなし\n直接実装"]

    Large --> Review{"/requesting-code-review\n(大規模 or セキュリティ?)"}
    Medium --> Review
    BugFix --> Review
    Small --> Review
    Review -->|"該当"| RCR["コードレビュー実施\nCritical修正・再レビュー確認"]
    Review -->|"スキップ"| PR["PR作成へ"]
    RCR -->|"Critical解消"| PR
    RCR -->|"Critical残存"| Fix["修正\n(必要なら再コミット)"]
    Fix -->|"再度 /requesting-code-review"| RCR
```

### 6b. スキル間の連携（手動実行時も含む）

```mermaid
flowchart LR
    subgraph "設計フェーズ"
        BS["/brainstorming\n設計ブレスト"]
        WP["/writing-plans\n実装計画"]
    end

    subgraph "実装フェーズ"
        TDD["/test-driven-development\nRED→GREEN→REFACTOR"]
        DB["/systematic-debugging\n体系的デバッグ"]
    end

    subgraph "品質保証フェーズ"
        VBC["/verification-before-completion\n完了前検証"]
        RCR["/requesting-code-review\nコードレビュー依頼"]
        DR["/differential-review\n差分レビュー"]
        SO["/second-opinion\nマルチLLMレビュー"]
        SA["/static-analysis\n静的解析"]
    end

    BS -->|"docs/specs/ 設計書"| WP
    WP -->|"タスク分解"| TDD
    DB -->|"回帰テスト作成"| TDD
    TDD --> VBC
    VBC --> RCR
    RCR --> DR
    SO -->|"意見が割れ追加検証が必要"| DR
    SA -->|"要調査時"| DR
```

## 7. 状態管理: ファイルベースの協調

各コマンドが使用する一時ファイルとその役割。

```mermaid
graph TD
    subgraph "ステータスファイル"
        SF["/tmp/{project}-flow-{ownerRepo}-{issue番号}\nフロー進捗管理"]
    end

    subgraph "ポーリング管理"
        CF["/tmp/{project}-review-{ownerRepo}-cron-{PR番号}\nCron タスクID"]
        IF["/tmp/{project}-review-{ownerRepo}-idle-{PR番号}\nidle カウンタ"]
        DF["/tmp/{project}-review-{ownerRepo}-deferred-{PR番号}\nスコープ外Issue候補"]
    end

    IS["/issue-start --parallel --auto"] -->|"作成・更新"| SF
    FS["/flow-status"] -->|"参照"| SF
    RR["/review-respond"] -->|"更新"| SF

    IP["/issue-pr --auto"] -->|"作成"| CF
    RR -->|"参照・更新"| CF
    CA["/clear-all"] -->|"参照"| CF

    RR -->|"増減"| IF
    RR -->|"蓄積"| DF
    RR -->|"ポストアクション時参照"| DF
```

## コマンド一覧と用途

| コマンド | 用途 | 主な呼び出し元 |
|---------|------|--------------|
| `/issue-start` | Issue着手（worktree作成・スキルオーケストレーション・実装・PR作成）。`--no-skills` でスキル適用スキップ | `/parallel-suggest`, 手動 |
| `/issue-pr` | PR作成・Copilotレビュー依頼 | `/issue-start --parallel --auto` |
| `/review-respond` | Copilotレビューへの自動対応 | `/loop` (polling) |
| `/loop` | 定期実行スケジューラ | `/issue-pr --auto` |
| `/suggest-next` | 次Issue候補の提案 | `/issue-start` (完了後) |
| `/parallel-suggest` | 並列実行可能なIssueセット提案 | 手動 |
| `/patrol` | プロジェクト巡回・Issue自動提案 | 手動 |
| `/issue-create` | GitHub Issue作成 | `/issue-start`, `/review-respond`, `/patrol` |
| `/commit` | 手動コミット | 手動 |
| `/release` | リリース実行 | 手動 |
| `/flow-status` | 自動フロー進捗表示 | 手動 |
| `/worktree-cleanup` | マージ済みworktree削除 | 手動 |
| `/clear-all` | バックグラウンドタスクのクリーンアップ | 手動 |

| スキル | 用途 | 連携先 |
|-------|------|--------|
| `/brainstorming` | 設計ブレスト | `/writing-plans` |
| `/writing-plans` | 実装計画作成 | `/test-driven-development` |
| `/test-driven-development` | TDDワークフロー | 実装タスク全般 |
| `/systematic-debugging` | 体系的デバッグ | `/test-driven-development` |
| `/differential-review` | PR差分セキュリティレビュー | 手動（セキュリティ変更時） |
| `/requesting-code-review` | サブエージェントコードレビュー | PR作成前 |
| `/second-opinion` | マルチLLMレビュー | セキュリティクリティカルな変更 |
| `/static-analysis` | 静的セキュリティ解析 | CI連携 |
| `/verification-before-completion` | 完了前検証 | 完了宣言前 |

| エージェント | 用途 | 呼び出し元 |
|-------------|------|-----------|
| `gemini-analyzer` | 大規模コードベース解析・Web調査 | `/issue-start` (research / web delegation) |
