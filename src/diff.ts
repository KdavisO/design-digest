import "dotenv/config";
import { loadConfig } from "./config.js";
import {
  fetchFile,
  fetchNodes,
  fetchNodesChunked,
  fetchVersions,
  checkVersionChanged,
  extractEditorsSince,
  filterWatchTargets,
  sanitizeNode,
} from "./figma-client.js";
import type { FigmaUser } from "./figma-client.js";
import { loadSnapshot, saveSnapshot } from "./snapshot.js";
import {
  detectChanges,
  buildReport,
  formatSlackBlocks,
  formatSlackReport,
  chunkLines,
  convertMarkdownToSlackMrkdwn,
} from "./diff-engine.js";
import { generateSummary } from "./claude-summary.js";
import { sendSlackNotification } from "./notify.js";
import {
  fetchOpenIssues,
  findExistingGitHubIssue,
  createGitHubIssue,
  formatGitHubIssueBody,
  generateGitHubIssueTitle,
  githubDefaultTitle,
} from "./github-issue-client.js";
import type { GitHubIssueConfig } from "./github-issue-client.js";
import {
  findExistingIssue,
  createBacklogIssue,
  formatBacklogDescription,
  generateBacklogTitle,
  defaultTitle,
} from "./backlog-client.js";
import type { BacklogConfig } from "./backlog-client.js";
import type { FigmaNode } from "./figma-client.js";
import type { ChangeEntry } from "./diff-engine.js";
import type { Config } from "./config.js";

async function processFile(
  config: Config,
  fileKey: string,
): Promise<{ fileKey: string; changes: ChangeEntry[]; editors: FigmaUser[] }> {
  // Load previous snapshot
  const previous = await loadSnapshot(config.snapshotDir, fileKey);

  // Step 1: Version history check (skip if no previous snapshot)
  let latestVersionId: string | undefined;
  let versionCheckAttempted = false;
  if (previous?.versionId) {
    try {
      console.log("  Checking version history...");
      const versionCheck = await checkVersionChanged(
        config.figmaToken,
        fileKey,
        previous.versionId,
      );
      versionCheckAttempted = true;
      latestVersionId = versionCheck.latestVersionId;
      if (!versionCheck.changed) {
        console.log("  No version change detected — skipping snapshot comparison.");
        return { fileKey, changes: [], editors: [] };
      }
      console.log("  Version changed — fetching current state.");
    } catch (err) {
      console.warn("  Version check failed, falling back to full fetch:", err);
    }
  }

  // Step 2: Fetch current state from Figma
  let pages: Record<string, FigmaNode>;

  if (config.figmaWatchNodeIds.length > 0) {
    console.log(
      `  Fetching specific nodes: ${config.figmaWatchNodeIds.join(", ")}`,
    );
    try {
      // Try normal fetch first
      const nodes = await fetchNodes(
        config.figmaToken,
        fileKey,
        config.figmaWatchNodeIds,
        config.figmaNodeDepth,
      );
      pages = {};
      for (const [id, node] of Object.entries(nodes)) {
        pages[node.name || id] = sanitizeNode(node);
      }
    } catch (err) {
      // Fall back to chunked fetch on payload size errors
      if (isPayloadTooLargeError(err)) {
        console.log("  Payload too large — switching to chunked fetch...");
        const nodes = await fetchNodesChunked(
          config.figmaToken,
          fileKey,
          config.figmaWatchNodeIds,
          config.figmaNodeDepth,
        );
        pages = {};
        for (const [id, node] of Object.entries(nodes)) {
          pages[node.name || id] = sanitizeNode(node);
        }
      } else {
        throw err;
      }
    }
  } else {
    console.log(`  Fetching full file...`);
    try {
      const file = await fetchFile(config.figmaToken, fileKey, config.figmaNodeDepth);
      const targetPages = filterWatchTargets(file, config.figmaWatchPages);
      pages = {};
      for (const page of targetPages) {
        pages[page.name] = sanitizeNode(page);
      }
    } catch (err) {
      if (isPayloadTooLargeError(err)) {
        console.log("  Payload too large — fetching page list and chunking...");
        const file = await fetchFile(config.figmaToken, fileKey, 1);
        const targetPages = filterWatchTargets(file, config.figmaWatchPages);
        const pageIds = targetPages.map((p) => p.id);
        const nodes = await fetchNodesChunked(
          config.figmaToken,
          fileKey,
          pageIds,
          config.figmaNodeDepth,
        );
        pages = {};
        for (const [id, node] of Object.entries(nodes)) {
          pages[node.name || id] = sanitizeNode(node);
        }
      } else {
        throw err;
      }
    }
  }

  console.log(`  Fetched ${Object.keys(pages).length} page(s)`);

  // Fetch latest version ID if we didn't already attempt it
  if (!versionCheckAttempted) {
    try {
      const versions = await fetchVersions(config.figmaToken, fileKey);
      if (versions.length > 0) latestVersionId = versions[0].id;
    } catch {
      // Non-critical — version ID is optional for snapshot
    }
  }

  // Save current snapshot (with version ID)
  await saveSnapshot(config.snapshotDir, fileKey, pages, latestVersionId);
  console.log("  Snapshot saved.");

  if (!previous) {
    console.log("  No previous snapshot found. First run — baseline saved.");
    return { fileKey, changes: [], editors: [] };
  }

  // Detect changes
  const changes = detectChanges(previous.pages, pages);

  // Fetch editors since last snapshot only if there are changes
  let editors: FigmaUser[] = [];
  if (changes.length > 0) {
    try {
      console.log("  Fetching version history...");
      const versions = await fetchVersions(config.figmaToken, fileKey);
      editors = extractEditorsSince(versions, previous.timestamp);
      if (editors.length > 0) {
        console.log(`  Editors: ${editors.map((e) => e.handle).join(", ")}`);
      }
    } catch (err) {
      console.warn("  Failed to fetch version history:", err);
    }
  }
  const report = buildReport(fileKey, changes, editors);

  console.log(report.summary);

  return { fileKey, changes, editors };
}

async function main(): Promise<void> {
  console.log("DesignDigest: Starting diff check...");

  const config = loadConfig();
  const allChanges: { fileKey: string; changes: ChangeEntry[]; editors: FigmaUser[] }[] = [];

  for (const fileKey of config.figmaFileKeys) {
    console.log(
      `\n--- File: ${fileKey} (${config.figmaFileKeys.indexOf(fileKey) + 1}/${config.figmaFileKeys.length}) ---`,
    );
    const result = await processFile(config, fileKey);
    allChanges.push(result);
  }

  const totalChanges = allChanges.flatMap((r) => r.changes);

  if (totalChanges.length === 0) {
    console.log("\nNo changes detected across all files. Done.");
    return;
  }

  // Optional: AI summary
  let aiSummary: string | undefined;
  let slackSummary: string | undefined;
  if (config.claudeSummaryEnabled && config.anthropicApiKey) {
    console.log("\nGenerating AI summary...");
    try {
      aiSummary = await generateSummary(config.anthropicApiKey, totalChanges);
      slackSummary = convertMarkdownToSlackMrkdwn(aiSummary);
      console.log("\n--- AI Summary ---");
      console.log(aiSummary);
    } catch (err) {
      console.warn("AI summary generation failed:", err);
    }
  }

  // Send Slack notification
  if (!config.dryRun && config.slackWebhookUrl) {
    console.log("\nSending Slack notification...");

    // Build Block Kit blocks for all files
    const MAX_BLOCKS = 50;
    let blocks = allChanges
      .filter((r) => r.changes.length > 0)
      .flatMap((r) => formatSlackBlocks(r.fileKey, r.changes, r.editors));

    if (slackSummary) {
      blocks.push({ type: "divider" });
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "*AI Summary:*" },
      });
      const summaryChunks = chunkLines(slackSummary.split("\n"), 3000);
      for (const chunk of summaryChunks) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: chunk },
        });
      }
    }

    // Slack limits messages to 50 blocks — truncate with a note if exceeded
    if (blocks.length > MAX_BLOCKS) {
      blocks = blocks.slice(0, MAX_BLOCKS - 1);
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `⚠️ Output truncated (${MAX_BLOCKS} block limit). See full report in logs.` }],
      });
    }

    // Plain text fallback for notifications/emails
    let fallbackText = allChanges
      .filter((r) => r.changes.length > 0)
      .map((r) => formatSlackReport(r.fileKey, r.changes, r.editors))
      .join("\n---\n");
    if (slackSummary) {
      fallbackText += `\n---\n*AI Summary:*\n${slackSummary}`;
    }

    await sendSlackNotification(config.slackWebhookUrl, {
      text: fallbackText,
      blocks,
    });
    console.log("Slack notification sent.");
  } else if (config.dryRun) {
    console.log("\nDry run mode — skipping Slack notification.");
  } else if (!config.slackWebhookUrl) {
    console.log("\nNo SLACK_WEBHOOK_URL configured — skipping notification.");
  }

  // Memoize per-file AI summaries to avoid duplicate Claude API calls
  // Caches both successes and failures so each fileKey is attempted at most once
  const perFileSummaryCache = new Map<string, Promise<string | undefined>>();
  function getPerFileSummary(
    apiKey: string,
    fileKey: string,
    changes: ChangeEntry[],
  ): Promise<string | undefined> {
    const cached = perFileSummaryCache.get(fileKey);
    if (cached !== undefined) return cached;
    const promise = generateSummary(apiKey, changes).catch(() => undefined);
    perFileSummaryCache.set(fileKey, promise);
    return promise;
  }

  // Create GitHub Issues
  if (
    !config.dryRun &&
    config.githubIssueEnabled &&
    config.githubIssueToken &&
    config.githubIssueRepo
  ) {
    console.log("\nCreating GitHub Issues...");
    try {
      const segments = config.githubIssueRepo
        .trim()
        .split("/")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (segments.length !== 2) {
        throw new Error(
          `Invalid GITHUB_ISSUE_REPO format: "${config.githubIssueRepo}" (expected "owner/repo")`,
        );
      }
      const [owner, repo] = segments;

      const ghIssueConfig: GitHubIssueConfig = {
        token: config.githubIssueToken,
        owner,
        repo,
        labels: config.githubIssueLabels,
        assignees: config.githubIssueAssignees,
      };

      // Fetch open issues once for duplicate checking
      const openIssues = await fetchOpenIssues(ghIssueConfig);

      for (const result of allChanges.filter((r) => r.changes.length > 0)) {
        // Check for duplicate issues (uses cached list)
        const existing = findExistingGitHubIssue(openIssues, result.fileKey);
        if (existing) {
          console.log(
            `  Skipping ${result.fileKey} — existing issue found: #${existing.number}`,
          );
          continue;
        }

        // Generate title
        let title: string;
        if (config.anthropicApiKey) {
          try {
            title = await generateGitHubIssueTitle(
              config.anthropicApiKey,
              result.changes,
            );
          } catch {
            title = githubDefaultTitle(result.changes);
          }
        } else {
          title = githubDefaultTitle(result.changes);
        }

        // Generate per-file AI summary (memoized)
        const perFileSummary = config.anthropicApiKey
          ? await getPerFileSummary(config.anthropicApiKey, result.fileKey, result.changes)
          : undefined;

        const body = formatGitHubIssueBody(
          result.fileKey,
          result.changes,
          perFileSummary,
        );

        const issue = await createGitHubIssue(ghIssueConfig, title, body);
        // Add to cache to prevent duplicates within the same run
        openIssues.push({
          number: issue.number,
          title: issue.title,
          html_url: issue.html_url,
          body,
          pull_request: undefined,
        });
        console.log(
          `  GitHub Issue created: #${issue.number} — ${issue.title}`,
        );
      }
    } catch (err) {
      console.warn("GitHub Issue creation failed:", err);
    }
  } else if (config.dryRun && config.githubIssueEnabled) {
    console.log("\nDry run mode — skipping GitHub Issue creation.");
  } else if (config.githubIssueEnabled) {
    const missing: string[] = [];
    if (!config.githubIssueToken) missing.push("GITHUB_ISSUE_TOKEN or GITHUB_TOKEN");
    if (!config.githubIssueRepo) missing.push("GITHUB_ISSUE_REPO");
    console.warn(
      `\nGitHub Issue integration enabled but missing required env vars: ${missing.join(", ")}`,
    );
  }

  // Create Backlog issues
  if (
    !config.dryRun &&
    config.backlogEnabled &&
    config.backlogApiKey &&
    config.backlogSpaceId &&
    config.backlogProjectId
  ) {
    console.log("\nCreating Backlog issue...");
    try {
      const backlogConfig: BacklogConfig = {
        apiKey: config.backlogApiKey,
        spaceId: config.backlogSpaceId,
        projectId: config.backlogProjectId,
        issueTypeId: config.backlogIssueTypeId,
        priorityId: config.backlogPriorityId,
        assigneeId: config.backlogAssigneeId,
      };

      // Process each file with changes
      for (const result of allChanges.filter((r) => r.changes.length > 0)) {
        // Check for duplicate issues
        const existing = await findExistingIssue(backlogConfig, result.fileKey);
        if (existing) {
          console.log(
            `  Skipping ${result.fileKey} — existing issue found: ${existing.issueKey}`,
          );
          continue;
        }

        // Generate title (use Claude if available, otherwise default)
        let title: string;
        if (config.anthropicApiKey) {
          try {
            title = await generateBacklogTitle(
              config.anthropicApiKey,
              result.changes,
            );
          } catch {
            title = defaultTitle(result.changes);
          }
        } else {
          title = defaultTitle(result.changes);
        }

        // Generate per-file AI summary (memoized, shared with GitHub Issue)
        const perFileSummary = config.anthropicApiKey
          ? await getPerFileSummary(config.anthropicApiKey, result.fileKey, result.changes)
          : undefined;

        const description = formatBacklogDescription(
          result.fileKey,
          result.changes,
          perFileSummary,
        );

        const issue = await createBacklogIssue(
          backlogConfig,
          title,
          description,
        );
        console.log(`  Backlog issue created: ${issue.issueKey} — ${issue.summary}`);
      }
    } catch (err) {
      console.warn("Backlog issue creation failed:", err);
    }
  } else if (config.dryRun && config.backlogEnabled) {
    console.log("\nDry run mode — skipping Backlog issue creation.");
  } else if (config.backlogEnabled) {
    const missing: string[] = [];
    if (!config.backlogApiKey) missing.push("BACKLOG_API_KEY");
    if (!config.backlogSpaceId) missing.push("BACKLOG_SPACE_ID");
    if (!config.backlogProjectId) missing.push("BACKLOG_PROJECT_ID");
    console.warn(
      `\nBacklog integration enabled but missing required env vars: ${missing.join(", ")}`,
    );
  }

  console.log("Done.");
}

function isPayloadTooLargeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Request too large") ||
    message.includes("try a smaller request") ||
    message.includes("Invalid string length")
  );
}

main().catch((err) => {
  console.error("DesignDigest failed:", err);
  process.exit(1);
});
