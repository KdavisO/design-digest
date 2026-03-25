import type { ChangeEntry } from "./diff-engine.js";

export interface GitHubIssueConfig {
  token: string;
  owner: string;
  repo: string;
  labels: string[];
  assignees: string[];
}

export interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
}

interface GitHubIssueResponse {
  number: number;
  title: string;
  html_url: string;
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubIssueResponse[];
}

/**
 * Search for existing open issues that match the given Figma file key
 * to prevent duplicate issue creation.
 */
export async function findExistingGitHubIssue(
  config: GitHubIssueConfig,
  fileKey: string,
): Promise<GitHubIssue | null> {
  const query = `repo:${config.owner}/${config.repo} is:issue is:open "[DesignDigest] ${fileKey}" in:body`;
  const params = new URLSearchParams({
    q: query,
    per_page: "1",
    sort: "created",
    order: "desc",
  });

  const url = `https://api.github.com/search/issues?${params}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `GitHub search failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
    );
  }

  const data: GitHubSearchResponse = await response.json();
  if (data.total_count === 0) return null;

  const issue = data.items[0];
  return {
    number: issue.number,
    title: issue.title,
    html_url: issue.html_url,
  };
}

/**
 * Create a GitHub Issue for detected design changes.
 */
export async function createGitHubIssue(
  config: GitHubIssueConfig,
  title: string,
  body: string,
): Promise<GitHubIssue> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues`;

  const payload: Record<string, unknown> = { title, body };
  if (config.labels.length > 0) {
    payload.labels = config.labels;
  }
  if (config.assignees.length > 0) {
    payload.assignees = config.assignees;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(
      `GitHub issue creation failed: ${response.status} ${response.statusText}${responseBody ? ` - ${responseBody}` : ""}`,
    );
  }

  const issue: GitHubIssueResponse = await response.json();
  return {
    number: issue.number,
    title: issue.title,
    html_url: issue.html_url,
  };
}

/**
 * Format change entries into a GitHub Issue body (Markdown).
 */
export function formatGitHubIssueBody(
  fileKey: string,
  changes: ChangeEntry[],
  aiSummary?: string,
): string {
  const figmaUrl = `https://www.figma.com/design/${fileKey}`;
  const lines: string[] = [
    `[DesignDigest] ${fileKey}`,
    "",
    `**Figma file:** [${fileKey}](${figmaUrl})`,
    `**${changes.length} change(s) detected**`,
    "",
  ];

  if (aiSummary) {
    lines.push("## AI Summary", "", aiSummary, "");
  }

  lines.push("## Changes", "");

  const grouped: Record<string, ChangeEntry[]> = {};
  for (const change of changes) {
    (grouped[change.pageName] ??= []).push(change);
  }

  for (const [pageName, pageChanges] of Object.entries(grouped)) {
    lines.push(`### ${pageName}`, "");
    for (const change of pageChanges) {
      switch (change.kind) {
        case "added":
          lines.push(`- ➕ Added: **${change.nodeName}** (${change.nodeType})`);
          break;
        case "deleted":
          lines.push(
            `- ➖ Deleted: **${change.nodeName}** (${change.nodeType})`,
          );
          break;
        case "renamed":
          lines.push(
            `- 🏷️ Renamed: \`${String(change.oldValue)}\` → \`${String(change.newValue)}\``,
          );
          break;
        case "modified":
          lines.push(
            `- ✏️ Modified: **${change.nodeName}**.${change.property ?? ""}: \`${formatVal(change.oldValue)}\` → \`${formatVal(change.newValue)}\``,
          );
          break;
      }
    }
    lines.push("");
  }

  lines.push(
    "---",
    "*This issue was automatically created by [DesignDigest](https://github.com/KdavisO/design-digest).*",
  );

  return lines.join("\n");
}

function formatVal(value: unknown): string {
  if (value === undefined) return "(none)";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Generate a GitHub Issue title using Claude API.
 */
export async function generateGitHubIssueTitle(
  anthropicApiKey: string,
  changes: ChangeEntry[],
): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: anthropicApiKey });

  const changesText = changes
    .map((c) => {
      if (c.kind === "added")
        return `- Added: ${c.nodeName} (${c.nodeType}) in ${c.pageName}`;
      if (c.kind === "deleted")
        return `- Deleted: ${c.nodeName} (${c.nodeType}) in ${c.pageName}`;
      return `- Modified: ${c.nodeName}.${c.property ?? ""} in ${c.pageName}`;
    })
    .join("\n");

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 100,
    messages: [
      {
        role: "user",
        content: `Generate a concise issue title (max 80 characters) for a GitHub Issue about these Figma design changes. The title should summarize the key changes. Respond with ONLY the title text, no quotes or extra formatting.

Changes:
${changesText}`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type === "text") return `[DesignDigest] ${block.text.trim()}`;
  return githubDefaultTitle(changes);
}

/**
 * Generate a default title when Claude API is unavailable.
 */
export function githubDefaultTitle(changes: ChangeEntry[]): string {
  const added = changes.filter((c) => c.kind === "added").length;
  const deleted = changes.filter((c) => c.kind === "deleted").length;
  const modified = changes.filter(
    (c) => c.kind === "modified" || c.kind === "renamed",
  ).length;

  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added`);
  if (deleted > 0) parts.push(`${deleted} deleted`);
  if (modified > 0) parts.push(`${modified} modified`);

  return `[DesignDigest] ${parts.join(", ")}`;
}
