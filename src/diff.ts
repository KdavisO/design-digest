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
  groupByPage,
  convertMarkdownToSlackMrkdwn,
} from "./diff-engine.js";
import { generatePageSummaries } from "./claude-summary.js";
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
): Promise<{ fileKey: string; changes: ChangeEntry[]; editors: FigmaUser[]; baselineCreated: boolean }> {
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
        return { fileKey, changes: [], editors: [], baselineCreated: false };
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

  // Preserve previous versionId if we couldn't obtain a new one
  if (!latestVersionId && previous?.versionId) {
    latestVersionId = previous.versionId;
  }

  // Save current snapshot (with version ID)
  await saveSnapshot(config.snapshotDir, fileKey, pages, latestVersionId);
  console.log("  Snapshot saved.");

  if (!previous) {
    console.log("  No previous snapshot found. First run — baseline saved.");
    return { fileKey, changes: [], editors: [], baselineCreated: true };
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

  return { fileKey, changes, editors, baselineCreated: false };
}

async function main(): Promise<void> {
  console.log("DesignDigest: Starting diff check...");

  const config = loadConfig();
  const allChanges: { fileKey: string; changes: ChangeEntry[]; editors: FigmaUser[]; baselineCreated: boolean }[] = [];

  for (const fileKey of config.figmaFileKeys) {
    console.log(
      `\n--- File: ${fileKey} (${config.figmaFileKeys.indexOf(fileKey) + 1}/${config.figmaFileKeys.length}) ---`,
    );
    const result = await processFile(config, fileKey);
    allChanges.push(result);
  }

  const totalChanges = allChanges.flatMap((r) => r.changes);

  if (totalChanges.length === 0) {
    const isBaseline = allChanges.some((r) => r.baselineCreated);
    console.log("\n✅ No changes detected across all files.");

    // Send "no changes" Slack notification (skip on baseline creation)
    if (isBaseline) {
      console.log("Baseline created — skipping Slack notification.");
    } else if (!config.dryRun && config.slackWebhookUrl) {
      try {
        await sendSlackNotification(config.slackWebhookUrl, {
          text: "✅ No changes detected",
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: "✅ No changes detected",
                emoji: true,
              },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "All monitored Figma files are unchanged.",
              },
            },
          ],
        });
        console.log("Slack notification sent (no changes).");
      } catch (err) {
        console.warn("Failed to send Slack notification:", err);
      }
    } else if (config.dryRun) {
      console.log("Dry run mode — skipping Slack notification.");
    } else if (!config.slackWebhookUrl) {
      console.log("No SLACK_WEBHOOK_URL configured — skipping notification.");
    }

    console.log("Done.");
    return;
  }

  // Generate per-page AI summaries only when API key is available and at least
  // one integration will actually use them (checking required config, not just flags)
  const slackNeedsSummaries =
    config.claudeSummaryEnabled && !!config.slackWebhookUrl && !config.dryRun;
  const githubNeedsSummaries =
    config.githubIssueEnabled && !!config.githubIssueToken && !!config.githubIssueRepo && !config.dryRun;
  const backlogNeedsSummaries =
    config.backlogEnabled && !!config.backlogApiKey && !!config.backlogSpaceId && !!config.backlogProjectId && !config.dryRun;
  const needsSummaries: boolean =
    !!config.anthropicApiKey &&
    (slackNeedsSummaries || githubNeedsSummaries || backlogNeedsSummaries);
  const perFileSummaries = new Map<string, Map<string, string>>();
  if (needsSummaries) {
    const anthropicApiKey = config.anthropicApiKey!;
    console.log("\nGenerating AI summaries (per page)...");
    for (const { fileKey, changes } of allChanges) {
      if (!changes.length) continue;
      try {
        const changesByPage = groupByPage(changes);
        const { summaries, failedPages } = await generatePageSummaries(anthropicApiKey, changesByPage);
        perFileSummaries.set(fileKey, summaries);
        for (const [pageName, summary] of summaries) {
          console.log(`\n--- AI Summary: ${fileKey} / ${pageName} ---`);
          console.log(summary);
        }
        if (failedPages.length > 0) {
          console.warn(`  Failed to generate summaries for ${fileKey}: ${failedPages.join(", ")}`);
        }
      } catch (err) {
        console.warn(`AI summary generation failed for ${fileKey}:`, err);
      }
    }
  }

  // Send Slack notification
  if (!config.dryRun && config.slackWebhookUrl) {
    console.log("\nSending Slack notification...");

    // Build Block Kit blocks for all files, inserting dividers between file reports
    const MAX_BLOCKS = 50;
    const fileResults = allChanges.filter((r) => r.changes.length > 0);
    // Only include AI summaries in Slack when configured
    const slackSummaries = slackNeedsSummaries ? perFileSummaries : undefined;
    let blocks = fileResults.flatMap((r, i) => {
      const fileBlocks = formatSlackBlocks(r.fileKey, r.changes, r.editors, slackSummaries?.get(r.fileKey));
      return i < fileResults.length - 1
        ? [...fileBlocks, { type: "divider" as const }]
        : fileBlocks;
    });

    // Slack limits messages to 50 blocks — truncate with a note if exceeded
    if (blocks.length > MAX_BLOCKS) {
      blocks = blocks.slice(0, MAX_BLOCKS - 1);
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `⚠️ Output truncated (${MAX_BLOCKS} block limit). See full report in logs.` }],
      });
    }

    // Plain text fallback for notifications/emails
    const fallbackText = allChanges
      .filter((r) => r.changes.length > 0)
      .map((r) => {
        const baseReport = formatSlackReport(r.fileKey, r.changes, r.editors);
        const fileSummaries = slackSummaries?.get(r.fileKey);
        if (!fileSummaries || fileSummaries.size === 0) return baseReport;
        const summaryLines = [...fileSummaries.entries()]
          .map(([pageName, summary]) => {
            const mrkdwn = convertMarkdownToSlackMrkdwn(summary);
            return `💡 ${pageName}:\n${mrkdwn}`;
          })
          .join("\n");
        return `${baseReport}\n\n${summaryLines}`;
      })
      .join("\n---\n");

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

  // Reuse per-page summaries for issue bodies instead of making additional API calls.
  // Joins page summaries into a single per-file summary text.
  function getPerFileSummary(fileKey: string): string | undefined {
    const fileSummaries = perFileSummaries.get(fileKey);
    if (!fileSummaries || fileSummaries.size === 0) return undefined;
    return [...fileSummaries.entries()]
      .map(([pageName, summary]) => `### ${pageName}\n${summary}`)
      .join("\n\n");
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

        // Reuse per-page summaries as per-file summary for issue body
        const perFileSummary = getPerFileSummary(result.fileKey);

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

        // Reuse per-page summaries as per-file summary for issue body
        const perFileSummary = getPerFileSummary(result.fileKey);

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
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes("request too large") ||
    message.includes("try a smaller request") ||
    message.includes("invalid string length")
  );
}

main().catch(async (err) => {
  console.error("DesignDigest failed:", err);

  // Send error notification to Slack (skip in dry-run for consistency)
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const isDryRun = process.env.DRY_RUN === "true";
  if (webhookUrl && !isDryRun) {
    try {
      const MAX_TEXT_LENGTH = 2900;
      const rawMessage = err instanceof Error ? err.message : String(err);
      const errorMessage = rawMessage.slice(0, MAX_TEXT_LENGTH);
      const rawStack = err instanceof Error && err.stack
        ? err.stack.split("\n").slice(0, 5).join("\n")
        : "";
      const stackTrace = rawStack.slice(0, MAX_TEXT_LENGTH);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      try {
        await sendSlackNotification(webhookUrl, {
          text: `⚠️ DesignDigest failed: ${errorMessage}`,
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: "⚠️ DesignDigest Error", emoji: true },
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: `*Error:*\n\`\`\`${errorMessage}\`\`\`` },
            },
            ...(stackTrace
              ? [{
                  type: "section",
                  text: { type: "mrkdwn", text: `*Stack trace:*\n\`\`\`${stackTrace}\`\`\`` },
                }]
              : []),
          ],
        }, controller.signal);
        console.log("Error notification sent to Slack.");
      } finally {
        clearTimeout(timeout);
      }
    } catch (notifyErr) {
      console.error("Failed to send error notification to Slack:", notifyErr);
    }
  }

  process.exit(1);
});
