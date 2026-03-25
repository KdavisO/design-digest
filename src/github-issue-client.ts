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
  body: string | null;
  pull_request?: unknown;
}

/**
 * Fetch all open issues (excluding PRs) from the repository.
 * Paginates up to maxPages to handle repos with many open issues.
 * Call once per run and pass results to findExistingGitHubIssue.
 */
export async function fetchOpenIssues(
  config: GitHubIssueConfig,
): Promise<GitHubIssueResponse[]> {
  const perPage = 100;
  const maxPages = 10;
  const allIssues: GitHubIssueResponse[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      state: "open",
      per_page: perPage.toString(),
      sort: "created",
      direction: "desc",
      page: page.toString(),
    });

    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues?${params}`;
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
        `GitHub issues list failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
      );
    }

    const issues: GitHubIssueResponse[] = await response.json();
    // Filter out pull requests (GitHub API returns both issues and PRs)
    const realIssues = issues.filter((issue) => !issue.pull_request);
    allIssues.push(...realIssues);

    if (issues.length < perPage) break;

    if (page === maxPages && issues.length === perPage) {
      console.warn(
        `  Warning: Reached pagination limit (${maxPages * perPage} items). ` +
          "Older DesignDigest issues may be missed for duplicate detection.",
      );
    }
  }

  return allIssues;
}

/**
 * Search cached open issues for one matching the given Figma file key.
 * Pass the result of fetchOpenIssues to avoid repeated API calls.
 */
export function findExistingGitHubIssue(
  openIssues: GitHubIssueResponse[],
  fileKey: string,
): GitHubIssue | null {
  const markerLine = `[DesignDigest] ${fileKey}`;
  const escapedMarker = markerLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const markerRegex = new RegExp(`(^|\\n)${escapedMarker}(\\n|$)`);
  const match = openIssues.find(
    (issue) => issue.body != null && markerRegex.test(issue.body),
  );

  if (!match) return null;

  return {
    number: match.number,
    title: match.title,
    html_url: match.html_url,
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
        case "modified": {
          const target =
            change.property != null && change.property !== ""
              ? `**${change.nodeName}**.${change.property}`
              : `**${change.nodeName}**`;
          lines.push(
            `- ✏️ Modified: ${target}: \`${formatVal(change.oldValue)}\` → \`${formatVal(change.newValue)}\``,
          );
          break;
        }
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
      if (c.kind === "renamed")
        return `- Renamed: ${c.nodeName} (${c.nodeType}) in ${c.pageName}`;
      const target =
        typeof c.property === "string" && c.property.length > 0
          ? `${c.nodeName}.${c.property}`
          : c.nodeName;
      return `- Modified: ${target} in ${c.pageName}`;
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
  if (block?.type === "text") {
    const title = block.text.trim();
    const hasPrefix = /^\s*\[designdigest\]/i.test(title);
    return hasPrefix ? title : `[DesignDigest] ${title}`;
  }
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
