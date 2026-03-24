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
  └─ Slack Webhook → structured change report
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
2. Create a token with `file_content:read` scope

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
