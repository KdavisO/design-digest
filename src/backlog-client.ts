import type { ChangeEntry } from "./diff-engine.js";

export interface BacklogConfig {
  apiKey: string;
  spaceId: string;
  projectId: string;
  issueTypeId?: string;
  priorityId?: string;
  assigneeId?: string;
}

export interface BacklogIssue {
  id: number;
  issueKey: string;
  summary: string;
  description: string;
}

interface BacklogIssueResponse {
  id: number;
  issueKey: string;
  summary: string;
  description: string;
}

interface BacklogIssueListItem {
  id: number;
  issueKey: string;
  summary: string;
  description: string;
}

function baseUrl(spaceId: string): string {
  return `https://${spaceId}.backlog.com/api/v2`;
}

/**
 * Search for existing issues that match the given marker string
 * to prevent duplicate issue creation.
 */
export async function findExistingIssue(
  config: BacklogConfig,
  marker: string,
): Promise<BacklogIssue | null> {
  const params = new URLSearchParams({
    apiKey: config.apiKey,
    "projectId[]": config.projectId,
    keyword: marker,
    count: "1",
    sort: "created",
    order: "desc",
  });

  const url = `${baseUrl(config.spaceId)}/issues?${params}`;
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Backlog API search failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
    );
  }

  const issues: BacklogIssueListItem[] = await response.json();
  if (issues.length === 0) return null;

  const issue = issues[0];
  return {
    id: issue.id,
    issueKey: issue.issueKey,
    summary: issue.summary,
    description: issue.description,
  };
}

/**
 * Create a Backlog issue for detected design changes.
 */
export async function createBacklogIssue(
  config: BacklogConfig,
  summary: string,
  description: string,
): Promise<BacklogIssue> {
  const params = new URLSearchParams({ apiKey: config.apiKey });
  const url = `${baseUrl(config.spaceId)}/issues?${params}`;

  const body: Record<string, string> = {
    projectId: config.projectId,
    summary,
    description,
  };

  if (config.issueTypeId) {
    body.issueTypeId = config.issueTypeId;
  }
  if (config.priorityId) {
    body.priorityId = config.priorityId;
  }
  if (config.assigneeId) {
    body.assigneeId = config.assigneeId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(
      `Backlog API issue creation failed: ${response.status} ${response.statusText}${responseBody ? ` - ${responseBody}` : ""}`,
    );
  }

  const issue: BacklogIssueResponse = await response.json();
  return {
    id: issue.id,
    issueKey: issue.issueKey,
    summary: issue.summary,
    description: issue.description,
  };
}

/**
 * Format change entries into a Backlog issue description.
 * @param marker - Marker string for duplicate detection (defaults to `[DesignDigest] {fileKey}`)
 * @param scopeLabel - Optional scope label (e.g., "Node: Button (FRAME)" or "Page: Home")
 */
export function formatBacklogDescription(
  fileKey: string,
  changes: ChangeEntry[],
  aiSummary?: string,
  options?: { marker?: string; scopeLabel?: string },
): string {
  const figmaUrl = `https://www.figma.com/design/${fileKey}`;
  const marker = options?.marker ?? `[DesignDigest] ${fileKey}`;
  const lines: string[] = [
    marker,
    "",
    `Figma file: ${figmaUrl}`,
  ];

  if (options?.scopeLabel) {
    lines.push(`Scope: ${options.scopeLabel}`);
  }

  lines.push(`${changes.length} change(s) detected`, "");

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
          lines.push(`- Added: ${change.nodeName} (${change.nodeType})`);
          break;
        case "deleted":
          lines.push(`- Deleted: ${change.nodeName} (${change.nodeType})`);
          break;
        case "renamed":
          lines.push(
            `- Renamed: ${String(change.oldValue)} → ${String(change.newValue)}`,
          );
          break;
        case "modified":
          lines.push(
            `- Modified: ${change.nodeName}.${change.property ?? ""}: ${formatVal(change.oldValue)} → ${formatVal(change.newValue)}`,
          );
          break;
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format a comment body for appending updated changes to an existing Backlog issue.
 */
export function formatBacklogComment(
  changes: ChangeEntry[],
  aiSummary?: string,
): string {
  const lines: string[] = [
    `${changes.length} new change(s) detected (${new Date().toISOString().split("T")[0]})`,
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
          lines.push(`- Added: ${change.nodeName} (${change.nodeType})`);
          break;
        case "deleted":
          lines.push(`- Deleted: ${change.nodeName} (${change.nodeType})`);
          break;
        case "renamed":
          lines.push(`- Renamed: ${String(change.oldValue)} → ${String(change.newValue)}`);
          break;
        case "modified":
          lines.push(`- Modified: ${change.nodeName}.${change.property ?? ""}: ${formatVal(change.oldValue)} → ${formatVal(change.newValue)}`);
          break;
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Add a comment to an existing Backlog issue.
 */
export async function addBacklogComment(
  config: BacklogConfig,
  issueIdOrKey: string,
  content: string,
): Promise<void> {
  const params = new URLSearchParams({ apiKey: config.apiKey });
  const url = `${baseUrl(config.spaceId)}/issues/${issueIdOrKey}/comments?${params}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ content }),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(
      `Backlog API comment creation failed: ${response.status} ${response.statusText}${responseBody ? ` - ${responseBody}` : ""}`,
    );
  }
}

function formatVal(value: unknown): string {
  if (value === undefined) return "(none)";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Generate a Backlog issue title using Claude API.
 * Falls back to a default title if Claude is unavailable.
 */
export async function generateBacklogTitle(
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
        content: `Generate a concise issue title (max 80 characters) for a Backlog ticket about these Figma design changes. The title should summarize the key changes. Respond with ONLY the title text, no quotes or extra formatting.

Changes:
${changesText}`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type === "text") return block.text.trim();
  return defaultTitle(changes);
}

/**
 * Generate a default title when Claude API is unavailable.
 */
export function defaultTitle(changes: ChangeEntry[]): string {
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
