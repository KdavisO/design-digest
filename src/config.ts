export interface Config {
  figmaToken: string;
  figmaFileKeys: string[];
  figmaWatchPages: string[];
  figmaWatchNodeIds: string[];
  slackWebhookUrl: string | undefined;
  anthropicApiKey: string | undefined;
  claudeSummaryEnabled: boolean;
  githubIssueEnabled: boolean;
  githubIssueToken: string | undefined;
  githubIssueRepo: string | undefined;
  githubIssueLabels: string[];
  githubIssueAssignees: string[];
  backlogEnabled: boolean;
  backlogApiKey: string | undefined;
  backlogSpaceId: string | undefined;
  backlogProjectId: string | undefined;
  backlogIssueTypeId: string | undefined;
  backlogPriorityId: string | undefined;
  backlogAssigneeId: string | undefined;
  figmaNodeDepth: number | undefined;
  snapshotDir: string;
  dryRun: boolean;
}

export function loadConfig(): Config {
  const figmaToken = env("FIGMA_TOKEN");
  const figmaFileKeys = csvList("FIGMA_FILE_KEY");
  if (figmaFileKeys.length === 0) {
    throw new Error("Missing required environment variable: FIGMA_FILE_KEY");
  }

  return {
    figmaToken,
    figmaFileKeys,
    figmaWatchPages: csvList("FIGMA_WATCH_PAGES"),
    figmaWatchNodeIds: csvList("FIGMA_WATCH_NODE_IDS"),
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    claudeSummaryEnabled: process.env.CLAUDE_SUMMARY_ENABLED === "true",
    githubIssueEnabled: process.env.GITHUB_ISSUE_ENABLED === "true",
    githubIssueToken: process.env.GITHUB_ISSUE_TOKEN || process.env.GITHUB_TOKEN || undefined,
    githubIssueRepo: process.env.GITHUB_ISSUE_REPO || undefined,
    githubIssueLabels: csvList("GITHUB_ISSUE_LABELS"),
    githubIssueAssignees: csvList("GITHUB_ISSUE_ASSIGNEES"),
    backlogEnabled: process.env.BACKLOG_ENABLED === "true",
    backlogApiKey: process.env.BACKLOG_API_KEY || undefined,
    backlogSpaceId: process.env.BACKLOG_SPACE_ID || undefined,
    backlogProjectId: process.env.BACKLOG_PROJECT_ID || undefined,
    backlogIssueTypeId: process.env.BACKLOG_ISSUE_TYPE_ID || undefined,
    backlogPriorityId: process.env.BACKLOG_PRIORITY_ID || undefined,
    backlogAssigneeId: process.env.BACKLOG_ASSIGNEE_ID || undefined,
    figmaNodeDepth: parsePositiveInt(process.env.FIGMA_NODE_DEPTH),
    snapshotDir: process.env.SNAPSHOT_DIR || "./snapshots",
    dryRun: process.env.DRY_RUN === "true",
  };
}

function env(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(
      `Invalid FIGMA_NODE_DEPTH: "${value}" (must be a positive integer)`,
    );
  }
  return n;
}

function csvList(key: string): string[] {
  const value = process.env[key];
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
