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

### Enable AI summaries

Set `ANTHROPIC_API_KEY` and `CLAUDE_SUMMARY_ENABLED=true`. The AI will summarize changes with implementation impact analysis for frontend engineers.

#### Claude API cost estimate

DesignDigest uses **Claude Sonnet 4** (`claude-sonnet-4-20250514`) to generate change summaries. Each workflow execution makes a single Claude API call that summarizes changes across all monitored Figma files, with very low token usage.

| Scenario | Input tokens | Output tokens |
|---|---|---|
| ~10 total changes across watched files | ~300–500 | ~200–400 |
| ~50 total changes across watched files | ~1,000–1,500 | ~400–800 |

**Monthly cost estimates** (weekday runs = ~22 days/month, single summary call per run; driven by total change volume, not file count):

| Scenario (approx. total changes per run) | Monthly cost (USD) |
|---|---|
| Light usage (~10–20 changes/run) | ~$0.01–0.03 |
| Moderate usage (~20–50 changes/run) | ~$0.03–0.10 |
| Heavy usage (~50–100+ changes/run) | ~$0.10–0.25 |

These ranges are back-of-the-envelope estimates based on Claude Sonnet 4 pricing as of 2025-05, assuming one weekday run per day (~22/month) and ~300–1,500 input tokens plus ~200–800 output tokens per run.

Costs are **practically negligible** for most teams. Even with heavy usage, monthly costs are unlikely to exceed $1.

For the latest per-token pricing, see the [Anthropic pricing page](https://www.anthropic.com/pricing).

### GitHub Issue integration

DesignDigest can automatically create GitHub Issues when design changes are detected, so that changes are tracked as actionable tasks.

#### Setup

1. Set the following environment variables (or GitHub Actions secrets):

| Variable | Required | Description |
|---|---|---|
| `GITHUB_ISSUE_ENABLED` | Yes | Set to `true` to enable |
| `GITHUB_ISSUE_TOKEN` | Yes | GitHub token with `issues:write` scope (falls back to `GITHUB_TOKEN`) |
| `GITHUB_ISSUE_REPO` | Yes | Target repository in `owner/repo` format |
| `GITHUB_ISSUE_LABELS` | No | Comma-separated labels to add (e.g., `design,figma`) |
| `GITHUB_ISSUE_ASSIGNEES` | No | Comma-separated GitHub usernames to assign |

2. When `ANTHROPIC_API_KEY` is also set, Claude generates concise issue titles. Otherwise, a default title with change counts is used.

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
