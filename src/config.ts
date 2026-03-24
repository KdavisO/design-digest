export interface Config {
  figmaToken: string;
  figmaFileKeys: string[];
  figmaWatchPages: string[];
  figmaWatchNodeIds: string[];
  slackWebhookUrl: string | undefined;
  anthropicApiKey: string | undefined;
  claudeSummaryEnabled: boolean;
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

function csvList(key: string): string[] {
  const value = process.env[key];
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
