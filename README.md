# DesignDigest

**Automated Figma design change detection with Slack notifications.**

DesignDigest monitors your Figma files on a daily schedule and sends a structured change report to Slack — so frontend engineers never miss a design update.

## The Problem

Designers iterate quickly — updating frames in meetings, copying variants, tweaking spacing. Frontend engineers find out about these changes too late:

- **Figma Dev Mode Compare changes** requires manually checking each frame. No notifications.
- **Ready for Dev** workflows rely on designers remembering to click a button. They forget.
- **Existing tools** (Figma History, DiffView, etc.) are all manual-trigger, no automation.

DesignDigest fills this gap: **automatic, daily, property-level change detection with external notifications** — zero designer workflow changes required.

## How It Works

```
GitHub Actions (cron: weekdays 10:00 JST)
  │
  ├─ Figma REST API → fetch file JSON
  ├─ Compare with previous snapshot (deep-diff)
  ├─ Claude API → AI summary (optional)
  ├─ Slack Webhook → structured change report
  ├─ GitHub API → issue auto-creation (optional)
  └─ Backlog API → issue auto-creation (optional)
```

Snapshots are stored as GitHub Actions artifacts. No external infra needed.

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/design-digest.git
cd design-digest
npm install
```

### 2. Get a Figma token

1. Go to **Figma → Settings → Personal Access Tokens**
2. Create a token with `file_content:read` and `file_version:read` scopes

> **Note:** The `file_version:read` scope is required to show who edited each file in the change report. If your existing token lacks this scope, regenerate it with both scopes enabled.

### 3. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```
FIGMA_TOKEN=your-figma-token
FIGMA_FILE_KEY=your-file-key
```

The file key is the part of your Figma URL: `figma.com/design/FILE_KEY/...`

### 4. Run a dry run

```bash
# First run saves a baseline snapshot
npm run diff:dry-run

# Second run detects changes
npm run diff:dry-run
```

### 5. Set up GitHub Actions

Add these secrets to your repository (**Settings → Secrets and variables → Actions**):

| Secret | Required | Description |
|---|---|---|
| `FIGMA_TOKEN` | Yes | Figma Personal Access Token |
| `FIGMA_FILE_KEY` | Yes | Figma file key(s) to monitor (comma-separated for multiple) |
| `SLACK_WEBHOOK_URL` | No | Slack Incoming Webhook URL |
| `ANTHROPIC_API_KEY` | No | Claude API key for AI summaries |

Optional variables (**Settings → Secrets and variables → Actions → Variables**):

| Variable | Default | Description |
|---|---|---|
| `FIGMA_WATCH_PAGES` | (all pages) | Comma-separated page names to watch |
| `FIGMA_WATCH_NODE_IDS` | (none) | Comma-separated node IDs (reduces API cost) |
| `FIGMA_NODE_DEPTH` | (unlimited) | Limit Figma API response depth (e.g., `3`) |
| `CLAUDE_SUMMARY_ENABLED` | `false` | Set to `true` to enable AI summaries |

The workflow runs automatically on weekdays at 10:00 JST. You can also trigger it manually from the Actions tab.

## Configuration

### Monitor multiple files

```
FIGMA_FILE_KEY=abc123,def456,ghi789
```

Each file gets its own snapshot and appears as a separate section in the report.

### Watch specific pages

```
FIGMA_WATCH_PAGES=Home,Settings,Components
```

### Watch specific nodes (reduces API calls)

```
FIGMA_WATCH_NODE_IDS=1:2,3:4,5:6
```

Find node IDs in Figma: right-click a frame → **Copy/Paste as** → **Copy link**, then extract the `node-id` parameter.

### Large files

For large Figma files that exceed API payload limits, DesignDigest automatically:

1. **Version check first** — skips snapshot comparison entirely if the file hasn't changed (1 API call)
2. **Chunked fetch** — if a normal fetch fails due to size, automatically splits into per-child-node requests
3. **Depth limiting** — set `FIGMA_NODE_DEPTH` to limit how deep the node tree is fetched

```
FIGMA_NODE_DEPTH=3
```

This is useful when monitoring large pages/frames. The trade-off is that changes deeper than the specified depth won't be detected.

### Enable AI summaries

Set `ANTHROPIC_API_KEY` and `CLAUDE_SUMMARY_ENABLED=true`. The AI will summarize changes with implementation impact analysis for frontend engineers.

#### Per-page summary generation

AI summaries are generated **per page** — each Figma page with changes triggers a separate Claude API call. This means:

- **API calls per run** = number of pages with changes (across all monitored files)
- **Fault isolation** — if one page's summary fails, other pages still get their summaries
- **Parallel execution** — all page summaries are requested concurrently via `Promise.allSettled`

#### Claude API cost estimate

DesignDigest uses **Claude Sonnet 4** (`claude-sonnet-4-20250514`) to generate change summaries. Each page with changes triggers one API call, so the total number of calls per run depends on how many pages have changes.

| Scenario | API calls | Input tokens (per call) | Output tokens (per call) |
|---|---|---|---|
| 1 file, 2 pages changed | 2 | ~150–500 | ~200–400 |
| 3 files, 5 pages changed total | 5 | ~150–500 | ~200–400 |

**Monthly cost estimates** (weekday runs = ~22 days/month; cost scales with number of changed pages per run):

| Scenario (approx. changed pages per run) | Monthly cost (USD) |
|---|---|
| Light usage (~1–3 pages/run) | ~$0.01–0.05 |
| Moderate usage (~3–10 pages/run) | ~$0.05–0.15 |
| Heavy usage (~10–20+ pages/run) | ~$0.15–0.50 |

These ranges are back-of-the-envelope estimates based on Claude Sonnet 4 pricing as of 2025-05, assuming one weekday run per day (~22/month).

Costs are **practically negligible** for most teams. Even with heavy usage, monthly costs are unlikely to exceed $1.

For the latest per-token pricing, see the [Anthropic pricing page](https://www.anthropic.com/pricing).

### GitHub Issue integration

DesignDigest can automatically create GitHub Issues when design changes are detected, so that changes are tracked as actionable tasks.

#### Setup

1. Set the following environment variables (or GitHub Actions secrets). Either `GITHUB_ISSUE_TOKEN` or `GITHUB_TOKEN` (the default token in GitHub Actions) must be available for issue creation:

| Variable | Required | Description |
|---|---|---|
| `GITHUB_ISSUE_ENABLED` | Yes | Set to `true` to enable |
| `GITHUB_ISSUE_TOKEN` | No* | Explicit GitHub token for issue creation. Falls back to `GITHUB_TOKEN` (with `permissions: issues: write`) |
| `GITHUB_ISSUE_REPO` | Yes | Target repository in `owner/repo` format |
| `GITHUB_ISSUE_LABELS` | No | Comma-separated labels to add (e.g., `design,figma`) |
| `GITHUB_ISSUE_ASSIGNEES` | No | Comma-separated GitHub usernames to assign |

\* Required only if you do not want to rely on the default `GITHUB_TOKEN` provided by GitHub Actions.

2. When `ANTHROPIC_API_KEY` is also set, Claude generates concise issue titles and a per-file AI summary included in the issue body. Otherwise, a default title with change counts is used and no AI summary is included. The AI summary shares a cache with the Backlog integration, so enabling both does not double API calls.

#### Duplicate prevention

Each GitHub Issue body includes a `[DesignDigest] {fileKey}` marker. Before creating a new issue, DesignDigest searches for open issues containing this marker. If a matching issue is found, a new one will not be created.

### Backlog integration

DesignDigest can automatically create [Backlog](https://backlog.com/) issues when design changes are detected.

#### Setup

1. Set the following environment variables (or GitHub Actions secrets):

| Variable | Required | Description |
|---|---|---|
| `BACKLOG_ENABLED` | Yes | Set to `true` to enable |
| `BACKLOG_API_KEY` | Yes | Backlog API key |
| `BACKLOG_SPACE_ID` | Yes | Backlog space ID (e.g., `yourteam` for `yourteam.backlog.com`) |
| `BACKLOG_PROJECT_ID` | Yes | Backlog project ID (numeric) |
| `BACKLOG_ISSUE_TYPE_ID` | No | Issue type ID |
| `BACKLOG_PRIORITY_ID` | No | Priority ID |
| `BACKLOG_ASSIGNEE_ID` | No | Assignee user ID |

2. When `ANTHROPIC_API_KEY` is also set, Claude generates concise issue titles from the changes. Otherwise, a default title with change counts is used.

#### Duplicate prevention

Each Backlog issue description includes a `[DesignDigest] {fileKey}` marker. Before creating a new issue, DesignDigest searches for existing issues containing this marker. If a matching issue is found, a new one will not be created.

### Slack setup

1. Create a [Slack Incoming Webhook](https://api.slack.com/messaging/webhooks)
2. Set `SLACK_WEBHOOK_URL` to the webhook URL

## What Gets Detected

- **Added/deleted** pages, frames, components, text layers
- **Property changes**: fills, strokes, font size, text content, spacing, opacity, layout, effects, and more
- **Noise filtered**: absolute position, render bounds, and other auto-generated metadata are excluded
- **Auto-aggregation**: when a single node has 5+ property changes, they're collapsed into one summary line

## Example Output

```
=== DesignDigest Report: abc123 ===
3 change(s) detected

📄 Home
  ➕ NewBanner (FRAME) added
  ✏️  HeaderTitle.フォントサイズ: 24 → 28

📄 Settings
  ➖ OldToggle (INSTANCE) deleted
```

## Development

```bash
npm test          # Run tests
npm run lint      # Lint
npm run typecheck # Type check
npm run diff:dry-run  # Manual test run
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Run checks: `npm test && npm run lint && npm run typecheck`
4. Commit your changes
5. Push to the branch and open a Pull Request

## License

MIT — see [LICENSE](LICENSE) for details.
